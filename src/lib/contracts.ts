import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { formatInTimeZone } from "date-fns-tz";
import { z } from "zod";
import { db, tx } from "./db";
import {
  AppError,
  audit,
  requireCase,
  requirePermission,
  scopeSql,
  type Actor,
} from "./access";
import { readObject, writeObject, deleteObject, scan } from "./storage";
import { settings } from "./service";
import {
  creationFinanceSchema,
  type CreationFinance,
} from "./case-creation-finance";
import { decimal, cents } from "./accounting-domain";
import {
  fillContractTemplate,
  validateContractTemplate,
  type ContractValues,
} from "./contract-docx";
export const docxMime =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
type Connection = Pick<PoolClient, "query">;
export async function currentContractTemplate(c: Connection = db) {
  return (
    (
      await c.query(
        "SELECT * FROM contract_templates ORDER BY created_at DESC,id DESC LIMIT 1",
      )
    ).rows[0] || null
  );
}
function requireTemplateAdmin(a: Actor) {
  requirePermission(a, "can_manage_settings");
  if (a.role !== "Administrator")
    throw new AppError(
      403,
      "Шаблон договора может изменить только администратор",
    );
}
export async function importContractTemplate(
  a: Actor,
  filename: string,
  bytes: Buffer,
) {
  requireTemplateAdmin(a);
  if (!filename.toLowerCase().endsWith(".docx"))
    throw new AppError(400, "Загрузите шаблон в формате DOCX");
  try {
    validateContractTemplate(bytes);
  } catch (e) {
    throw new AppError(400, (e as Error).message);
  }
  if (!(await scan(bytes)))
    throw new AppError(400, "Шаблон заблокирован проверкой безопасности");
  const storageKey = "contract-templates/" + randomUUID();
  await writeObject(storageKey, bytes, docxMime);
  try {
    return await tx(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(81825)");
      const row = (
        await c.query(
          "INSERT INTO contract_templates(filename,storage_key,size,created_by) VALUES($1,$2,$3,$4) RETURNING id,filename,size,created_at",
          [
            filename.replace(/[\r\n\0]/g, "").slice(0, 250),
            storageKey,
            bytes.length,
            a.id,
          ],
        )
      ).rows[0];
      await audit(
        c,
        a,
        "Импортирован шаблон договора",
        "contract_template",
        row.id,
      );
      return row;
    });
  } catch (e) {
    await deleteObject(storageKey).catch(() => {});
    throw e;
  }
}
export async function renderContract(
  c: Connection,
  name: string,
  finance: CreationFinance,
) {
  const template = await currentContractTemplate(c);
  if (!template)
    throw new AppError(
      409,
      "Администратор должен импортировать шаблон договора в настройках",
    );
  const timezone = (await settings(c)).timezone,
    now = new Date();
  const generatedOn = formatInTimeZone(now, timezone, "yyyy-MM-dd");
  const amount = (value: string) =>
    decimal(cents(value || "0")).replace(".", ",");
  const values: ContractValues = {
    CLIENT_NAME: name,
    DATE: formatInTimeZone(now, timezone, "dd.MM.yyyy"),
    TOTAL_AMOUNT: amount(finance.contract_amount),
    INITIAL_PAYMENT: amount(finance.initial_payment),
    CURRENCY: finance.currency,
  };
  const bytes = fillContractTemplate(
    await readObject(template.storage_key),
    values,
  );
  const filename =
    ("Договор — " + name).replace(/[<>:"/\\|?*\x00-\x1f]/g, "").slice(0, 200) +
    ".docx";
  return { templateId: template.id, values, generatedOn, bytes, filename };
}
export async function previewContract(a: Actor, raw: unknown) {
  requirePermission(a, "can_create_cases");
  requirePermission(a, "accounting.view_contract");
  requirePermission(a, "accounting.manage");
  const d = z
    .object({
      name: z.string().trim().min(1).max(250),
      client_id: z.string().uuid().or(z.literal("")).optional(),
      finance: creationFinanceSchema,
    })
    .parse(raw);
  let name = d.name;
  if (d.client_id) {
    const client = (
      await db.query(
        "SELECT cl.name FROM clients cl WHERE cl.id=$2 AND EXISTS(SELECT 1 FROM cases c WHERE c.client_id=cl.id AND " +
          scopeSql(a) +
          ")",
        [a.id, d.client_id],
      )
    ).rows[0];
    if (!client) throw new AppError(404, "Клиент недоступен");
    name = client.name;
  }
  return renderContract(db, name, d.finance);
}
export async function attachCreatedContract(
  c: PoolClient,
  a: Actor,
  caseId: string,
  name: string,
  finance: CreationFinance,
  cleanup: string[],
) {
  requirePermission(a, "accounting.view_contract");
  const result = await renderContract(c, name, finance),
    key = "contracts/" + randomUUID();
  cleanup.push(key);
  await writeObject(key, result.bytes, docxMime);
  await c.query(
    "INSERT INTO generated_contracts(case_id,template_id,storage_key,filename,size,generated_on,values) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      caseId,
      result.templateId,
      key,
      result.filename,
      result.bytes.length,
      result.generatedOn,
      result.values,
    ],
  );
  await audit(c, a, "Создан договор по шаблону", "contract", caseId, caseId, {
    template_id: result.templateId,
    date: result.generatedOn,
  });
}
export async function downloadContract(a: Actor, caseId: string) {
  await requireCase(a, caseId, "can_download_documents");
  requirePermission(a, "accounting.view_contract");
  requirePermission(a, "accounting.view");
  const row = (
    await db.query("SELECT * FROM generated_contracts WHERE case_id=$1", [
      caseId,
    ])
  ).rows[0];
  if (!row) throw new AppError(404, "Договор не найден");
  const bytes = await readObject(row.storage_key);
  await requireCase(a, caseId, "can_download_documents");
  await audit(
    db,
    a,
    "Договор выдан для скачивания",
    "contract",
    caseId,
    caseId,
  );
  return { ...row, bytes };
}
export async function templateDownload(a: Actor) {
  requireTemplateAdmin(a);
  const row = await currentContractTemplate();
  if (!row) throw new AppError(404, "Шаблон не загружен");
  return { ...row, bytes: await readObject(row.storage_key) };
}

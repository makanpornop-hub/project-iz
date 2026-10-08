import type { PoolClient } from "pg";
import { z } from "zod";
import { db, tx } from "./db";
import { AppError, audit, requirePermission, type Actor } from "./access";
import {
  optionalCaseFields,
  defaultCasePolicy,
  type CaseFormPolicy,
  type CaseField,
} from "./case-form-domain";
import { cents } from "./accounting-domain";
type Connection = Pick<PoolClient, "query">;
export async function caseFormPolicy(
  c: Connection = db,
): Promise<CaseFormPolicy> {
  return (
    (await c.query("SELECT value FROM system_settings WHERE id='case_form'"))
      .rows[0]?.value || defaultCasePolicy
  );
}
export async function saveCaseFormPolicy(a: Actor, raw: unknown) {
  requirePermission(a, "can_manage_settings");
  if (a.role !== "Administrator")
    throw new AppError(
      403,
      "Обязательные поля может менять только администратор",
    );
  const d = z
    .object({
      revision: z.number().int().min(0),
      required: z
        .array(
          z.enum(
            Object.keys(optionalCaseFields) as [CaseField, ...CaseField[]],
          ),
        )
        .max(8),
    })
    .parse(raw);
  return tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(81827)");
    const before = await caseFormPolicy(c);
    if (before.revision !== d.revision)
      throw new AppError(
        409,
        "Настройки полей изменились. Откройте форму заново.",
      );
    const after = {
      revision: before.revision + 1,
      required: [...new Set(d.required)],
    };
    await c.query(
      "INSERT INTO system_settings(id,value) VALUES('case_form',$1) ON CONFLICT(id) DO UPDATE SET value=EXCLUDED.value",
      [JSON.stringify(after)],
    );
    await audit(
      c,
      a,
      "Обязательные поля изменены",
      "settings",
      "case_form",
      undefined,
      { before, after },
    );
    return after;
  });
}
export async function validateCaseFields(
  c: Connection,
  d: Record<string, any>,
  client: Record<string, any>,
) {
  const policy = await caseFormPolicy(c);
  const values = { ...d, ...client, ...d.finance };
  for (const field of policy.required) {
    if (
      field === "payment_deadline" &&
      d.finance?.initial_payment &&
      d.finance?.contract_amount &&
      cents(d.finance.initial_payment) >= cents(d.finance.contract_amount)
    )
      continue;
    if (
      !String(values[field] ?? "").trim() ||
      (field === "initial_payment" && cents(String(values[field])) <= 0n)
    )
      throw new AppError(
        400,
        "Заполните обязательное поле: " + optionalCaseFields[field],
      );
  }
}

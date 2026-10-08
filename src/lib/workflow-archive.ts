import { zipSync } from "fflate";
import type { PoolClient } from "pg";
import { db } from "./db";
import { AppError, requireCase, audit, type Actor } from "./access";
import { readObject, writeObject } from "./storage";
const safe = (value: string) =>
  value
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, 90) || "Документ";
export async function createWorkflowArchive(
  c: Pick<PoolClient, "query">,
  wf: any,
  key: string,
) {
  const entries: Record<string, Uint8Array> = {};
  const fields = wf.groups.flatMap((g: any, gi: number) =>
    [...g.fields, g.output]
      .filter((f: any) => f?.latest)
      .map((f: any, fi: number) => ({ g, f, gi, fi })),
  );
  const ids = fields.map(({ f }: any) => f.latest.id);
  const versions = (
    await c.query("SELECT * FROM document_versions WHERE id=ANY($1::uuid[])", [
      ids,
    ])
  ).rows;
  if (versions.some((v) => v.scan_status !== "clean"))
    throw new AppError(409, "Дождитесь успешной проверки всех файлов");
  if (versions.reduce((n, v) => n + Number(v.size), 0) > 512 * 1024 * 1024)
    throw new AppError(413, "Общий размер документов для ZIP превышает 512 МБ");
  for (const { g, f, gi, fi } of fields) {
    const v = versions.find((v) => v.id === f.latest.id);
    if (!v)
      throw new AppError(409, "Список файлов изменился. Обновите страницу");
    const name =
      String(gi + 1).padStart(2, "0") +
      "_" +
      safe(g.name) +
      "/" +
      String(fi + 1).padStart(2, "0") +
      "_" +
      safe(f.name) +
      "__" +
      safe(v.filename);
    entries[name] = await readObject(v.storage_key);
  }
  const bytes = Buffer.from(zipSync(entries, { level: 0 }));
  await writeObject(key, bytes, "application/zip");
  const rec = (
    await c.query(
      "SELECT cl.name,c.visa_type FROM cases c JOIN clients cl ON cl.id=c.client_id WHERE c.id=$1",
      [wf.case_id],
    )
  ).rows[0];
  return (
    await c.query(
      "INSERT INTO workflow_archives(case_id,filename,storage_key,size,file_count,version_ids) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
      [
        wf.case_id,
        `${safe(rec.name)} — ${safe(rec.visa_type)}.zip`,
        key,
        bytes.length,
        ids.length,
        ids,
      ],
    )
  ).rows[0];
}
export async function downloadWorkflowArchive(a: Actor, id: string) {
  const archive = (
    await db.query("SELECT * FROM workflow_archives WHERE id=$1", [id])
  ).rows[0];
  if (!archive) throw new AppError(404, "Архив не найден");
  await requireCase(a, archive.case_id, "can_download_documents");
  const count = (
    await db.query(
      "SELECT count(*) FROM document_versions WHERE id=ANY($1::uuid[]) AND scan_status='clean'",
      [archive.version_ids],
    )
  ).rows[0].count;
  if (Number(count) !== archive.version_ids.length)
    throw new AppError(409, "Один из документов архива заблокирован");
  const bytes = await readObject(archive.storage_key);
  await requireCase(a, archive.case_id, "can_download_documents");
  await audit(
    db,
    a,
    "Скачан ZIP перечня документов",
    "workflow_archive",
    id,
    archive.case_id,
  );
  return { archive, bytes };
}

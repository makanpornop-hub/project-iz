import { unzipSync, zipSync } from "fflate";
import { db } from "./db";
import { readObject } from "./storage";
import { sendDocument } from "./telegram";
export function archiveParts(bytes: Buffer, limit = 48000000): Buffer[] {
  if (bytes.length <= limit) return [bytes];
  const entries = unzipSync(bytes),
    parts: Buffer[] = [];
  let batch: Record<string, Uint8Array> = {},
    size = 22;
  const flush = () => {
    if (!Object.keys(batch).length) return;
    const zip = Buffer.from(zipSync(batch, { level: 0 }));
    if (zip.length > limit)
      throw Error("Файл превышает допустимый размер Telegram");
    parts.push(zip);
    batch = {};
    size = 22;
  };
  for (const [name, data] of Object.entries(entries)) {
    const entrySize = data.length + Buffer.byteLength(name) * 2 + 512;
    if (size + entrySize > limit) flush();
    batch[name] = data;
    size += entrySize;
  }
  flush();
  return parts;
}
export async function deliverWorkflowArchive(id: string) {
  const archive = (
    await db.query("SELECT * FROM workflow_archives WHERE id=$1", [id])
  ).rows[0];
  if (!archive || archive.telegram_sent_at) return;
  if (!archive.telegram_chat_id) throw Error("Группа отправки ZIP не задана");
  const clean = (
    await db.query(
      "SELECT count(*)::int n FROM document_versions WHERE id=ANY($1::uuid[]) AND scan_status='clean'",
      [archive.version_ids],
    )
  ).rows[0].n;
  if (clean !== archive.version_ids.length)
    throw Error("Файл архива не прошёл проверку безопасности");
  const parts = archiveParts(await readObject(archive.storage_key));
  for (let i = 0; i < parts.length; i++) {
    if (
      (
        await db.query(
          "SELECT 1 FROM workflow_archive_deliveries WHERE archive_id=$1 AND part=$2",
          [id, i + 1],
        )
      ).rowCount
    )
      continue;
    const filename =
      parts.length === 1
        ? archive.filename
        : archive.filename.replace(/\.zip$/i, "") + "-part-" + (i + 1) + ".zip";
    const messageId = await sendDocument(
      archive.telegram_chat_id,
      filename,
      "application/zip",
      parts[i],
      archive.filename.replace(/\.zip$/i, "") +
        (parts.length > 1 ? " · Часть " + (i + 1) + "/" + parts.length : ""),
    );
    await db.query(
      "INSERT INTO workflow_archive_deliveries(archive_id,part,message_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [id, i + 1, messageId],
    );
  }
  await db.query(
    "UPDATE workflow_archives SET telegram_sent_at=now() WHERE id=$1",
    [id],
  );
}

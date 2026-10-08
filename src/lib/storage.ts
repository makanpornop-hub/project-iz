import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { fileTypeFromBuffer } from "file-type";
import { createHash, randomUUID } from "node:crypto";
import net from "node:net";
import { db, tx } from "./db";
import {
  AppError,
  type Actor,
  requireCase,
  audit,
  requirePermission,
} from "./access";
import { enqueue, settings } from "./service";
const s3 = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
  },
});
const bucket = () => {
  if (!process.env.S3_BUCKET)
    throw new AppError(503, "Хранилище не подключено");
  return process.env.S3_BUCKET;
};
export async function writeObject(key: string, bytes: Buffer, mime: string) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: bytes,
      ContentType: mime,
    }),
  );
}
export async function readObject(key: string) {
  const r = await s3.send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  if (!r.Body) throw new Error("Object missing");
  return Buffer.from(await r.Body.transformToByteArray());
}
export async function validateFile(bytes: Buffer, name: string, maxMb = 20) {
  if (!bytes.length || bytes.length > maxMb * 1024 * 1024)
    throw new AppError(400, `Файл должен быть от 1 байта до ${maxMb} МБ`);
  const ext = name.split(".").pop()?.toLowerCase();
  const type = await fileTypeFromBuffer(bytes);
  const mimeMap: Record<string, string> = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  let valid = !!ext && !!mimeMap[ext] && type?.mime === mimeMap[ext];
  if (ext === "doc" && type?.ext === "cfb")
    valid = bytes.includes(Buffer.from("WordDocument", "utf16le"));
  if (!valid)
    throw new AppError(
      400,
      "Формат файла не соответствует расширению или не поддерживается",
    );
  return mimeMap[ext!];
}
export async function saveFile(
  a: Actor,
  args: {
    caseId: string;
    documentId?: string;
    name: string;
    type: string;
    filename: string;
    bytes: Buffer;
    source: "website" | "telegram";
    uploadId?: string;
    generatedSources?: string[];
    financeReceipt?: boolean;
  },
) {
  await requireCase(a, args.caseId, "can_upload_documents");
  if (args.financeReceipt) {
    requirePermission(a, "accounting.view");
    if (
      !a.permissions.includes("expenses.create") &&
      !a.permissions.includes("expenses.edit")
    )
      throw new AppError(403, "Недостаточно прав для чека");
  }
  const cfg = await settings();
  const mime = await validateFile(args.bytes, args.filename, cfg.maxFileMb);
  const key = randomUUID();
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: args.bytes,
      ContentType: mime,
    }),
  );
  try {
    return await tx(async (c) => {
      await c.query("SELECT id FROM cases WHERE id=$1 FOR UPDATE", [
        args.caseId,
      ]);
      await requireCase(a, args.caseId, "can_upload_documents", c);
      if (args.uploadId) {
        const u = (
          await c.query(
            "SELECT * FROM telegram_uploads WHERE id=$1 FOR UPDATE",
            [args.uploadId],
          )
        ).rows[0];
        if (u?.version_id) throw new AppError(409, "Этот файл уже сохранён");
        if (
          !u ||
          u.state !== "queued" ||
          u.user_id !== a.id ||
          u.case_id !== args.caseId ||
          (u.document_id || undefined) !== args.documentId
        )
          throw new AppError(409, "Загрузка отменена или изменена");
      }
      let docId = args.documentId;
      if (docId) {
        const d = (
          await c.query(
            "SELECT * FROM documents WHERE id=$1 AND case_id=$2 FOR UPDATE",
            [docId, args.caseId],
          )
        ).rows[0];
        if (!d || d.archived) throw new AppError(404, "Документ недоступен");
        if (d.finance_receipt)
          throw new AppError(403, "Загрузите новый чек через бухгалтерию");
        if (d.group_id) {
          const { lockWorkflow } = await import("./workflow");
          await lockWorkflow(c, a, args.caseId);
          if (!["application/pdf", "image/jpeg", "image/png"].includes(mime))
            throw new AppError(
              400,
              "В перечне документов используются PDF, JPG и PNG",
            );
          if (d.is_output) {
            if (!args.generatedSources)
              throw new AppError(
                403,
                "Результат создаётся кнопкой объединения",
              );
            const sources = (
              await c.query(
                "SELECT v.id,v.scan_status FROM documents d LEFT JOIN LATERAL (SELECT id,scan_status FROM document_versions WHERE document_id=d.id ORDER BY version DESC LIMIT 1) v ON true WHERE d.group_id=$1 AND NOT d.is_output AND d.merge_order IS NOT NULL ORDER BY d.merge_order",
                [d.group_id],
              )
            ).rows;
            if (
              !sources.length ||
              sources.some((v) => v.scan_status !== "clean") ||
              JSON.stringify(sources.map((v) => v.id)) !==
                JSON.stringify(args.generatedSources)
            )
              throw new AppError(
                409,
                "Исходные файлы изменились. Повторите объединение",
              );
          } else if (args.generatedSources)
            throw new AppError(400, "Неверное поле результата");
          await c.query(
            "UPDATE case_workflows SET revision=revision+1 WHERE case_id=$1",
            [args.caseId],
          );
        }
      } else {
        if (
          !args.name.trim() ||
          args.name.length > 250 ||
          !["Passport", "Bank Statement", "Insurance", "Other"].includes(
            args.type,
          )
        )
          throw new AppError(400, "Укажите название и тип документа");
        docId = (
          await c.query(
            "INSERT INTO documents(case_id,type,name,finance_receipt) VALUES($1,$2,$3,$4) RETURNING id",
            [
              args.caseId,
              args.type,
              args.name.trim(),
              Boolean(args.financeReceipt),
            ],
          )
        ).rows[0].id;
      }
      const r = (
        await c.query(
          "INSERT INTO document_versions(document_id,version,filename,storage_key,mime,size,checksum,uploaded_by,source) SELECT $1,coalesce(max(version),0)+1,$2,$3,$4,$5,$6,$7,$8 FROM document_versions WHERE document_id=$1 RETURNING *",
          [
            docId,
            args.filename.slice(0, 250).replace(/[\r\n\x00]/g, ""),
            key,
            mime,
            args.bytes.length,
            createHash("sha256").update(args.bytes).digest("hex"),
            a.id,
            args.source,
          ],
        )
      ).rows[0];
      if (args.generatedSources)
        await c.query(
          "UPDATE document_versions SET source_version_ids=$2 WHERE id=$1",
          [r.id, args.generatedSources],
        );
      await (
        await import("./case-chat")
      ).chatDocumentUploaded(c, a, args.caseId, r);
      await enqueue(c, "scan", { versionId: r.id }, `scan:${r.id}`);
      await audit(
        c,
        a,
        "Версия документа загружена",
        "version",
        r.id,
        args.caseId,
        { version: r.version },
        args.source,
      );
      if (args.uploadId)
        await c.query(
          "UPDATE telegram_uploads SET state='saved',version_id=$2 WHERE id=$1",
          [args.uploadId, r.id],
        );
      return r;
    });
  } catch (e) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
    } catch {
      await enqueue(db, "delete_object", { key }, `delete:${key}`);
    }
    throw e;
  }
}
export async function deleteObject(key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}
export async function scan(bytes: Buffer): Promise<boolean> {
  if (!process.env.CLAMAV_HOST) throw new Error("Scanner not configured");
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({
      host: process.env.CLAMAV_HOST,
      port: Number(process.env.CLAMAV_PORT || 3310),
    });
    let reply = "";
    sock.setTimeout(120000);
    sock.on("timeout", () => sock.destroy(new Error("Scanner timeout")));
    sock.on("error", reject);
    sock.on("data", (d) => {
      reply += d.toString();
      if (reply.includes("\0")) {
        sock.end();
        if (reply.includes(" FOUND")) resolve(false);
        else if (reply.includes(" OK")) resolve(true);
        else reject(new Error("Scanner rejected request"));
      }
    });
    sock.on("end", () => {
      if (!reply.includes("\0"))
        reject(new Error("Incomplete scanner response"));
    });
    sock.on("connect", () => {
      sock.write("zINSTREAM\0");
      for (let i = 0; i < bytes.length; i += 65536) {
        const chunk = bytes.subarray(i, i + 65536),
          len = Buffer.alloc(4);
        len.writeUInt32BE(chunk.length);
        sock.write(len);
        sock.write(chunk);
      }
      sock.write(Buffer.alloc(4));
    });
  });
}

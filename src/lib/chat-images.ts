import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import { db, tx } from "./db";
import { AppError, requireCase, audit, type Actor } from "./access";
import { requireRoom } from "./chat-rooms";
import { validateFile, scan, writeObject, deleteObject } from "./storage";
import { settings, enqueue } from "./service";

type Connection = Pick<PoolClient, "query">;
export const chatImageTarget = z
  .object({
    case_id: z.string().uuid().optional(),
    room_id: z.string().uuid().optional(),
  })
  .refine((v) => !!v.case_id !== !!v.room_id);
type Target = z.infer<typeof chatImageTarget>;

async function requireTarget(a: Actor, target: Target, c: Connection = db) {
  if (target.case_id) await requireCase(a, target.case_id, "can_view_cases", c);
  else await requireRoom(a, target.room_id!, c);
}
async function discard(key: string) {
  try {
    await deleteObject(key);
  } catch {
    await enqueue(db, "delete_object", { key }, "delete:" + key);
  }
}
export async function saveChatImage(
  a: Actor,
  raw: unknown,
  bytes: Buffer,
  filename: string,
) {
  const target = chatImageTarget.parse(raw);
  const { request_id } = z.object({ request_id: z.string().uuid() }).parse(raw);
  await requireTarget(a, target);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const existing = (
    await db.query(
      "SELECT * FROM chat_images WHERE uploaded_by=$1 AND request_id=$2",
      [a.id, request_id],
    )
  ).rows[0];
  const validateRepeat = (image: any) => {
    if (
      (image.case_id || undefined) !== target.case_id ||
      (image.room_id || undefined) !== target.room_id ||
      image.checksum !== checksum
    )
      throw new AppError(409, "Запрос относится к другому фото");
    return { id: image.id };
  };
  if (existing) return validateRepeat(existing);
  const mime = await validateFile(
    bytes,
    filename,
    Math.min(20, (await settings()).maxFileMb),
  );
  if (!["image/png", "image/jpeg"].includes(mime))
    throw new AppError(400, "Вставьте фото в формате PNG или JPG");
  if (!(await scan(bytes)))
    throw new AppError(400, "Фото заблокировано антивирусом");
  const key = randomUUID();
  await writeObject(key, bytes, mime);
  try {
    const result = await tx(async (c) => {
      // Match the lock used by membership edits and message sending.
      await c.query(
        target.case_id
          ? "SELECT id FROM cases WHERE id=$1 FOR UPDATE"
          : "SELECT id FROM chat_rooms WHERE id=$1 FOR UPDATE",
        [target.case_id || target.room_id],
      );
      await requireTarget(a, target, c);
      const image = (
        await c.query(
          "INSERT INTO chat_images(case_id,room_id,uploaded_by,request_id,storage_key,filename,mime,size,checksum) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(uploaded_by,request_id) DO NOTHING RETURNING id",
          [
            target.case_id || null,
            target.room_id || null,
            a.id,
            request_id,
            key,
            filename.slice(0, 250).replace(/[\r\n\x00]/g, ""),
            mime,
            bytes.length,
            checksum,
          ],
        )
      ).rows[0];
      if (!image) {
        const repeat = (
          await c.query(
            "SELECT * FROM chat_images WHERE uploaded_by=$1 AND request_id=$2",
            [a.id, request_id],
          )
        ).rows[0];
        return { ...validateRepeat(repeat), created: false };
      }
      await audit(
        c,
        a,
        "Фото загружено в чат",
        "chat_image",
        image.id,
        target.case_id || null,
      );
      return { id: image.id, created: true };
    });
    if (!result.created) await discard(key);
    return { id: result.id };
  } catch (e) {
    await discard(key);
    throw e;
  }
}
export async function requireChatImage(
  c: Connection,
  a: Actor,
  id: string,
  target: Target,
) {
  const image = (
    await c.query("SELECT * FROM chat_images WHERE id=$1 FOR UPDATE", [id])
  ).rows[0];
  if (
    !image ||
    image.uploaded_by !== a.id ||
    (image.case_id || undefined) !== target.case_id ||
    (image.room_id || undefined) !== target.room_id
  )
    throw new AppError(404, "Фото недоступно");
  if (
    (
      await c.query(
        "SELECT 1 FROM case_chat_messages WHERE image_id=$1 UNION ALL SELECT 1 FROM chat_room_messages WHERE image_id=$1",
        [id],
      )
    ).rowCount
  )
    throw new AppError(409, "Фото уже отправлено");
}
export async function readChatImage(a: Actor, id: string) {
  const image = (
    await db.query("SELECT * FROM chat_images WHERE id=$1", [
      z.string().uuid().parse(id),
    ])
  ).rows[0];
  if (!image) throw new AppError(404, "Фото недоступно");
  await requireTarget(a, {
    case_id: image.case_id || undefined,
    room_id: image.room_id || undefined,
  });
  if (
    image.uploaded_by !== a.id &&
    !(
      await db.query(
        "SELECT 1 FROM case_chat_messages WHERE image_id=$1 AND case_id=$2 UNION ALL SELECT 1 FROM chat_room_messages WHERE image_id=$1 AND room_id=$3",
        [id, image.case_id, image.room_id],
      )
    ).rowCount
  )
    throw new AppError(404, "Фото недоступно");
  return image;
}

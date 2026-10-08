import { z } from "zod";
import type { PoolClient } from "pg";
import { db, tx } from "./db";
import { requireChatImage } from "./chat-images";
import { AppError, scopeSql, audit, type Actor } from "./access";
type Connection = Pick<PoolClient, "query">;
const uuid = z.string().uuid(),
  messageId = z.string().regex(/^[1-9][0-9]{0,17}$/);
export async function roomDirectory(a: Actor) {
  return (
    await db.query(
      'SELECT u.id,u.name FROM "user" u JOIN staff s ON s.user_id=u.id WHERE s.active AND u.id<>$1 ORDER BY u.name',
      [a.id],
    )
  ).rows;
}
export async function requireRoom(a: Actor, id: string, c: Connection = db) {
  const r = (
    await c.query(
      "SELECT r.* FROM chat_rooms r JOIN chat_room_members m ON m.room_id=r.id AND m.user_id=$2 AND m.active JOIN staff s ON s.user_id=m.user_id AND s.active WHERE r.id=$1",
      [id, a.id],
    )
  ).rows[0];
  if (!r) throw new AppError(404, "Чат недоступен");
  return r;
}
export async function chatHub(a: Actor, params: URLSearchParams) {
  const kind = z
    .enum(["all", "direct", "group", "case"])
    .parse(params.get("kind") || "all");
  const search = (params.get("q") || "").slice(0, 200);
  let after: { at: string; id: string; kind: string } | null = null;
  if (params.get("after")) {
    try {
      after = z
        .object({
          at: z.iso.datetime(),
          id: uuid,
          kind: z.enum(["direct", "group", "case"]),
        })
        .parse(
          JSON.parse(
            Buffer.from(
              params.get("after")!.slice(0, 1000),
              "base64url",
            ).toString(),
          ),
        );
    } catch {
      throw new AppError(400, "Не удалось загрузить чаты");
    }
  }
  const scope = a.permissions.includes("can_view_cases")
    ? scopeSql(a)
    : "FALSE";
  const rows = (
    await db.query(
      "SELECT *,to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') cursor_time FROM (" +
        "SELECT r.id,r.kind,CASE WHEN r.kind='direct' THEN (SELECT u.name FROM chat_room_members p JOIN \"user\" u ON u.id=p.user_id WHERE p.room_id=r.id AND p.user_id<>$1 LIMIT 1) ELSE r.title END title,coalesce(nullif(l.body,''),CASE WHEN l.image_id IS NOT NULL THEN 'Фото' ELSE '' END) last_message,r.updated_at,(SELECT count(*)::int FROM chat_room_messages rm WHERE rm.room_id=r.id AND rm.author_id<>$1 AND NOT EXISTS(SELECT 1 FROM chat_room_reads rr WHERE rr.message_id=rm.id AND rr.user_id=$1)) unread FROM chat_rooms r JOIN chat_room_members m ON m.room_id=r.id AND m.user_id=$1 AND m.active LEFT JOIN LATERAL(SELECT body,image_id FROM chat_room_messages rm WHERE rm.room_id=r.id ORDER BY id DESC LIMIT 1) l ON true " +
        "UNION ALL SELECT c.id,'case' kind,cl.name||' · '||c.visa_type||' · CASE-'||c.number::text title,coalesce(nullif(l.body,''),CASE WHEN l.image_id IS NOT NULL THEN 'Фото' ELSE '' END) last_message,coalesce(l.created_at,c.created_at) updated_at,(SELECT count(*)::int FROM case_chat_messages cm WHERE cm.case_id=c.id AND cm.author_id<>$1 AND NOT EXISTS(SELECT 1 FROM case_chat_reads cr WHERE cr.message_id=cm.id AND cr.user_id=$1)) unread FROM cases c JOIN clients cl ON cl.id=c.client_id LEFT JOIN LATERAL(SELECT body,created_at,image_id FROM case_chat_messages cm WHERE cm.case_id=c.id ORDER BY id DESC LIMIT 1) l ON true WHERE " +
        scope +
        ") chats WHERE ($2='all' OR kind=$2) AND title ILIKE $3 AND ($4::timestamptz IS NULL OR updated_at<$4 OR (updated_at=$4 AND (id,kind)>($5::uuid,$6::text))) ORDER BY updated_at DESC,id,kind LIMIT 51",
      [
        a.id,
        kind,
        "%" + search + "%",
        after?.at || null,
        after?.id || null,
        after?.kind || null,
      ],
    )
  ).rows;
  const chats = rows.slice(0, 50),
    last = chats.at(-1),
    hasMore = rows.length > 50;
  return {
    chats: chats.map(({ cursor_time, ...chat }) => chat),
    hasMore,
    nextCursor:
      hasMore && last
        ? Buffer.from(
            JSON.stringify({
              at: last.cursor_time,
              id: last.id,
              kind: last.kind,
            }),
          ).toString("base64url")
        : null,
  };
}
export async function roomData(a: Actor, params: URLSearchParams) {
  const roomId = uuid.parse(params.get("id")),
    room = await requireRoom(a, roomId);
  const members = (
    await db.query(
      'SELECT u.id,u.name,s.active FROM chat_room_members m JOIN "user" u ON u.id=m.user_id JOIN staff s ON s.user_id=u.id WHERE m.room_id=$1 AND m.active ORDER BY u.name',
      [roomId],
    )
  ).rows;
  const focus = params.get("focus")
    ? messageId.parse(params.get("focus"))
    : null;
  const before = params.get("before")
    ? messageId.parse(params.get("before"))
    : focus
      ? String(BigInt(focus) + 1n)
      : null;
  const messages = (
    await db.query(
      'SELECT m.*,u.name author,p.body reply_body,p.image_id reply_image_id,pu.name reply_author,(m.author_id=$2 OR EXISTS(SELECT 1 FROM chat_room_reads r WHERE r.message_id=m.id AND r.user_id=$2)) is_read FROM chat_room_messages m JOIN "user" u ON u.id=m.author_id LEFT JOIN chat_room_messages p ON p.id=m.reply_to LEFT JOIN "user" pu ON pu.id=p.author_id WHERE m.room_id=$1 AND ($3::bigint IS NULL OR m.id<$3) ORDER BY m.id DESC LIMIT 61',
      [roomId, a.id, before],
    )
  ).rows;
  return {
    room: {
      ...room,
      title:
        room.kind === "direct"
          ? members.find((m) => m.id !== a.id)?.name || "Личный чат"
          : room.title,
    },
    members,
    messages: messages.slice(0, 60).reverse(),
    hasMore: messages.length > 60,
  };
}
async function activeUsers(c: Connection, ids: string[]) {
  if (
    (
      await c.query(
        "SELECT 1 FROM staff WHERE user_id=ANY($1::text[]) AND active",
        [ids],
      )
    ).rowCount !== ids.length
  )
    throw new AppError(400, "Выберите активных сотрудников");
}
export async function roomMutation(a: Actor, action: string, raw: unknown) {
  return tx(async (c) => {
    if (action === "room.create") {
      const d = z
        .object({
          kind: z.enum(["direct", "group"]),
          title: z.string().trim().max(150).default(""),
          members: z.array(z.string().min(1).max(100)).min(1).max(99),
          request_id: uuid,
        })
        .parse(raw);
      const ids = [...new Set([a.id, ...d.members])].sort();
      if (d.kind === "direct" && ids.length !== 2)
        throw new AppError(400, "Выберите одного сотрудника");
      if (d.kind === "group" && (!d.title || ids.length < 2))
        throw new AppError(400, "Укажите название и участников группы");
      await activeUsers(c, ids);
      const repeat = (
        await c.query("SELECT * FROM chat_rooms WHERE request_id=$1", [
          d.request_id,
        ])
      ).rows[0];
      if (repeat) {
        if (repeat.owner_id !== a.id)
          throw new AppError(409, "Запрос уже использован");
        return requireRoom(a, repeat.id, c);
      }
      const created = (
        await c.query(
          "INSERT INTO chat_rooms(kind,title,owner_id,direct_key,request_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING *",
          [
            d.kind,
            d.title,
            a.id,
            d.kind === "direct" ? JSON.stringify(ids) : null,
            d.request_id,
          ],
        )
      ).rows[0];
      const room =
        created ||
        (
          await c.query(
            "SELECT * FROM chat_rooms WHERE direct_key=$1 OR (request_id=$2 AND owner_id=$3)",
            [
              d.kind === "direct" ? JSON.stringify(ids) : null,
              d.request_id,
              a.id,
            ],
          )
        ).rows[0];
      if (!room) throw new AppError(409, "Запрос уже использован");
      if (!created) return requireRoom(a, room.id, c);
      for (const uid of ids)
        await c.query(
          "INSERT INTO chat_room_members(room_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [room.id, uid],
        );
      await audit(c, a, "Чат открыт", "chat_room", room.id, null, {
        kind: room.kind,
      });
      return room;
    }
    const roomId = z.object({ room_id: uuid }).parse(raw).room_id;
    await c.query("SELECT id FROM chat_rooms WHERE id=$1 FOR UPDATE", [roomId]);
    const room = await requireRoom(a, roomId, c);
    if (action === "room.read") {
      const d = z.object({ ids: z.array(messageId).max(200) }).parse(raw);
      await c.query(
        "INSERT INTO chat_room_reads(message_id,user_id) SELECT id,$2 FROM chat_room_messages WHERE room_id=$1 AND id=ANY($3::bigint[]) ON CONFLICT DO NOTHING",
        [roomId, a.id, d.ids],
      );
      await c.query(
        "UPDATE notifications SET read_at=now() WHERE user_id=$1 AND room_message_id=ANY($2::bigint[]) AND room_message_id IN(SELECT id FROM chat_room_messages WHERE room_id=$3)",
        [a.id, d.ids, roomId],
      );
      return { ok: true };
    }
    if (action === "room.update") {
      if (room.kind !== "group" || room.owner_id !== a.id)
        throw new AppError(403, "Изменять группу может её создатель");
      const d = z
        .object({
          title: z.string().trim().min(1).max(150),
          members: z.array(z.string().min(1).max(100)).max(99),
        })
        .parse(raw);
      const ids = [...new Set([a.id, ...d.members])];
      await activeUsers(c, ids);
      await c.query("UPDATE chat_rooms SET title=$2 WHERE id=$1", [
        roomId,
        d.title,
      ]);
      await c.query(
        "UPDATE chat_room_members SET active=false WHERE room_id=$1 AND NOT(user_id=ANY($2::text[]))",
        [roomId, ids],
      );
      for (const uid of ids)
        await c.query(
          "INSERT INTO chat_room_members(room_id,user_id) VALUES($1,$2) ON CONFLICT(room_id,user_id) DO UPDATE SET active=true",
          [roomId, uid],
        );
      await audit(c, a, "Группа чата изменена", "chat_room", roomId, null, {
        members: ids,
      });
      return { id: roomId };
    }
    if (action !== "room.send") throw new AppError(400, "Неизвестное действие");
    const d = z
      .object({
        body: z.string().trim().max(10000).default(""),
        image_id: uuid.optional(),
        reply_to: messageId.optional(),
        request_id: uuid,
      })
      .parse(raw);
    const repeat = (
      await c.query(
        "SELECT * FROM chat_room_messages WHERE author_id=$1 AND request_id=$2",
        [a.id, d.request_id],
      )
    ).rows[0];
    if (repeat) {
      if (repeat.room_id !== roomId)
        throw new AppError(409, "Запрос относится к другому чату");
      return repeat;
    }
    if (!d.body && !d.image_id)
      throw new AppError(400, "Напишите сообщение или приложите файл");
    if (d.image_id)
      await requireChatImage(c, a, d.image_id, { room_id: roomId });
    if (
      d.reply_to &&
      !(
        await c.query(
          "SELECT 1 FROM chat_room_messages WHERE id=$1 AND room_id=$2",
          [d.reply_to, roomId],
        )
      ).rowCount
    )
      throw new AppError(400, "Ответ должен быть в том же чате");
    if (
      room.kind === "direct" &&
      !(
        await c.query(
          "SELECT 1 FROM chat_room_members m JOIN staff s ON s.user_id=m.user_id AND s.active WHERE m.room_id=$1 AND m.user_id<>$2",
          [roomId, a.id],
        )
      ).rowCount
    )
      throw new AppError(409, "Сотрудник недоступен");
    const message = (
      await c.query(
        "INSERT INTO chat_room_messages(room_id,author_id,body,reply_to,request_id,image_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
        [
          roomId,
          a.id,
          d.body,
          d.reply_to || null,
          d.request_id,
          d.image_id || null,
        ],
      )
    ).rows[0];
    await c.query("UPDATE chat_rooms SET updated_at=now() WHERE id=$1", [
      roomId,
    ]);
    await c.query(
      "INSERT INTO notifications(user_id,title,message,dedupe_key,room_message_id) SELECT m.user_id,$2,$3,'room:'||$4::text||':'||m.user_id,$4::bigint FROM chat_room_members m JOIN staff s ON s.user_id=m.user_id AND s.active WHERE m.room_id=$1 AND m.active AND m.user_id<>$5",
      [
        roomId,
        room.kind === "direct" ? "Личное сообщение" : "Сообщение в группе",
        a.name + ": " + (d.body || "Фото").slice(0, 300),
        message.id,
        a.id,
      ],
    );
    return message;
  });
}

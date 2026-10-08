import { isClosedStatus } from "./domain";
import { createHash, randomBytes } from "node:crypto";
import { db, tx } from "./db";
import {
  AppError,
  actorFor,
  audit,
  requireCase,
  requirePermission,
  scopeSql,
  type Actor,
} from "./access";
import { enqueue } from "./service";
import { saveFile } from "./storage";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
export async function telegram(
  method: string,
  data: unknown,
  timeoutMs?: number,
) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Telegram not configured");
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(30000),
  });
  const result = await r.json();
  if (!r.ok || !result.ok)
    throw new Error(`Telegram operation failed (${r.status})`);
  return result.result;
}
export async function sendDocument(
  chatId: string,
  filename: string,
  mime: string,
  bytes: Buffer,
  caption: string,
) {
  if (!process.env.TELEGRAM_BOT_TOKEN)
    throw new Error("Telegram not configured");
  const form = new FormData();
  form.set("chat_id", chatId);
  form.set("caption", caption);
  form.set(
    "document",
    new Blob([new Uint8Array(bytes)], { type: mime }),
    filename,
  );
  const r = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendDocument`,
    { method: "POST", body: form, signal: AbortSignal.timeout(60000) },
  );
  const result = await r.json();
  if (!r.ok || !result.ok)
    throw new Error(`Telegram document failed (${r.status})`);
  return String(result.result.message_id);
}
export async function linkTelegram(a: Actor) {
  if (!process.env.TELEGRAM_BOT_USERNAME || !process.env.TELEGRAM_BOT_TOKEN)
    throw new AppError(503, "Telegram-бот ещё не настроен");
  const token = randomBytes(24).toString("hex");
  await tx(async (c) => {
    const link = (
      await c.query("SELECT telegram_id FROM telegram_links WHERE user_id=$1", [
        a.id,
      ])
    ).rows[0];
    if (link?.telegram_id)
      throw new AppError(409, "Сначала отключите текущий Telegram");
    await c.query(
      "INSERT INTO telegram_links(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '10 minutes') ON CONFLICT(user_id) DO UPDATE SET token_hash=$2,expires_at=now()+interval '10 minutes'",
      [a.id, digest(token)],
    );
    await audit(c, a, "Запрошена привязка Telegram", "user", a.id);
  });
  return `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=${token}`;
}
async function botReply(userId: string, text: string, keyboard?: unknown) {
  return telegram("sendMessage", {
    chat_id: userId,
    text,
    reply_markup: keyboard,
  });
}
const compact = (id: string) =>
  Buffer.from(id.replaceAll("-", ""), "hex").toString("base64url");
function expand(value: string) {
  if (!/^[A-Za-z0-9_-]{22}$/.test(value)) return null;
  const h = Buffer.from(value, "base64url").toString("hex");
  if (h.length !== 32) return null;
  return h.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
}
const callback = (kind: string, upload: any, value = "") =>
  `${kind}:${compact(upload.id)}:${value}`;
const button = (text: string, kind: string, upload: any, value = "") => ({
  text: text.slice(0, 120),
  callback_data: callback(kind, upload, value),
});
const types = [
  ["Passport", "Паспорт"],
  ["Bank Statement", "Выписка из банка"],
  ["Insurance", "Страховка"],
  ["Other", "Другое"],
];

async function menu(a: Actor, chatId: string, upload: any, query = "") {
  await requirePermission(a, "can_view_cases");
  const cases = (
    await db.query(
      `SELECT c.id,c.number,c.country,c.visa_type,cl.name FROM cases c JOIN clients cl ON cl.id=c.client_id WHERE $1::text IS NOT NULL AND ${scopeSql(a)} AND (cl.name ILIKE $2 OR ('CASE-'||c.number) ILIKE $2) ORDER BY c.updated_at DESC LIMIT 15`,
      [a.id, `%${query}%`],
    )
  ).rows;
  await botReply(
    chatId,
    cases.length
      ? "Выберите дело. Для поиска отправьте имя или номер. /cancel — отмена."
      : "Дела не найдены. Отправьте другое имя или номер.",
    {
      inline_keyboard: cases.map((c) => [
        {
          text: `${c.name} · ${c.country} · ${c.visa_type} · CASE-${c.number}`.slice(
            0,
            120,
          ),
          callback_data: callback("case", upload, compact(c.id)),
        },
      ]),
    },
  );
}
export async function processUpdate(update: any) {
  await (await import("./telegram-settings")).recordTelegramChat(update);
  const msg = update.message,
    cb = update.callback_query;
  const from = msg?.from || cb?.from;
  const chat = msg?.chat || cb?.message?.chat;
  if (!from || chat?.type !== "private" || String(chat.id) !== String(from.id))
    return;
  const telegramId = String(from.id);
  const text = msg?.text || "";
  if (text.startsWith("/start ")) {
    const token = text.slice(7).trim();
    await tx(async (c) => {
      const link = (
        await c.query(
          "SELECT * FROM telegram_links WHERE token_hash=$1 AND expires_at>now() FOR UPDATE",
          [digest(token)],
        )
      ).rows[0];
      if (!link)
        throw new AppError(400, "Ссылка истекла. Получите новую на сайте.");
      const a = await actorFor(link.user_id);
      if (
        (
          await c.query(
            "SELECT 1 FROM telegram_links WHERE telegram_id=$1 AND user_id<>$2",
            [telegramId, a.id],
          )
        ).rowCount
      )
        throw new AppError(409, "Telegram уже связан с другим сотрудником");
      await c.query(
        "UPDATE telegram_links SET telegram_id=$2,token_hash=NULL,expires_at=NULL WHERE user_id=$1",
        [a.id, telegramId],
      );
      await audit(
        c,
        a,
        "Telegram подключён",
        "user",
        a.id,
        null,
        {},
        "telegram",
      );
    });
    await botReply(
      telegramId,
      "Telegram подключён. Отправьте документ файлом, чтобы добавить его в дело.",
    );
    return;
  }
  const link = (
    await db.query("SELECT user_id FROM telegram_links WHERE telegram_id=$1", [
      telegramId,
    ])
  ).rows[0];
  if (!link) {
    await botReply(telegramId, "Подключите Telegram в профиле на сайте.");
    return;
  }
  const a = await actorFor(link.user_id);
  requirePermission(a, "can_upload_documents");
  if (text === "/cancel") {
    await db.query(
      "UPDATE telegram_uploads SET state='cancelled' WHERE user_id=$1 AND state NOT IN ('saved','cancelled')",
      [a.id],
    );
    await botReply(telegramId, "Загрузка отменена.");
    return;
  }
  if (msg?.photo) {
    await botReply(
      telegramId,
      "Для сохранения оригинала отправьте изображение как файл (документ), без сжатия.",
    );
    return;
  }
  if (msg?.document) {
    if (msg.document.file_size > 20 * 1024 * 1024) {
      await botReply(
        telegramId,
        "Файл превышает лимит Telegram-загрузки 20 МБ. Используйте сайт с допустимым размером файла.",
      );
      return;
    }
    const upload = await tx(async (c) => {
      const existing = (
        await c.query(
          "SELECT * FROM telegram_uploads WHERE update_id=$1 AND user_id=$2",
          [update.update_id, a.id],
        )
      ).rows[0];
      if (existing) return existing;
      await c.query(
        "UPDATE telegram_uploads SET state='cancelled' WHERE user_id=$1 AND state NOT IN ('saved','cancelled','queued') AND update_id<>$2",
        [a.id, update.update_id],
      );
      return (
        await c.query(
          "INSERT INTO telegram_uploads(user_id,update_id,file_id,filename) VALUES($1,$2,$3,$4) ON CONFLICT(update_id) DO UPDATE SET file_id=telegram_uploads.file_id RETURNING *",
          [
            a.id,
            update.update_id,
            msg.document.file_id,
            msg.document.file_name || "document",
          ],
        )
      ).rows[0];
    });
    if (upload.state === "case") await menu(a, telegramId, upload);
    return;
  }
  if (!cb) {
    const upload = (
      await db.query(
        "SELECT * FROM telegram_uploads WHERE user_id=$1 AND state='case' AND expires_at>now() ORDER BY expires_at DESC LIMIT 1",
        [a.id],
      )
    ).rows[0];
    if (upload && text) await menu(a, telegramId, upload, text);
    else
      await botReply(
        telegramId,
        "Отправьте файл для новой загрузки или выберите поле кнопками под последним файлом.",
      );
    return;
  }
  await telegram("answerCallbackQuery", { callback_query_id: cb.id });
  const [kind, session, value = "", groupPage = "0"] = String(cb.data).split(
    ":",
  );
  const uploadId = expand(session || "");
  if (!uploadId) {
    await botReply(telegramId, "Эти кнопки устарели. Отправьте файл заново.");
    return;
  }
  const response = await tx(async (c) => {
    const upload = (
      await c.query(
        "SELECT * FROM telegram_uploads WHERE id=$1 AND user_id=$2 AND expires_at>now() FOR UPDATE",
        [uploadId, a.id],
      )
    ).rows[0];
    if (!upload || ["saved", "cancelled", "queued"].includes(upload.state))
      return {
        text: "Этот файл уже отправлен или загрузка отменена. Используйте кнопки нового файла.",
      };
    const target = expand(value);
    if (kind === "case") {
      if (!target) throw new AppError(400, "Дело не выбрано");
      await requireCase(a, target, "can_upload_documents", c);
      await c.query(
        "UPDATE telegram_uploads SET case_id=$2,document_id=NULL,type=NULL,state='document' WHERE id=$1",
        [upload.id, target],
      );
      upload.case_id = target;
    }
    if (!upload.case_id) return { text: "Сначала выберите дело." };
    await requireCase(a, upload.case_id, "can_upload_documents", c);
    const rec = (
      await c.query(
        "SELECT c.number,cl.name FROM cases c JOIN clients cl ON cl.id=c.client_id WHERE c.id=$1",
        [upload.case_id],
      )
    ).rows[0];
    const context = `${rec.name} · CASE-${rec.number}\nФайл: ${upload.filename}\n`;
    const back = [
      button("← Группы документов", "case", upload, compact(upload.case_id)),
    ];
    if (kind === "case" || kind === "groups") {
      const page =
        kind === "groups" && /^\d{1,5}$/.test(value) ? Number(value) : 0;
      const groups = (
        await c.query(
          "SELECT id,name FROM document_groups WHERE case_id=$1 ORDER BY sort_order,id LIMIT 21 OFFSET $2",
          [upload.case_id, page * 20],
        )
      ).rows;
      return {
        text:
          context + "Выберите группу перечня документов или другие документы.",
        keyboard: {
          inline_keyboard: [
            ...groups
              .slice(0, 20)
              .map((g) => [button(g.name, "group", upload, compact(g.id))]),
            ...(page
              ? [[button("← Назад", "groups", upload, String(page - 1))]]
              : []),
            ...(groups.length > 20
              ? [[button("Далее →", "groups", upload, String(page + 1))]]
              : []),
            [button("Другие документы", "other", upload)],
            [button("Новый документ вне перечня", "new", upload)],
          ],
        },
      };
    }
    if (kind === "group" || kind === "other" || kind === "more") {
      const group =
        kind === "group" && target
          ? (
              await c.query(
                "SELECT * FROM document_groups WHERE id=$1 AND case_id=$2",
                [target, upload.case_id],
              )
            ).rows[0]
          : null;
      if (kind === "group" && !group)
        throw new AppError(404, "Группа недоступна");
      const page =
        kind === "group" && /^\d{1,5}$/.test(groupPage)
          ? Number(groupPage)
          : kind === "more" && /^\d{1,5}$/.test(value)
            ? Number(value)
            : 0;
      const docs = (
        await c.query(
          "SELECT id,name FROM documents WHERE case_id=$1 AND group_id IS NOT DISTINCT FROM $2::uuid AND NOT archived AND NOT is_output AND NOT finance_receipt ORDER BY field_order,created_at,id",
          [upload.case_id, group?.id || null],
        )
      ).rows;
      const shown = docs.slice(page * 20, page * 20 + 20);
      return {
        text:
          context +
          (group?.name || "Другие документы") +
          "\nВыберите поле — файл сохранится автоматически. Если файл уже есть, будет добавлена новая версия.",
        keyboard: {
          inline_keyboard: [
            ...shown.map((d) => [button(d.name, "doc", upload, compact(d.id))]),
            ...(group && page
              ? [
                  [
                    button(
                      "← Назад",
                      "group",
                      upload,
                      compact(group.id) + ":" + String(page - 1),
                    ),
                  ],
                ]
              : []),
            ...(group && docs.length > (page + 1) * 20
              ? [
                  [
                    button(
                      "Далее →",
                      "group",
                      upload,
                      compact(group.id) + ":" + String(page + 1),
                    ),
                  ],
                ]
              : []),
            ...(!group && page
              ? [[button("← Назад", "more", upload, String(page - 1))]]
              : []),
            ...(!group && docs.length > (page + 1) * 20
              ? [[button("Далее →", "more", upload, String(page + 1))]]
              : []),
            ...(!group ? [[button("Новый документ", "new", upload)]] : []),
            back,
          ],
        },
      };
    }
    if (kind === "new") {
      await c.query(
        "UPDATE telegram_uploads SET document_id=NULL,state='type' WHERE id=$1",
        [upload.id],
      );
      return {
        text:
          context +
          "Выберите тип — файл сохранится автоматически под своим именем.",
        keyboard: {
          inline_keyboard: [
            ...types.map(([_, label], index) => [
              button(label, "type", upload, String(index)),
            ]),
            back,
          ],
        },
      };
    }
    if (kind === "doc" || kind === "type") {
      let documentId: string | null = null;
      let type = "Other";
      let name = upload.filename;
      if (kind === "doc") {
        const doc = target
          ? (
              await c.query(
                "SELECT * FROM documents WHERE id=$1 AND case_id=$2 AND NOT archived AND NOT is_output AND NOT finance_receipt",
                [target, upload.case_id],
              )
            ).rows[0]
          : null;
        if (!doc) throw new AppError(404, "Документ недоступен");
        if (doc.group_id) {
          const wf = (
            await c.query(
              "SELECT w.state,c.status FROM case_workflows w JOIN cases c ON c.id=w.case_id WHERE w.case_id=$1",
              [upload.case_id],
            )
          ).rows[0];
          if (!wf || isClosedStatus(wf.status))
            throw new AppError(
              409,
              "Визовое дело закрыто для загрузки документов.",
            );
        }
        documentId = doc.id;
        name = doc.name;
      } else {
        if (!/^[0-3]$/.test(value))
          throw new AppError(400, "Выберите тип документа");
        type = types[Number(value)][0];
      }
      await c.query(
        "UPDATE telegram_uploads SET document_id=$2,type=$3,state='queued' WHERE id=$1",
        [upload.id, documentId, type],
      );
      await enqueue(
        c,
        "telegram_upload",
        { uploadId: upload.id },
        `tg-upload:${upload.id}`,
      );
      return {
        text:
          context + `Выбрано: ${name}. Загружаю файл. Сообщу после сохранения.`,
      };
    }
    return { text: "Выберите группу и документ кнопками под файлом." };
  });
  await botReply(telegramId, response.text, response.keyboard);
}

export async function performUpload(uploadId: string) {
  const u = (
    await db.query(
      "SELECT up.*,l.telegram_id FROM telegram_uploads up JOIN telegram_links l ON l.user_id=up.user_id WHERE up.id=$1",
      [uploadId],
    )
  ).rows[0];
  if (!u || !["queued", "saved"].includes(u.state)) return;
  const a = await actorFor(u.user_id);
  await requireCase(a, u.case_id, "can_upload_documents");
  let versionId = u.version_id;
  if (!versionId) {
    if (new Date(u.expires_at) < new Date())
      throw new AppError(410, "Время загрузки истекло");
    const file = await telegram("getFile", { file_id: u.file_id });
    const r = await fetch(
      `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`,
      { signal: AbortSignal.timeout(60000) },
    );
    if (!r.ok) throw new Error("Telegram file unavailable");
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = r.body!.getReader();
    while (true) {
      const v = await reader.read();
      if (v.done) break;
      size += v.value.length;
      if (size > 20 * 1024 * 1024) {
        await reader.cancel();
        throw new AppError(413, "Файл слишком большой");
      }
      chunks.push(v.value);
    }
    const version = await saveFile(a, {
      caseId: u.case_id,
      documentId: u.document_id || undefined,
      name: u.filename,
      type: u.type || "Other",
      filename: u.filename,
      bytes: Buffer.concat(chunks),
      source: "telegram",
      uploadId,
    });
    versionId = version.id;
  }
  if (u.telegram_id)
    await botReply(
      u.telegram_id,
      `Документ ${u.filename} сохранён. Ожидается проверка безопасности. Дополнительное подтверждение не требуется.`,
    );
}

import { z } from "zod";
import type { PoolClient } from "pg";
import { db, tx } from "./db";
import { AppError, audit, requirePermission, type Actor } from "./access";
import { telegram } from "./telegram";
type Connection = Pick<PoolClient, "query">;
export const chatIdSchema = z
  .string()
  .trim()
  .regex(/^-[1-9]\d{0,15}$/)
  .refine((v) => BigInt(v) >= -4503599627370495n, "Некорректный Chat ID");
const optionalId = z.union([chatIdSchema, z.literal("")]);
export type ChatDestinations = {
  workflowChatId: string;
  backupChatId: string;
  teamChatId: string;
  financeChatId: string;
  revision: number;
};
export async function telegramChatSettings(
  c: Connection = db,
): Promise<ChatDestinations> {
  const stored = (
    await c.query("SELECT value FROM system_settings WHERE id='telegram'")
  ).rows[0]?.value;
  return (
    stored || {
      workflowChatId: process.env.TELEGRAM_WORKFLOW_CHAT_ID || "-1004356519137",
      backupChatId: process.env.TELEGRAM_BACKUP_CHAT_ID || "",
      teamChatId: process.env.TELEGRAM_TEAM_CHAT_ID || "",
      financeChatId: process.env.TELEGRAM_FINANCE_CHAT_ID || "",
      revision: 0,
    }
  );
}
export function requireTelegramAdmin(a: Actor) {
  requirePermission(a, "can_manage_settings");
  if (a.role !== "Administrator")
    throw new AppError(
      403,
      "Этот раздел настроек доступен только администратору",
    );
}
export async function telegramSettingsData(a: Actor) {
  requireTelegramAdmin(a);
  const destinations = await telegramChatSettings(),
    general = (
      await db.query("SELECT value FROM system_settings WHERE id='general'")
    ).rows[0].value;
  const known = (
    await db.query("SELECT * FROM telegram_chats ORDER BY title,chat_id")
  ).rows;
  const ids = new Set([
    ...Object.entries(destinations)
      .filter(([k]) => k !== "revision")
      .map(([, v]) => v as string),
    ...(
      await db.query(
        "SELECT DISTINCT telegram_chat_id FROM workflow_archives WHERE telegram_chat_id IS NOT NULL",
      )
    ).rows.map((r) => r.telegram_chat_id),
  ]);
  for (const id of ids)
    if (id && !known.some((r) => r.chat_id === id))
      known.push({
        chat_id: id,
        title: "",
        type: "unknown",
        bot_status: "unknown",
      });
  return {
    destinations,
    catalog: known,
    backupEnabled: general.backupEnabled,
    teamEnabled: general.teamEnabled,
    botConfigured: !!process.env.TELEGRAM_BOT_TOKEN,
  };
}
export async function saveTelegramSettings(a: Actor, raw: unknown) {
  requireTelegramAdmin(a);
  const d = z
    .object({
      workflowChatId: chatIdSchema,
      backupChatId: optionalId,
      teamChatId: optionalId,
      financeChatId: optionalId,
      revision: z.number().int().min(0),
      backupEnabled: z.boolean(),
      teamEnabled: z.boolean(),
    })
    .parse(raw);
  if (d.backupEnabled && !d.backupChatId)
    throw new AppError(400, "Укажите чат резервных копий");
  if (d.teamEnabled && !d.teamChatId)
    throw new AppError(400, "Укажите чат событий команды");
  return tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(81826)");
    const old = await telegramChatSettings(c);
    if (old.revision !== d.revision)
      throw new AppError(
        409,
        "Telegram-настройки изменились. Обновите страницу",
      );
    const general = (
      await c.query(
        "SELECT value FROM system_settings WHERE id='general' FOR UPDATE",
      )
    ).rows[0].value;
    const value = {
      workflowChatId: d.workflowChatId,
      backupChatId: d.backupChatId,
      teamChatId: d.teamChatId,
      financeChatId: d.financeChatId,
      revision: old.revision + 1,
    };
    await c.query(
      "INSERT INTO system_settings(id,value) VALUES('telegram',$1) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      [JSON.stringify(value)],
    );
    await c.query("UPDATE system_settings SET value=$1 WHERE id='general'", [
      JSON.stringify({
        ...general,
        backupEnabled: d.backupEnabled,
        teamEnabled: d.teamEnabled,
      }),
    ]);
    for (const key of [
      d.workflowChatId,
      d.backupChatId,
      d.teamChatId,
      d.financeChatId,
    ])
      if (key)
        await c.query(
          "INSERT INTO telegram_chats(chat_id) VALUES($1) ON CONFLICT DO NOTHING",
          [key],
        );
    await audit(c, a, "Изменены Telegram-чаты", "settings", "telegram", null, {
      before: old,
      after: value,
      backupEnabled: d.backupEnabled,
      teamEnabled: d.teamEnabled,
    });
    return value;
  });
}
export async function recordTelegramChat(update: any, c: Connection = db) {
  const variants = [
    update.message,
    update.edited_message,
    update.channel_post,
    update.edited_channel_post,
    update.my_chat_member,
    update.callback_query?.message,
  ];
  for (const item of variants) {
    const chat = item?.chat;
    if (
      !chat ||
      !["group", "supergroup", "channel"].includes(chat.type) ||
      !chatIdSchema.safeParse(String(chat.id)).success
    )
      continue;
    const status =
      item === update.my_chat_member ? item.new_chat_member?.status : undefined;
    await c.query(
      "INSERT INTO telegram_chats(chat_id,type,title,username,bot_status) VALUES($1,$2,$3,$4,$5) ON CONFLICT(chat_id) DO UPDATE SET type=excluded.type,title=CASE WHEN excluded.title='' THEN telegram_chats.title ELSE excluded.title END,username=excluded.username,bot_status=CASE WHEN excluded.bot_status='unknown' THEN telegram_chats.bot_status ELSE excluded.bot_status END,updated_at=now()",
      [
        String(chat.id),
        chat.type,
        String(chat.title || "").slice(0, 250),
        String(chat.username || "").slice(0, 100),
        status || "unknown",
      ],
    );
  }
}
export async function checkTelegramChat(a: Actor, raw: unknown) {
  requireTelegramAdmin(a);
  const id = chatIdSchema.parse(
    z.object({ chat_id: z.string() }).parse(raw).chat_id,
  );
  if (!process.env.TELEGRAM_BOT_TOKEN)
    throw new AppError(503, "Telegram-бот ещё не настроен");
  let chat: any;
  try {
    chat = await telegram("getChat", { chat_id: id }, 15000);
  } catch (e) {
    if (["TimeoutError", "AbortError"].includes((e as Error).name))
      throw new AppError(
        504,
        "Telegram не ответил вовремя. Повторите проверку.",
      );
    throw new AppError(
      400,
      "Бот не видит этот чат. Проверьте ID и добавьте бота в группу или канал",
    );
  }
  if (
    String(chat.id) !== id ||
    !["group", "supergroup", "channel"].includes(chat.type)
  )
    throw new AppError(400, "Укажите ID группы или канала");
  await tx(async (c) => {
    await recordTelegramChat({ message: { chat } }, c);
    await audit(c, a, "Проверен Telegram-чат", "telegram_chat", id);
  });
  return {
    chat_id: id,
    title: chat.title || "",
    type: chat.type,
    username: chat.username || "",
  };
}

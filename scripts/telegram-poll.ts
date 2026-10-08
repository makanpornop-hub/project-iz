import "dotenv/config";
import { db } from "../src/lib/db";
import { telegram } from "../src/lib/telegram";
// Only acknowledge updates after they are durably stored. The existing worker processes them.
const lock = await db.connect();
let running = true;
process.on("SIGINT", () => {
  running = false;
});
process.on("SIGTERM", () => {
  running = false;
});
try {
  if (
    !(await lock.query("SELECT pg_try_advisory_lock(81824) AS ok")).rows[0].ok
  )
    throw new Error("Telegram receiver already running");
  const webhook = await telegram("getWebhookInfo", {});
  if (webhook.url)
    throw new Error(
      "Existing Telegram webhook must be reviewed before polling",
    );
  let offset =
    Number(
      (await db.query("SELECT coalesce(max(id),0) AS id FROM telegram_updates"))
        .rows[0].id,
    ) + 1;
  console.log("Telegram receiver started.");
  while (running) {
    try {
      const updates = await telegram("getUpdates", {
        offset,
        timeout: 20,
        limit: 100,
        allowed_updates: [
          "message",
          "callback_query",
          "edited_message",
          "channel_post",
          "edited_channel_post",
          "my_chat_member",
        ],
      });
      for (const update of updates) {
        if (!Number.isSafeInteger(update.update_id))
          throw new Error("Invalid update");
        await db.query(
          "INSERT INTO telegram_updates(id,body) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [update.update_id, JSON.stringify(update)],
        );
        offset = update.update_id + 1;
      }
    } catch {
      console.error("Telegram connection unavailable; retrying in 10 seconds.");
      await new Promise((r) => setTimeout(r, 10000));
    }
  }
} finally {
  lock.release();
  await db.end();
}

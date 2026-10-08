import "dotenv/config";
import { telegram } from "../src/lib/telegram";
const origin = process.env.BETTER_AUTH_URL,
  secret = process.env.TELEGRAM_WEBHOOK_SECRET;
if (
  !origin?.startsWith("https://") ||
  !secret ||
  !/^[-\w]{16,256}$/.test(secret)
)
  throw new Error(
    "HTTPS BETTER_AUTH_URL and a valid TELEGRAM_WEBHOOK_SECRET are required.",
  );
await telegram("setWebhook", {
  url: new URL("/api/telegram/webhook", origin).href,
  secret_token: secret,
  allowed_updates: [
    "message",
    "callback_query",
    "edited_message",
    "channel_post",
    "edited_channel_post",
    "my_chat_member",
  ],
  drop_pending_updates: false,
});
console.log("Telegram webhook configured. Token not printed.");

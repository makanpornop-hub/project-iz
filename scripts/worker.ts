import "dotenv/config";
import { tick } from "../src/lib/worker";
import { enqueue } from "../src/lib/service";
import { db } from "../src/lib/db";
let running = true;
let financeHour = "";
process.on("SIGINT", () => {
  running = false;
});
process.on("SIGTERM", () => {
  running = false;
});
console.log("Project Iz background worker started.");
while (running) {
  try {
    const hour = new Date().toISOString().slice(0, 13);
    if (hour !== financeHour) {
      await enqueue(db, "exchange_sync", {}, "exchange-hour:" + hour);
      await enqueue(db, "finance_check", {}, "finance-hour:" + hour);
      financeHour = hour;
    }
    const worked = await tick();
    if (!worked) await new Promise((r) => setTimeout(r, 1000));
  } catch {
    console.error("Worker iteration failed; retrying in 5 seconds.");
    await new Promise((r) => setTimeout(r, 5000));
  }
}
await db.end();

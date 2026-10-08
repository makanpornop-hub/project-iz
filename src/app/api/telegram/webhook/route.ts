import { boundedBody } from "@/lib/body";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
export async function POST(req: Request) {
  const provided = req.headers.get("x-telegram-bot-api-secret-token") || "",
    expected = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  if (
    !expected ||
    Buffer.byteLength(provided) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  )
    return new Response(null, { status: 401 });
  if (Number(req.headers.get("content-length")) > 65536)
    return new Response(null, { status: 413 });
  try {
    const update = JSON.parse((await boundedBody(req, 65536)).toString());
    if (!Number.isSafeInteger(update.update_id))
      return new Response(null, { status: 400 });
    await db.query(
      "INSERT INTO telegram_updates(id,body) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [update.update_id, JSON.stringify(update)],
    );
    return NextResponse.json({ ok: true });
  } catch {
    return new Response(null, { status: 503 });
  }
}

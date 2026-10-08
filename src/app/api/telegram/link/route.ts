import { NextResponse } from "next/server";
import { db, tx } from "@/lib/db";
import { AppError, currentActor, checkOrigin, audit } from "@/lib/access";
import { linkTelegram } from "@/lib/telegram";
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    return NextResponse.json({ url: await linkTelegram(await currentActor()) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof AppError ? e.message : "Ошибка подключения" },
      { status: e instanceof AppError ? e.status : 503 },
    );
  }
}
export async function DELETE(req: Request) {
  try {
    checkOrigin(req);
    const a = await currentActor();
    await tx(async (c) => {
      await c.query("DELETE FROM telegram_links WHERE user_id=$1", [a.id]);
      await c.query(
        "UPDATE telegram_uploads SET state='cancelled' WHERE user_id=$1 AND state<>'saved'",
        [a.id],
      );
      await audit(c, a, "Telegram отключён", "user", a.id);
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof AppError ? e.message : "Ошибка отключения" },
      { status: e instanceof AppError ? e.status : 503 },
    );
  }
}

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!process.env.DATABASE_URL || !process.env.BETTER_AUTH_SECRET)
    return NextResponse.json({ ready: false, reason: "configuration" });
  try {
    await db.query("SELECT 1 FROM schema_migrations LIMIT 1");
    const result = await db.query("SELECT 1 FROM staff LIMIT 1");
    return NextResponse.json({
      ready: !!result.rowCount,
      reason: result.rowCount ? null : "administrator",
    });
  } catch {
    return NextResponse.json({ ready: false, reason: "database" });
  }
}

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  AppError,
  currentActor,
  requireCase,
  audit,
  requirePermission,
} from "@/lib/access";
import { readObject } from "@/lib/storage";
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const a = await currentActor();
    const { rows } = await db.query(
      "SELECT v.*,d.case_id,d.finance_receipt FROM document_versions v JOIN documents d ON d.id=v.document_id WHERE v.id=$1",
      [(await ctx.params).id],
    );
    const v = rows[0];
    if (!v) throw new AppError(404, "Файл не найден");
    if (v.finance_receipt) requirePermission(a, "accounting.view");
    await requireCase(a, v.case_id, "can_download_documents");
    if (v.scan_status !== "clean")
      throw new AppError(409, "Файл ожидает проверки или заблокирован");
    const bytes = await readObject(v.storage_key);
    await requireCase(a, v.case_id, "can_download_documents");
    await audit(
      db,
      a,
      "Выдана версия для скачивания",
      "version",
      v.id,
      v.case_id,
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": v.mime,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(v.filename)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof AppError ? e.message : "Не удалось получить файл" },
      { status: e instanceof AppError ? e.status : 503 },
    );
  }
}

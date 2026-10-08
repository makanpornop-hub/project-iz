import { boundedBody } from "@/lib/body";
import { NextResponse } from "next/server";
import {
  AppError,
  checkOrigin,
  currentActor,
  limit,
  requireCase,
} from "@/lib/access";
import { saveFile } from "@/lib/storage";
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const a = await currentActor();
    await limit("receipt:" + a.id, 15);
    const raw = await boundedBody(req, 21 * 1024 * 1024);
    const form = await new Response(new Uint8Array(raw), {
      headers: { "Content-Type": req.headers.get("content-type") || "" },
    }).formData();
    const file = form.get("file"),
      caseId = String(form.get("case_id"));
    await requireCase(a, caseId, "accounting.view");
    if (!(file instanceof File) || file.size > 20 * 1024 * 1024)
      throw new AppError(400, "Выберите файл до 20 МБ");
    const v = await saveFile(a, {
      caseId,
      name: "Чек: " + file.name.slice(0, 230),
      type: "Other",
      filename: file.name,
      bytes: Buffer.from(await file.arrayBuffer()),
      source: "website",
      financeReceipt: true,
    });
    return NextResponse.json({ id: v.id, filename: v.filename });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof AppError ? e.message : "Не удалось загрузить чек" },
      { status: e instanceof AppError ? e.status : 503 },
    );
  }
}

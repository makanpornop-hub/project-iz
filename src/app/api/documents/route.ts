import { boundedBody } from "@/lib/body";
import { NextResponse } from "next/server";
import { AppError, checkOrigin, currentActor, limit } from "@/lib/access";
import { saveFile } from "@/lib/storage";
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const a = await currentActor();
    await limit(`upload:${a.id}`, 15);
    if (Number(req.headers.get("content-length")) > 21 * 1024 * 1024)
      throw new AppError(413, "Файл слишком большой");
    const raw = await boundedBody(req, 21 * 1024 * 1024);
    const f = await new Response(new Uint8Array(raw), {
        headers: { "Content-Type": req.headers.get("content-type") || "" },
      }).formData(),
      file = f.get("file");
    if (!(file instanceof File) || file.size > 20 * 1024 * 1024)
      throw new AppError(400, "Выберите файл до 20 МБ");
    const result = await saveFile(a, {
      caseId: String(f.get("case_id")),
      documentId: String(f.get("document_id") || "") || undefined,
      name: String(f.get("name") || file.name),
      type: String(f.get("type")),
      filename: file.name,
      bytes: Buffer.from(await file.arrayBuffer()),
      source: "website",
    });
    return NextResponse.json({ id: result.id, version: result.version });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof AppError
            ? e.message
            : "Не удалось сохранить файл. Проверьте подключение хранилища.",
      },
      { status: e instanceof AppError ? e.status : 503 },
    );
  }
}

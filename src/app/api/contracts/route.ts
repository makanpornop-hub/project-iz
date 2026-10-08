import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AppError,
  currentActor,
  checkOrigin,
  limit,
  requirePermission,
} from "@/lib/access";
import {
  currentContractTemplate,
  importContractTemplate,
  previewContract,
  downloadContract,
  templateDownload,
  docxMime,
} from "@/lib/contracts";
function file(result: { bytes: Buffer; filename: string }) {
  return new Response(new Uint8Array(result.bytes), {
    headers: {
      "Content-Type": docxMime,
      "Content-Disposition":
        "attachment; filename*=UTF-8''" + encodeURIComponent(result.filename),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
function failure(e: unknown) {
  return NextResponse.json(
    {
      error:
        e instanceof AppError
          ? e.message
          : e instanceof z.ZodError
            ? "Проверьте ФИО клиента и условия оплаты"
            : "Не удалось создать договор",
    },
    {
      status:
        e instanceof AppError ? e.status : e instanceof z.ZodError ? 400 : 503,
    },
  );
}
export async function GET(req: Request) {
  try {
    const a = await currentActor(),
      p = new URL(req.url).searchParams;
    if (p.get("case_id"))
      return file(
        await downloadContract(a, z.string().uuid().parse(p.get("case_id"))),
      );
    if (p.get("download") === "template")
      return file(await templateDownload(a));
    requirePermission(
      a,
      a.role === "Administrator" ? "can_manage_settings" : "can_create_cases",
    );
    const t = await currentContractTemplate();
    return NextResponse.json(
      t
        ? {
            id: t.id,
            filename: t.filename,
            size: t.size,
            created_at: t.created_at,
          }
        : null,
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const a = await currentActor();
    await limit("contracts:" + a.id, 15);
    if (req.headers.get("content-type")?.includes("multipart/form-data")) {
      if (a.role !== "Administrator")
        throw new AppError(
          403,
          "Шаблон договора может изменить только администратор",
        );
      if (Number(req.headers.get("content-length") || 0) > 6 * 1024 * 1024)
        throw new AppError(413, "Шаблон DOCX должен быть не больше 5 МБ");
      const data = await req.formData(),
        upload = data.get("file");
      if (!(upload instanceof File) || upload.size > 5 * 1024 * 1024)
        throw new AppError(400, "Загрузите шаблон DOCX до 5 МБ");
      return NextResponse.json(
        await importContractTemplate(
          a,
          upload.name,
          Buffer.from(await upload.arrayBuffer()),
        ),
      );
    }
    return file(await previewContract(a, await req.json()));
  } catch (e) {
    return failure(e);
  }
}

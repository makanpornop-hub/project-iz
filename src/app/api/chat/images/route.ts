import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError, checkOrigin, currentActor, limit } from "@/lib/access";
import { boundedBody } from "@/lib/body";
import { saveChatImage } from "@/lib/chat-images";
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const actor = await currentActor();
    await limit("chat-image:" + actor.id, 15);
    const raw = await boundedBody(req, 21 * 1024 * 1024);
    const form = await new Response(new Uint8Array(raw), {
      headers: { "Content-Type": req.headers.get("content-type") || "" },
    }).formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size > 20 * 1024 * 1024)
      throw new AppError(400, "Выберите файл до 20 МБ");
    return NextResponse.json(
      await saveChatImage(
        actor,
        {
          case_id: form.get("case_id") || undefined,
          room_id: form.get("room_id") || undefined,
          request_id: form.get("request_id"),
        },
        Buffer.from(await file.arrayBuffer()),
        file.name,
      ),
    );
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof AppError
            ? e.message
            : e instanceof ZodError
              ? "Проверьте поля формы"
              : "Не удалось загрузить фото. Попробуйте ещё раз.",
      },
      {
        status:
          e instanceof AppError ? e.status : e instanceof ZodError ? 400 : 503,
      },
    );
  }
}

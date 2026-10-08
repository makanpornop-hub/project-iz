import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError, currentActor } from "@/lib/access";
import { readChatImage } from "@/lib/chat-images";
import { readObject } from "@/lib/storage";
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await currentActor();
    const { id } = await ctx.params;
    const image = await readChatImage(actor, id);
    const bytes = await readObject(image.storage_key);
    await readChatImage(actor, id);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": image.mime,
        "Content-Length": String(bytes.length),
        "Content-Disposition":
          (new URL(req.url).searchParams.has("download")
            ? "attachment"
            : "inline") +
          "; filename*=UTF-8''" +
          encodeURIComponent(image.filename),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof AppError ? e.message : "Фото недоступно" },
      {
        status:
          e instanceof AppError ? e.status : e instanceof ZodError ? 400 : 503,
      },
    );
  }
}

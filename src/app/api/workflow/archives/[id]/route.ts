import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError, currentActor } from "@/lib/access";
import { downloadWorkflowArchive } from "@/lib/workflow-archive";
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const a = await currentActor();
    const id = z
      .string()
      .uuid()
      .parse((await ctx.params).id);
    const { archive, bytes } = await downloadWorkflowArchive(a, id);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(archive.filename)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof AppError ? e.message : "Не удалось получить архив",
      },
      { status: e instanceof AppError ? e.status : 503 },
    );
  }
}

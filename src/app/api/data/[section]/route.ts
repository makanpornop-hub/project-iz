import { boundedBody } from "@/lib/body";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError, currentActor, checkOrigin, limit } from "@/lib/access";
import { getData, mutate } from "@/lib/service";
export const dynamic = "force-dynamic";
function failure(e: unknown) {
  if (e instanceof AppError)
    return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof ZodError)
    return NextResponse.json(
      { error: "Проверьте поля формы", fields: e.flatten() },
      { status: 400 },
    );
  console.error("Request failed", e instanceof Error ? e.name : "Unknown");
  return NextResponse.json(
    { error: "Операция не выполнена. Проверьте подключение и повторите." },
    { status: 503 },
  );
}
export async function GET(
  req: Request,
  ctx: { params: Promise<{ section: string }> },
) {
  try {
    const a = await currentActor();
    return NextResponse.json(
      await getData(
        a,
        (await ctx.params).section,
        new URL(req.url).searchParams,
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const a = await currentActor();
    await limit(`write:${a.id}`);
    if (Number(req.headers.get("content-length")) > 64000)
      throw new AppError(413, "Запрос слишком большой");
    return NextResponse.json(
      await mutate(a, JSON.parse((await boundedBody(req, 64000)).toString())),
    );
  } catch (e) {
    return failure(e);
  }
}

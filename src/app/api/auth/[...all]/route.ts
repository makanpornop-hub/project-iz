import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";
import { NextResponse } from "next/server";
async function handle(request: Request) {
  if (!process.env.BETTER_AUTH_SECRET || !process.env.BETTER_AUTH_URL)
    return NextResponse.json(
      { error: "Авторизация не настроена" },
      { status: 503 },
    );
  return toNextJsHandler(getAuth()).POST(request);
}
export const GET = handle;
export const POST = handle;

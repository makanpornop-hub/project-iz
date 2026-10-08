import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { currentActor, checkOrigin, AppError, limit } from "@/lib/access";
import { boundedBody } from "@/lib/body";
import { workflowAction, WorkflowValidationError } from "@/lib/workflow";
import { mergeGroup } from "@/lib/merge-documents";
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const actor = await currentActor();
    await limit("workflow:" + actor.id, 40);
    const body = JSON.parse((await boundedBody(req, 64000)).toString());
    return NextResponse.json(
      body.action === "workflow.merge"
        ? await mergeGroup(actor, body.data)
        : await workflowAction(actor, body),
    );
  } catch (e) {
    return NextResponse.json(
      {
        issues: e instanceof WorkflowValidationError ? e.issues : undefined,
        error:
          e instanceof AppError
            ? e.message
            : e instanceof ZodError
              ? "Проверьте поля формы"
              : "Операция не выполнена. Повторите попытку.",
      },
      {
        status:
          e instanceof AppError ? e.status : e instanceof ZodError ? 400 : 503,
      },
    );
  }
}

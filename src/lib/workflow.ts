import { isClosedStatus } from "./domain";
import { randomUUID } from "node:crypto";
import { workflowIssues, type WorkflowIssue } from "./workflow-validation";
import type { PoolClient } from "pg";
import { z } from "zod";
import { db, tx } from "./db";
import {
  AppError,
  requireCase,
  requirePermission,
  audit,
  type Actor,
} from "./access";
import { enqueue, schedule, settings } from "./service";
import { parseCaseCheckDate, scheduleCaseFollowup } from "./case-followup";
import {
  spainGroups,
  criminalFields,
  type GroupTemplate,
} from "./spain-template";
type Connection = Pick<PoolClient, "query">;

async function setWorkflowCaseStage(
  c: Connection,
  a: Actor,
  caseId: string,
  status: string,
) {
  const old = (
    await c.query("SELECT status FROM cases WHERE id=$1 FOR UPDATE", [caseId])
  ).rows[0];
  if (old.status === status) return;
  const rec = (
    await c.query(
      "UPDATE cases SET status=$2,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",
      [caseId, status],
    )
  ).rows[0];
  await schedule(c as PoolClient, "case", rec);
  await audit(
    c,
    a,
    "Этап дела изменён по перечню документов",
    "case",
    caseId,
    caseId,
    { from: old.status, to: status },
  );
}

export async function addGroup(
  c: Connection,
  caseId: string,
  g: GroupTemplate,
) {
  const group = (
    await c.query(
      "INSERT INTO document_groups(case_id,name,kind,sort_order) SELECT $1,$2,$3,coalesce(max(sort_order),0)+1 FROM document_groups WHERE case_id=$1 RETURNING *",
      [caseId, g.name, g.kind || "custom"],
    )
  ).rows[0];
  for (const [index, f] of g.fields.entries())
    await c.query(
      "INSERT INTO documents(case_id,type,name,group_id,merge_order,required,field_order) VALUES($1,'Other',$2,$3,$4,$5,$6)",
      [
        caseId,
        f.name,
        group.id,
        f.merge_order || null,
        f.required !== false,
        index,
      ],
    );
  await c.query(
    "INSERT INTO documents(case_id,type,name,group_id,is_output,required) VALUES($1,'Other','Объединённый файл',$2,true,false)",
    [caseId, group.id],
  );
  return group;
}
export async function initializeSpain(c: PoolClient, a: Actor, rec: any) {
  const createTask = async (title: string, deadline: Date | null) =>
    (
      await c.query(
        "INSERT INTO tasks(case_id,title,responsible_id,escalation_id,deadline,creator_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
        [rec.id, title, rec.responsible_id, rec.escalation_id, deadline, a.id],
      )
    ).rows[0];
  const ticket = await createTask("Назначить дату билета в Испанию", null);
  const docs = await createTask("Собрать перечень документов", null);
  await schedule(c, "task", ticket);
  await c.query("INSERT INTO case_workflows(case_id,task_id) VALUES($1,$2)", [
    rec.id,
    docs.id,
  ]);
  for (const g of spainGroups) await addGroup(c, rec.id, g);
  await audit(
    c,
    a,
    "Созданы задачи и перечень документов ВНЖ Испания",
    "case",
    rec.id,
    rec.id,
  );
}
export async function workflowData(caseId: string, c: Connection = db) {
  const wf = (
    await c.query("SELECT * FROM case_workflows WHERE case_id=$1", [caseId])
  ).rows[0];
  if (!wf) return null;
  const groups = (
    await c.query(
      "SELECT * FROM document_groups WHERE case_id=$1 ORDER BY sort_order,id",
      [caseId],
    )
  ).rows;
  const docs = (
    await c.query(
      "SELECT d.*,(SELECT count(*)::int FROM case_chat_threads ct WHERE ct.document_id=d.id AND ct.status<>'closed') open_issues,row_to_json(v) latest FROM documents d LEFT JOIN LATERAL (SELECT id,version,filename,scan_status,review_status,source_version_ids,size FROM document_versions WHERE document_id=d.id ORDER BY version DESC LIMIT 1) v ON true WHERE d.case_id=$1 AND d.group_id IS NOT NULL ORDER BY d.field_order,d.created_at,d.id",
      [caseId],
    )
  ).rows;
  return {
    ...wf,
    archive:
      (
        await c.query(
          "SELECT a.id,a.filename,a.size,a.file_count,a.created_at,a.telegram_sent_at,j.status telegram_status FROM workflow_archives a LEFT JOIN jobs j ON j.dedupe_key='workflow-archive:'||a.id::text WHERE a.case_id=$1 ORDER BY a.created_at DESC,a.id DESC LIMIT 1",
          [caseId],
        )
      ).rows[0] || null,
    groups: groups.map((g) => ({
      ...g,
      fields: docs.filter((d) => d.group_id === g.id && !d.is_output),
      output: docs.find((d) => d.group_id === g.id && d.is_output),
    })),
  };
}
export async function lockWorkflow(
  c: Connection,
  a: Actor,
  caseId: string,
  edit = true,
) {
  await c.query("SELECT id FROM cases WHERE id=$1 FOR UPDATE", [caseId]);
  const rec = await requireCase(
    a,
    caseId,
    edit ? "can_upload_documents" : "can_view_cases",
    c,
  );
  if (isClosedStatus(rec.status))
    throw new AppError(409, "Сначала откройте дело");
  const wf = (
    await c.query("SELECT * FROM case_workflows WHERE case_id=$1 FOR UPDATE", [
      caseId,
    ])
  ).rows[0];
  if (!wf) throw new AppError(404, "Перечень документов не найден");
  if (edit && ["submitted", "approved"].includes(wf.state)) {
    await c.query(
      "UPDATE case_workflows SET state='draft',reviewed_by=NULL,reviewed_at=NULL,review_note='',revision=revision+1 WHERE case_id=$1",
      [caseId],
    );
    const task = (
      await c.query(
        "UPDATE tasks SET status='In progress',completed_at=NULL,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",
        [wf.task_id],
      )
    ).rows[0];
    if (task) await schedule(c as PoolClient, "task", task);
    await audit(
      c,
      a,
      "Документы изменяются после отправки",
      "case",
      caseId,
      caseId,
      { previous_state: wf.state },
    );
    if (["Under review", "Ready for submission"].includes(rec.status))
      await setWorkflowCaseStage(c, a, caseId, "Documents collecting");
    wf.state = "draft";
    wf.revision++;
  }
  return wf;
}
export function mergeFresh(group: any) {
  const sources = group.fields
    .filter((f: any) => f.merge_order)
    .sort((a: any, b: any) => a.merge_order - b.merge_order);
  if (!sources.length) return true;
  const ids = sources.map((f: any) => f.latest?.id);
  return (
    ids.every(Boolean) &&
    JSON.stringify(ids) ===
      JSON.stringify(group.output?.latest?.source_version_ids)
  );
}
export class WorkflowValidationError extends AppError {
  constructor(public issues: WorkflowIssue[]) {
    super(409, issues[0].message);
  }
}
export function checkComplete(wf: any, approved = false) {
  const issues = workflowIssues(wf);
  if (issues.length) throw new WorkflowValidationError(issues);
  for (const g of wf.groups) {
    for (const f of g.fields) {
      if (approved && f.latest && f.latest.review_status !== "Approved")
        throw new AppError(409, g.name + ": подтвердите «" + f.name + "»");
      if (f.required && !f.latest)
        throw new AppError(409, g.name + ": загрузите «" + f.name + "»");
      if (f.latest && f.latest.scan_status !== "clean")
        throw new AppError(
          409,
          g.name + ": дождитесь успешной проверки «" + f.name + "»",
        );
    }
    if (
      approved &&
      g.fields.some((f: any) => f.merge_order) &&
      g.output?.latest?.review_status !== "Approved"
    )
      throw new AppError(409, g.name + ": подтвердите объединённый файл");
    if (
      g.fields.some((f: any) => f.merge_order) &&
      (!mergeFresh(g) || g.output?.latest?.scan_status !== "clean")
    )
      throw new AppError(
        409,
        g.name +
          ": объедините актуальные документы и дождитесь проверки результата",
      );
  }
}
async function notify(
  c: Connection,
  userId: string,
  caseId: string,
  title: string,
  message: string,
  key: string,
) {
  const n = (
    await c.query(
      "INSERT INTO notifications(user_id,case_id,title,message,dedupe_key) VALUES($1,$2,$3,$4,$5) ON CONFLICT(dedupe_key) DO UPDATE SET dedupe_key=EXCLUDED.dedupe_key RETURNING id",
      [userId, caseId, title, message, key],
    )
  ).rows[0];
  await enqueue(
    c,
    "notification",
    { notificationId: n.id },
    "delivery:" + n.id,
  );
}
export async function workflowAction(a: Actor, raw: unknown) {
  const { action, data } = z
    .object({ action: z.string(), data: z.any() })
    .parse(raw);
  const caseId = z.string().uuid().parse(data.case_id);
  let archiveKey: string | null = null;
  try {
    return await tx(async (c) => {
      const review =
        action === "workflow.review" || action === "workflow.approveGroup";
      const wf = await lockWorkflow(
        c,
        a,
        caseId,
        !review && !["workflow.submit", "workflow.reschedule"].includes(action),
      );
      if (action === "workflow.approveGroup") {
        if (a.role !== "Administrator")
          throw new AppError(
            403,
            "Документы перечня подтверждает администратор",
          );
        requirePermission(a, "can_review_documents");
        const d = z
          .object({
            group_id: z.string().uuid(),
            version_ids: z.array(z.string().uuid()).min(1).max(300),
          })
          .parse(data);
        const group = (await workflowData(caseId, c)).groups.find(
          (g: any) => g.id === d.group_id,
        );
        if (!group) throw new AppError(404, "Группа не найдена");
        const versions = [...group.fields, group.output]
          .filter(Boolean)
          .map((f: any) => f.latest)
          .filter(Boolean);
        const ids = versions.map((v: any) => v.id).sort();
        if (JSON.stringify(ids) !== JSON.stringify([...d.version_ids].sort()))
          throw new AppError(
            409,
            "Документы изменились. Обновите перечень перед подтверждением",
          );
        if (versions.some((v: any) => v.scan_status !== "clean"))
          throw new AppError(
            409,
            "Дождитесь успешной проверки безопасности всех файлов группы",
          );
        if (group.output?.latest && !mergeFresh(group))
          throw new AppError(
            409,
            "Сначала объедините актуальные документы группы",
          );
        for (const v of versions.filter(
          (v: any) => v.review_status !== "Approved",
        )) {
          await c.query(
            "UPDATE document_versions SET review_status='Approved',reviewed_by=$2,reviewed_at=now() WHERE id=$1",
            [v.id, a.id],
          );
          await audit(
            c,
            a,
            "Документ подтверждён в группе",
            "version",
            v.id,
            caseId,
            { group_id: group.id, status: "Approved", bulk: true },
          );
        }
        return { ok: true };
      }
      if (action === "workflow.group") {
        const d = z
          .object({
            id: z.string().uuid().optional(),
            name: z.string().trim().min(1).max(250),
            notes: z.string().max(10000).default(""),
            stamp: z.boolean().nullable().optional(),
            fields: z
              .array(
                z.object({
                  id: z.string().uuid().optional(),
                  name: z.string().trim().min(1).max(250),
                  required: z.boolean().default(true),
                  merge_order: z
                    .number()
                    .int()
                    .min(1)
                    .max(100)
                    .nullable()
                    .default(null),
                }),
              )
              .min(1)
              .max(100),
          })
          .parse(data);
        const orders = d.fields.map((f) => f.merge_order).filter(Boolean);
        if (new Set(orders).size !== orders.length)
          throw new AppError(
            400,
            "Номера порядка объединения должны быть разными",
          );
        let gid = d.id;
        if (gid) {
          const old = (
            await c.query(
              "SELECT * FROM document_groups WHERE id=$1 AND case_id=$2",
              [gid, caseId],
            )
          ).rows[0];
          if (!old) throw new AppError(404, "Группа не найдена");
          const existing = (
            await c.query(
              "SELECT id FROM documents WHERE group_id=$1 AND NOT is_output",
              [gid],
            )
          ).rows.map((x) => x.id);
          if (existing.some((id) => !d.fields.some((f) => f.id === id)))
            throw new AppError(
              400,
              "Существующие поля нельзя удалять; можно сделать их необязательными",
            );
          if (d.fields.some((f) => f.id && !existing.includes(f.id)))
            throw new AppError(400, "Поле не принадлежит группе");
          if (
            new Set(d.fields.filter((f) => f.id).map((f) => f.id)).size !==
            d.fields.filter((f) => f.id).length
          )
            throw new AppError(400, "Повтор поля");
          await c.query(
            "UPDATE document_groups SET name=$2,notes=$3,stamp=$4 WHERE id=$1",
            [gid, d.name, d.notes, d.stamp ?? old.stamp],
          );
        } else {
          if (d.fields.some((f) => f.id))
            throw new AppError(400, "Неверные поля новой группы");
          gid = (await addGroup(c, caseId, { name: d.name, fields: [] })).id;
          await c.query("UPDATE document_groups SET notes=$2 WHERE id=$1", [
            gid,
            d.notes,
          ]);
        }
        for (const [index, f] of d.fields.entries()) {
          if (f.id)
            await c.query(
              "UPDATE documents SET name=$2,required=$3,merge_order=$4,field_order=$5 WHERE id=$1",
              [f.id, f.name, f.required, f.merge_order, index],
            );
          else
            await c.query(
              "INSERT INTO documents(case_id,type,name,group_id,required,merge_order,field_order) VALUES($1,'Other',$2,$3,$4,$5,$6)",
              [caseId, f.name, gid, f.required, f.merge_order, index],
            );
        }
        await c.query(
          "UPDATE case_workflows SET revision=revision+1 WHERE case_id=$1",
          [caseId],
        );
        await audit(
          c,
          a,
          "Группа документов сохранена",
          "document_group",
          gid!,
          caseId,
        );
      } else if (action === "workflow.criminal") {
        const count = Number(
          (
            await c.query(
              "SELECT count(*) FROM document_groups WHERE case_id=$1 AND kind='criminal'",
              [caseId],
            )
          ).rows[0].count,
        );
        await addGroup(c, caseId, {
          name: "Справка о несудимости" + (count + 1),
          kind: "criminal",
          fields: criminalFields(),
        });
        await c.query(
          "UPDATE case_workflows SET revision=revision+1 WHERE case_id=$1",
          [caseId],
        );
        await audit(
          c,
          a,
          "Добавлена справка о несудимости",
          "case",
          caseId,
          caseId,
        );
      } else if (action === "workflow.notes") {
        const d = z
          .object({ group_id: z.string().uuid(), notes: z.string().max(10000) })
          .parse(data);
        const result = await c.query(
          "UPDATE document_groups SET notes=$3 WHERE id=$1 AND case_id=$2 RETURNING id",
          [d.group_id, caseId, d.notes],
        );
        if (!result.rowCount) throw new AppError(404, "Группа не найдена");
        await c.query(
          "UPDATE case_workflows SET revision=revision+1 WHERE case_id=$1",
          [caseId],
        );
        await audit(
          c,
          a,
          "Заметки группы изменены",
          "document_group",
          d.group_id,
          caseId,
        );
      } else if (action === "workflow.stamp") {
        const d = z
          .object({
            group_id: z.string().uuid(),
            stamp: z.boolean().nullable(),
          })
          .parse(data);
        const result = await c.query(
          "UPDATE document_groups SET stamp=$3 WHERE id=$1 AND case_id=$2 AND kind='business' RETURNING id",
          [d.group_id, caseId, d.stamp],
        );
        if (!result.rowCount) throw new AppError(404, "Группа ИП не найдена");
        await c.query(
          "UPDATE case_workflows SET revision=revision+1 WHERE case_id=$1",
          [caseId],
        );
        await audit(
          c,
          a,
          "Отметка печати изменена",
          "document_group",
          d.group_id,
          caseId,
        );
      } else if (action === "workflow.reschedule") {
        const d = z
          .object({
            check_date: z.string(),
            revision: z.number().int().positive(),
          })
          .parse(data);
        const current = (
          await c.query("SELECT * FROM case_followups WHERE case_id=$1", [
            caseId,
          ])
        ).rows[0];
        if (!current)
          throw new AppError(404, "Сначала завершите сбор документов");
        if (current.revision !== d.revision)
          throw new AppError(
            409,
            "Дата проверки изменилась. Обновите страницу",
          );
        await scheduleCaseFollowup(
          c,
          a,
          caseId,
          current.archive_id,
          d.check_date,
        );
      } else if (action === "workflow.submit") {
        requirePermission(a, "can_upload_documents");
        const { check_date } = z.object({ check_date: z.string() }).parse(data);
        parseCaseCheckDate(check_date, (await settings(c)).timezone);
        if (["submitted", "approved"].includes(wf.state)) {
          const existing = (
            await c.query(
              "SELECT id,telegram_sent_at FROM workflow_archives WHERE case_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",
              [caseId],
            )
          ).rows[0];
          if (existing) {
            if (!existing.telegram_sent_at) {
              await c.query(
                "UPDATE workflow_archives SET telegram_chat_id=COALESCE(telegram_chat_id,$2) WHERE id=$1",
                [
                  existing.id,
                  (
                    await (
                      await import("./telegram-settings")
                    ).telegramChatSettings(c)
                  ).workflowChatId,
                ],
              );
              await enqueue(
                c,
                "workflow_archive",
                { archiveId: existing.id },
                "workflow-archive:" + existing.id,
              );
              await c.query(
                "UPDATE jobs SET status='pending',attempts=0,last_error=NULL,locked_at=NULL,run_at=now() WHERE dedupe_key=$1 AND status IN ('failed','cancelled')",
                ["workflow-archive:" + existing.id],
              );
            }
            await scheduleCaseFollowup(c, a, caseId, existing.id, check_date);
            if (wf.state === "submitted")
              await setWorkflowCaseStage(c, a, caseId, "Under review");
            return { ok: true };
          }
        }
        const full = await workflowData(caseId, c);
        checkComplete(full);
        archiveKey = randomUUID();
        const { createWorkflowArchive } = await import("./workflow-archive");
        const archive = await createWorkflowArchive(c, full, archiveKey);
        await scheduleCaseFollowup(c, a, caseId, archive.id, check_date);
        const chatId = (
          await (await import("./telegram-settings")).telegramChatSettings(c)
        ).workflowChatId;
        await c.query(
          "UPDATE workflow_archives SET telegram_chat_id=$2 WHERE id=$1",
          [archive.id, chatId],
        );
        await enqueue(
          c,
          "workflow_archive",
          { archiveId: archive.id },
          "workflow-archive:" + archive.id,
        );
        await c.query(
          "UPDATE case_workflows SET state='submitted',submitted_by=$2,submitted_at=now(),review_note='' WHERE case_id=$1",
          [caseId, a.id],
        );
        await c.query(
          "UPDATE tasks SET status='In progress',completed_at=NULL,revision=revision+1,updated_at=now() WHERE id=$1",
          [wf.task_id],
        );
        await setWorkflowCaseStage(c, a, caseId, "Under review");
        const admins = (
          await c.query(
            "SELECT user_id FROM staff WHERE active AND role_id='Administrator'",
          )
        ).rows;
        for (const admin of admins)
          await notify(
            c,
            admin.user_id,
            caseId,
            "Документы готовы к проверке",
            "Задача «Собрать перечень документов» ожидает вашего одобрения.",
            "workflow-submit:" +
              caseId +
              ":" +
              wf.revision +
              ":" +
              admin.user_id,
          );
        await audit(
          c,
          a,
          "Документы отправлены администратору на проверку",
          "case",
          caseId,
          caseId,
        );
      } else if (review) {
        if (a.role !== "Administrator")
          throw new AppError(403, "Проверка доступна только администратору");
        const d = z
          .object({
            decision: z.enum(["approve", "reject"]),
            revision: z.number().int(),
            note: z.string().trim().max(10000).default(""),
          })
          .parse(data);
        if (wf.revision !== d.revision)
          throw new AppError(409, "Пакет изменился. Обновите страницу");
        if (d.decision === "approve" && wf.state !== "submitted")
          throw new AppError(409, "Пакет ещё не отправлен на проверку");
        if (
          d.decision === "reject" &&
          !["submitted", "approved"].includes(wf.state)
        )
          throw new AppError(409, "Пакет уже доступен для работы");
        if (d.decision === "reject" && !d.note)
          throw new AppError(400, "Укажите причину возврата");
        if (d.decision === "approve")
          checkComplete(await workflowData(caseId, c), true);
        await c.query(
          "UPDATE case_workflows SET state=$2,reviewed_by=$3,reviewed_at=now(),review_note=$4,revision=revision+1 WHERE case_id=$1",
          [
            caseId,
            d.decision === "approve" ? "approved" : "rejected",
            a.id,
            d.note,
          ],
        );
        const task = (
          await c.query(
            "UPDATE tasks SET status=$2,completed_at=CASE WHEN $2='Completed' THEN now() ELSE NULL END,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",
            [
              wf.task_id,
              d.decision === "approve" ? "Completed" : "In progress",
            ],
          )
        ).rows[0];
        await schedule(c, "task", task);
        await setWorkflowCaseStage(
          c,
          a,
          caseId,
          d.decision === "approve"
            ? "Ready for submission"
            : "Documents collecting",
        );
        await notify(
          c,
          task.responsible_id,
          caseId,
          d.decision === "approve"
            ? "Документы одобрены"
            : "Документы возвращены на доработку",
          d.note || "Администратор проверил пакет. Задача завершена.",
          "workflow-review:" + caseId + ":" + wf.revision + ":" + d.decision,
        );
        await audit(
          c,
          a,
          d.decision === "approve"
            ? "Пакет документов одобрен"
            : "Пакет возвращён на доработку",
          "case",
          caseId,
          caseId,
          { note: d.note },
        );
      } else throw new AppError(400, "Неизвестная операция");
      return { ok: true };
    });
  } catch (e) {
    if (archiveKey) {
      try {
        const { deleteObject } = await import("./storage");
        await deleteObject(archiveKey);
      } catch {
        await enqueue(
          db,
          "delete_object",
          { key: archiveKey },
          "delete:" + archiveKey,
        );
      }
    }
    throw e;
  }
}

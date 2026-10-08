import { isClosedStatus } from "./domain";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import { db, tx } from "./db";
import {
  AppError,
  audit,
  requireCase,
  requirePermission,
  type Actor,
} from "./access";
import { parseDeadline } from "./domain";
import { settings } from "./service";
import { requireChatImage } from "./chat-images";
type Connection = Pick<PoolClient, "query">;
const uuid = z.string().uuid();
const messageId = z.string().regex(/^[1-9][0-9]{0,17}$/);
export async function chatMembers(caseId: string, c: Connection = db) {
  return (
    await c.query(
      "SELECT u.id,u.name,s.role_id role FROM \"user\" u JOIN staff s ON s.user_id=u.id JOIN cases cs ON cs.id=$1 WHERE s.active AND EXISTS(SELECT 1 FROM role_permissions rp WHERE rp.role_id=s.role_id AND rp.permission_id='can_view_cases') AND (EXISTS(SELECT 1 FROM role_permissions rp WHERE rp.role_id=s.role_id AND rp.permission_id='can_view_all_cases') OR cs.responsible_id=u.id OR cs.escalation_id=u.id OR EXISTS(SELECT 1 FROM tasks t WHERE t.case_id=cs.id AND t.status<>'Completed' AND (t.responsible_id=u.id OR t.escalation_id=u.id))) ORDER BY u.name",
      [caseId],
    )
  ).rows;
}
export async function chatUnread(a: Actor, caseId: string, c: Connection = db) {
  return (
    await c.query(
      "SELECT count(*)::int n FROM case_chat_messages m WHERE m.case_id=$1 AND m.author_id<>$2 AND NOT EXISTS(SELECT 1 FROM case_chat_reads r WHERE r.message_id=m.id AND r.user_id=$2)",
      [caseId, a.id],
    )
  ).rows[0].n;
}
export async function chatData(a: Actor, params: URLSearchParams) {
  const caseId = uuid.parse(params.get("case_id"));
  await requireCase(a, caseId);
  const members = await chatMembers(caseId);
  if (params.get("members") === "1")
    return { members, threads: [], messages: [], hasMore: false, unread: 0 };
  const thread = params.get("thread") ? uuid.parse(params.get("thread")) : null;
  const document = params.get("document")
    ? uuid.parse(params.get("document"))
    : null;
  const status = z
    .enum(["all", "open", "review", "closed"])
    .parse(params.get("status") || "all");
  const focus = params.get("focus")
    ? messageId.parse(params.get("focus"))
    : null;
  const before = params.get("before")
    ? messageId.parse(params.get("before"))
    : focus
      ? String(BigInt(focus) + 1n)
      : null;
  const rows = (
    await db.query(
      'SELECT m.*,u.name author,v.filename,v.version,v.scan_status,v.review_status,v.document_id,d.name document_name,g.name group_name,p.body reply_body,p.image_id reply_image_id,pu.name reply_author, EXISTS(SELECT 1 FROM case_chat_reads r WHERE r.message_id=m.id AND r.user_id=$2) OR m.author_id=$2 is_read FROM case_chat_messages m JOIN "user" u ON u.id=m.author_id LEFT JOIN document_versions v ON v.id=m.version_id LEFT JOIN documents d ON d.id=v.document_id LEFT JOIN document_groups g ON g.id=d.group_id LEFT JOIN case_chat_messages p ON p.id=m.reply_to LEFT JOIN "user" pu ON pu.id=p.author_id LEFT JOIN case_chat_threads t ON t.id=m.thread_id WHERE m.case_id=$1 AND ($3::uuid IS NULL OR m.thread_id=$3) AND ($4::text=\'all\' OR t.status=$4) AND ($5::bigint IS NULL OR m.id<$5) AND ($6::uuid IS NULL OR t.document_id=$6) ORDER BY m.id DESC LIMIT 61',
      [caseId, a.id, thread, status, before, document],
    )
  ).rows;
  const threads = (
    await db.query(
      'SELECT t.*,d.name document_name,d.is_output,g.name group_name,v.filename,v.version,v.scan_status,v.review_status,lv.filename latest_filename,lv.version latest_version,lv.scan_status latest_scan_status,lv.review_status latest_review_status,u.name assignee_name FROM case_chat_threads t JOIN documents d ON d.id=t.document_id LEFT JOIN document_groups g ON g.id=d.group_id JOIN document_versions v ON v.id=t.version_id LEFT JOIN document_versions lv ON lv.id=t.latest_version_id JOIN "user" u ON u.id=t.assignee_id WHERE t.case_id=$1 ORDER BY t.created_at DESC',
      [caseId],
    )
  ).rows;
  return {
    members,
    threads,
    messages: rows.slice(0, 60).reverse(),
    hasMore: rows.length > 60,
    unread: await chatUnread(a, caseId),
  };
}
async function versionInCase(
  c: Connection,
  a: Actor,
  caseId: string,
  versionId: string,
) {
  requirePermission(a, "can_download_documents");
  const v = (
    await c.query(
      "SELECT v.*,d.name document_name,d.group_id,d.archived FROM document_versions v JOIN documents d ON d.id=v.document_id WHERE v.id=$1 AND d.case_id=$2 AND NOT d.finance_receipt",
      [versionId, caseId],
    )
  ).rows[0];
  if (!v || v.archived) throw new AppError(404, "Документ недоступен");
  return v;
}
async function addMessage(
  c: Connection,
  a: Actor,
  caseId: string,
  data: {
    threadId?: string | null;
    body: string;
    versionId?: string | null;
    imageId?: string;
    replyTo?: string | null;
    mentions?: string[];
    kind?: string;
    requestId?: string;
  },
) {
  const message = (
    await c.query(
      "INSERT INTO case_chat_messages(case_id,thread_id,author_id,body,version_id,reply_to,mention_ids,kind,request_id,image_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
      [
        caseId,
        data.threadId || null,
        a.id,
        data.body,
        data.versionId || null,
        data.replyTo || null,
        data.mentions || [],
        data.kind || "message",
        data.requestId || randomUUID(),
        data.imageId || null,
      ],
    )
  ).rows[0];
  const members = await chatMembers(caseId, c);
  for (const member of members.filter((m) => m.id !== a.id)) {
    await c.query(
      "INSERT INTO notifications(user_id,case_id,title,message,dedupe_key,chat_message_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(dedupe_key) DO NOTHING",
      [
        member.id,
        caseId,
        data.kind === "issue"
          ? "Замечание к документу"
          : data.mentions?.includes(member.id)
            ? "Вас упомянули в чате"
            : "Сообщение в чате дела",
        a.name +
          ": " +
          (data.body || (data.imageId ? "Фото" : "")).slice(0, 300),
        "chat:" + message.id + ":" + member.id,
        message.id,
      ],
    );
  }
  return message;
}
export async function chatMutation(a: Actor, action: string, raw: unknown) {
  const base = z.object({ case_id: uuid }).parse(raw);
  return tx(async (c) => {
    await c.query("SELECT id FROM cases WHERE id=$1 FOR UPDATE", [
      base.case_id,
    ]);
    const rec = await requireCase(a, base.case_id, "can_view_cases", c);
    if (action === "chat.read") {
      const d = z.object({ ids: z.array(messageId).max(200) }).parse(raw);
      await c.query(
        "INSERT INTO case_chat_reads(message_id,user_id) SELECT id,$2 FROM case_chat_messages WHERE case_id=$1 AND id=ANY($3::bigint[]) ON CONFLICT DO NOTHING",
        [base.case_id, a.id, d.ids],
      );
      await c.query(
        "UPDATE notifications SET read_at=now() WHERE user_id=$1 AND case_id=$2 AND chat_message_id=ANY($3::bigint[]) AND read_at IS NULL",
        [a.id, base.case_id, d.ids],
      );
      return { ok: true };
    }
    const d = z
      .object({
        request_id: uuid,
        body: z.string().trim().max(10000).default(""),
        thread_id: uuid.optional(),
        version_id: uuid.optional(),
        image_id: uuid.optional(),
        reply_to: messageId.optional(),
        mention_ids: z.array(z.string().min(1)).max(20).default([]),
        assignee_id: z.string().optional(),
        deadline: z.string().optional(),
        decision: z.enum(["close", "reopen"]).optional(),
      })
      .parse(raw);
    const duplicate = (
      await c.query(
        "SELECT * FROM case_chat_messages WHERE author_id=$1 AND request_id=$2",
        [a.id, d.request_id],
      )
    ).rows[0];
    if (duplicate) {
      if (duplicate.case_id !== base.case_id)
        throw new AppError(409, "Повторный запрос относится к другому делу");
      return duplicate;
    }
    if (isClosedStatus(rec.status))
      throw new AppError(409, "Сначала откройте дело");
    const members = await chatMembers(base.case_id, c);
    if (d.mention_ids.some((uid) => !members.some((m) => m.id === uid)))
      throw new AppError(400, "Выберите участника этого дела");
    if (action === "chat.issue") {
      if (a.role !== "Administrator")
        throw new AppError(403, "Замечания создаёт администратор");
      requirePermission(a, "can_review_documents");
      if (!d.body || !d.version_id)
        throw new AppError(400, "Опишите, что нужно исправить");
      const v = await versionInCase(c, a, base.case_id, d.version_id);
      if (!v.group_id) throw new AppError(400, "Выберите документ перечня");
      const latest = (
        await c.query(
          "SELECT id FROM document_versions WHERE document_id=$1 ORDER BY version DESC LIMIT 1",
          [v.document_id],
        )
      ).rows[0];
      if (latest.id !== v.id)
        throw new AppError(409, "Уже загружена новая версия. Проверьте её");
      const assignee = d.assignee_id || rec.responsible_id;
      if (!members.some((m) => m.id === assignee))
        throw new AppError(400, "Выберите участника этого дела");
      const thread = (
        await c.query(
          "INSERT INTO case_chat_threads(case_id,document_id,version_id,author_id,assignee_id,deadline) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
          [
            base.case_id,
            v.document_id,
            v.id,
            a.id,
            assignee,
            parseDeadline(d.deadline, (await settings(c)).timezone),
          ],
        )
      ).rows[0];
      await c.query(
        "UPDATE document_versions SET review_status='Under review',reviewed_by=$2,reviewed_at=now() WHERE id=$1",
        [v.id, a.id],
      );
      const message = await addMessage(c, a, base.case_id, {
        threadId: thread.id,
        body: d.body,
        versionId: v.id,
        mentions: [assignee],
        kind: "issue",
        requestId: d.request_id,
      });
      await audit(
        c,
        a,
        "Замечание к документу создано",
        "chat_thread",
        thread.id,
        base.case_id,
        { version_id: v.id, assignee_id: assignee },
      );
      return message;
    }
    let thread: any = null;
    if (d.thread_id) {
      thread = (
        await c.query(
          "SELECT * FROM case_chat_threads WHERE id=$1 AND case_id=$2 FOR UPDATE",
          [d.thread_id, base.case_id],
        )
      ).rows[0];
      if (!thread) throw new AppError(404, "Обсуждение не найдено");
    }
    if (action === "chat.resolve") {
      if (a.role !== "Administrator")
        throw new AppError(403, "Исправления принимает администратор");
      requirePermission(a, "can_review_documents");
      requirePermission(a, "can_download_documents");
      if (!thread || !d.decision) throw new AppError(400, "Выберите замечание");
      if (d.decision === "close") {
        if (thread.status !== "review" || !thread.latest_version_id)
          throw new AppError(409, "Ожидается исправленная версия");
        const latest = (
          await c.query(
            "SELECT * FROM document_versions WHERE document_id=$1 ORDER BY version DESC LIMIT 1",
            [thread.document_id],
          )
        ).rows[0];
        if (
          latest.id !== d.version_id ||
          latest.id !== thread.latest_version_id
        )
          throw new AppError(409, "Версия изменилась. Проверьте новый файл");
        if (latest.scan_status !== "clean")
          throw new AppError(409, "Дождитесь успешной проверки файла");
        await c.query(
          "UPDATE case_chat_threads SET status='closed',closed_by=$2,closed_at=now(),updated_at=now() WHERE id=$1",
          [thread.id, a.id],
        );
        const remaining = (
          await c.query(
            "SELECT 1 FROM case_chat_threads WHERE document_id=$1 AND status<>'closed'",
            [thread.document_id],
          )
        ).rowCount;
        if (!remaining)
          await c.query(
            "UPDATE document_versions SET review_status='Approved',reviewed_by=$2,reviewed_at=now() WHERE id=$1",
            [latest.id, a.id],
          );
      } else {
        if (!d.body)
          throw new AppError(400, "Опишите, что ещё нужно исправить");
        await c.query(
          "UPDATE case_chat_threads SET status='open',closed_by=NULL,closed_at=NULL,updated_at=now() WHERE id=$1",
          [thread.id],
        );
      }
      if (d.decision === "reopen")
        await c.query(
          "UPDATE document_versions SET review_status='Under review',reviewed_by=$2,reviewed_at=now() WHERE id=$1",
          [thread.latest_version_id || thread.version_id, a.id],
        );
      const message = await addMessage(c, a, base.case_id, {
        threadId: thread.id,
        body: d.decision === "close" ? "Исправление принято" : d.body,
        versionId: thread.latest_version_id || thread.version_id,
        kind: d.decision === "close" ? "closed" : "reopened",
        requestId: d.request_id,
      });
      await audit(
        c,
        a,
        d.decision === "close" ? "Исправление принято" : "Замечание возвращено",
        "chat_thread",
        thread.id,
        base.case_id,
        { version_id: thread.latest_version_id },
      );
      return message;
    }
    if (action !== "chat.send") throw new AppError(400, "Неизвестное действие");
    if (!d.body && !d.version_id && !d.image_id)
      throw new AppError(400, "Напишите сообщение или приложите файл");
    if (d.image_id)
      await requireChatImage(c, a, d.image_id, { case_id: base.case_id });
    if (d.version_id) await versionInCase(c, a, base.case_id, d.version_id);
    if (d.reply_to) {
      const parent = (
        await c.query(
          "SELECT * FROM case_chat_messages WHERE id=$1 AND case_id=$2",
          [d.reply_to, base.case_id],
        )
      ).rows[0];
      if (!parent || (parent.thread_id || null) !== (d.thread_id || null))
        throw new AppError(400, "Ответ должен быть в том же обсуждении");
    }
    return addMessage(c, a, base.case_id, {
      threadId: d.thread_id,
      body: d.body,
      versionId: d.version_id,
      imageId: d.image_id,
      replyTo: d.reply_to,
      mentions: d.mention_ids,
      requestId: d.request_id,
    });
  });
}
export async function chatDocumentUploaded(
  c: Connection,
  a: Actor,
  caseId: string,
  version: any,
) {
  const threads = (
    await c.query(
      "UPDATE case_chat_threads SET status='review',latest_version_id=$2,updated_at=now() WHERE document_id=$1 AND status<>'closed' RETURNING id",
      [version.document_id, version.id],
    )
  ).rows;
  for (const thread of threads)
    await addMessage(c, a, caseId, {
      threadId: thread.id,
      body: "Загружена новая версия — ожидает проверки",
      versionId: version.id,
      kind: "upload",
    });
}

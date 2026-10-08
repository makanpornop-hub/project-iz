import { isClosedStatus, caseFollowupActive } from "./domain";
import type { PoolClient } from "pg";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { AppError, audit, requireCase, type Actor } from "./access";
import { tx } from "./db";
import { enqueue, settings } from "./service";

export function parseCaseCheckDate(
  checkDate: string,
  timezone: string,
  now = new Date(),
) {
  if (typeof checkDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(checkDate))
    throw new AppError(400, "Выберите дату проверки статуса");
  const at = fromZonedTime(`${checkDate}T09:00:00`, timezone);
  if (
    !Number.isFinite(at.getTime()) ||
    formatInTimeZone(at, timezone, "yyyy-MM-dd") !== checkDate
  )
    throw new AppError(400, "Укажите корректную дату проверки статуса");
  if (checkDate < formatInTimeZone(now, timezone, "yyyy-MM-dd"))
    throw new AppError(400, "Дата проверки статуса не может быть в прошлом");
  return at;
}

export async function scheduleCaseFollowup(
  c: PoolClient,
  a: Actor,
  caseId: string,
  archiveId: string,
  checkDate: string,
) {
  // All follow-up mutations and deliveries lock the case before its plan.
  await c.query("SELECT id FROM cases WHERE id=$1 FOR UPDATE", [caseId]);
  const record = await requireCase(a, caseId, "can_upload_documents", c);
  if (isClosedStatus(record.status))
    throw new AppError(409, "Закрытое дело: нельзя назначить проверку статуса");
  if (
    !(
      await c.query(
        "SELECT 1 FROM workflow_archives WHERE id=$1 AND case_id=$2",
        [archiveId, caseId],
      )
    ).rowCount
  )
    throw new AppError(404, "Архив документов этого дела не найден");
  const cfg = await settings(c);
  const now = new Date();
  const checkAt = parseCaseCheckDate(checkDate, cfg.timezone, now);
  const previous = (
    await c.query("SELECT * FROM case_followups WHERE case_id=$1 FOR UPDATE", [
      caseId,
    ])
  ).rows[0];
  if (
    previous?.archive_id === archiveId &&
    new Date(previous.check_at).getTime() === checkAt.getTime()
  )
    return previous;

  const followup = (
    await c.query(
      `INSERT INTO case_followups(case_id,archive_id,check_at,created_by,updated_by)
       VALUES($1,$2,$3,$4,$4)
       ON CONFLICT(case_id) DO UPDATE SET archive_id=EXCLUDED.archive_id,
       check_at=EXCLUDED.check_at,revision=case_followups.revision+1,
       notified_at=NULL,telegram_sent_at=NULL,updated_by=EXCLUDED.updated_by,updated_at=now()
       RETURNING *`,
      [caseId, archiveId, checkAt, a.id],
    )
  ).rows[0];
  await c.query(
    `UPDATE jobs SET status='cancelled',locked_at=NULL
     WHERE status IN ('pending','failed') AND (
       (kind='case_followup' AND payload->>'caseId'=$1) OR
       (kind='notification' AND payload->'origin'->>'entity'='case_followup'
        AND payload->'origin'->>'id'=$1))`,
    [caseId],
  );
  await enqueue(
    c,
    "case_followup",
    { caseId, revision: followup.revision },
    `case-followup:${caseId}:${followup.revision}`,
    checkAt < now ? now : checkAt,
  );
  await audit(c, a, "Назначена проверка статуса", "case", caseId, caseId, {
    check_at: checkAt.toISOString(),
    archive_id: archiveId,
    revision: followup.revision,
  });
  return followup;
}

async function canNotifyResponsible(c: PoolClient, userId: string) {
  return Boolean(
    (
      await c.query(
        "SELECT 1 FROM staff s JOIN role_permissions rp ON rp.role_id=s.role_id WHERE s.user_id=$1 AND s.active AND rp.permission_id='can_view_cases'",
        [userId],
      )
    ).rowCount,
  );
}

export async function notifyCaseFollowup(caseId: string, revision: number) {
  await tx(async (c) => {
    const record = (
      await c.query(
        "SELECT c.*,cl.name client_name FROM cases c JOIN clients cl ON cl.id=c.client_id WHERE c.id=$1 FOR UPDATE OF c",
        [caseId],
      )
    ).rows[0];
    const followup = (
      await c.query(
        "SELECT * FROM case_followups WHERE case_id=$1 FOR UPDATE",
        [caseId],
      )
    ).rows[0];
    if (
      !record ||
      !caseFollowupActive(record.status) ||
      !followup ||
      followup.revision !== revision ||
      followup.notified_at ||
      new Date(followup.check_at) > new Date()
    )
      return;
    if (!(await canNotifyResponsible(c, record.responsible_id))) return;
    const cfg = await settings(c);
    const notification = (
      await c.query(
        `INSERT INTO notifications(user_id,case_id,title,message,dedupe_key)
         VALUES($1,$2,$3,$4,$5) ON CONFLICT(dedupe_key)
         DO UPDATE SET dedupe_key=EXCLUDED.dedupe_key RETURNING id`,
        [
          record.responsible_id,
          caseId,
          "Проверить статус дела",
          `${record.client_name} · CASE-${record.number}\n${record.visa_type}\nПроверьте текущий статус дела.\nДата проверки: ${formatInTimeZone(followup.check_at, cfg.timezone, "dd.MM.yyyy")}`,
          `case-followup:${caseId}:${revision}:${record.responsible_id}`,
        ],
      )
    ).rows[0];
    await enqueue(
      c,
      "notification",
      {
        notificationId: notification.id,
        origin: { entity: "case_followup", id: caseId, revision },
      },
      `delivery:${notification.id}`,
    );
    // The internal notification and its durable Telegram job commit together.
    await c.query(
      "UPDATE case_followups SET notified_at=now() WHERE case_id=$1",
      [caseId],
    );
  });
}

export async function deliverCaseFollowupNotification(
  caseId: string,
  revision: number,
  userId: string,
  send: () => Promise<void>,
) {
  return tx(async (c) => {
    const record = (
      await c.query(
        "SELECT status,responsible_id FROM cases WHERE id=$1 FOR UPDATE",
        [caseId],
      )
    ).rows[0];
    const followup = (
      await c.query(
        "SELECT * FROM case_followups WHERE case_id=$1 FOR UPDATE",
        [caseId],
      )
    ).rows[0];
    if (
      !record ||
      !caseFollowupActive(record.status) ||
      record.responsible_id !== userId ||
      !followup ||
      followup.revision !== revision ||
      !followup.notified_at ||
      new Date(followup.check_at) > new Date()
    )
      return false;
    if (!(await canNotifyResponsible(c, userId))) return false;
    if (followup.telegram_sent_at) return true;
    // A date change waits for an in-flight send; stale queued deliveries cannot send.
    await send();
    await c.query(
      "UPDATE case_followups SET telegram_sent_at=now() WHERE case_id=$1",
      [caseId],
    );
    return true;
  });
}

import { isClosedStatus } from "./domain";
import { db, tx } from "./db";
import { AppError, actorFor, requireCase, audit } from "./access";
import { getAuth } from "./auth";
import { enqueue, settings } from "./service";
import { scan, readObject, deleteObject } from "./storage";
import {
  telegram,
  sendDocument,
  processUpdate,
  performUpload,
} from "./telegram";
import { formatInTimeZone } from "date-fns-tz";
import { telegramChatSettings } from "./telegram-settings";
class CancelledJob extends Error {}
export async function notify(
  userId: string,
  caseId: string,
  title: string,
  message: string,
  key: string,
  origin?: { entity: string; id: string; revision: number },
) {
  try {
    await requireCase(await actorFor(userId), caseId);
  } catch (e) {
    if (e instanceof AppError) return;
    throw e;
  }
  await tx(async (c) => {
    const n = (
      await c.query(
        "INSERT INTO notifications(user_id,case_id,title,message,dedupe_key) VALUES($1,$2,$3,$4,$5) ON CONFLICT(dedupe_key) DO UPDATE SET dedupe_key=EXCLUDED.dedupe_key RETURNING id",
        [userId, caseId, title, message, key],
      )
    ).rows[0];
    await enqueue(
      c,
      "notification",
      { notificationId: n.id, origin },
      `delivery:${n.id}`,
    );
  });
}
async function execute(job: any) {
  const p = job.payload;
  if (job.kind === "case_followup") {
    await (
      await import("./case-followup")
    ).notifyCaseFollowup(p.caseId, p.revision);
    return;
  }
  if (job.kind === "exchange_sync") {
    await (await import("./exchange-rates")).syncExchangeRates();
    return;
  }
  if (job.kind === "finance_check") {
    await (await import("./accounting")).checkFinanceDeadlines();
    return;
  }
  if (job.kind === "financial_notification") {
    await (await import("./accounting")).deliverFinancialEvent(p.eventId);
    return;
  }
  if (job.kind === "delete_object") {
    await deleteObject(p.key);
    return;
  }
  if (job.kind === "invite") {
    await getAuth().api.requestPasswordReset({
      body: {
        email: p.email,
        redirectTo: `${process.env.BETTER_AUTH_URL}/reset-password`,
      },
    });
    return;
  }
  if (job.kind === "telegram_upload") {
    await performUpload(p.uploadId);
    return;
  }
  if (job.kind === "scan") {
    const v = (
      await db.query(
        "SELECT v.*,d.finance_receipt FROM document_versions v JOIN documents d ON d.id=v.document_id WHERE v.id=$1",
        [p.versionId],
      )
    ).rows[0];
    if (!v) return;
    if (v.scan_status === "infected") return;
    const clean =
      v.scan_status === "clean" ||
      (await scan(await readObject(v.storage_key)));
    await tx(async (c) => {
      await c.query("UPDATE document_versions SET scan_status=$2 WHERE id=$1", [
        v.id,
        clean ? "clean" : "infected",
      ]);
      await audit(
        c,
        null,
        clean ? "Файл прошёл проверку" : "Файл заблокирован проверкой",
        "version",
        v.id,
        null,
        {},
        "system",
      );
      if (clean && !v.finance_receipt) {
        await c.query(
          "INSERT INTO backup_deliveries(version_id) VALUES($1) ON CONFLICT DO NOTHING",
          [v.id],
        );
        await enqueue(c, "backup", { versionId: v.id }, `backup:${v.id}`);
      }
    });
    return;
  }
  if (job.kind === "workflow_archive") {
    await (
      await import("./workflow-archive-delivery")
    ).deliverWorkflowArchive(p.archiveId);
    return;
  }
  if (job.kind === "backup") {
    const cfg = await settings();
    if (!cfg.backupEnabled) throw new Error("Backup not enabled");
    const v = (
      await db.query(
        'SELECT v.*,d.name document_name,d.type,c.number,cl.name client_name,u.name author,b.state FROM document_versions v JOIN documents d ON d.id=v.document_id JOIN cases c ON c.id=d.case_id JOIN clients cl ON cl.id=c.client_id JOIN "user" u ON u.id=v.uploaded_by JOIN backup_deliveries b ON b.version_id=v.id WHERE v.id=$1',
        [p.versionId],
      )
    ).rows[0];
    if (!v || v.state === "sent") return;
    if (v.scan_status !== "clean") throw new Error("File not clean");
    const chatId = (await telegramChatSettings()).backupChatId;
    if (!chatId) throw new Error("Backup chat not configured");
    await db.query(
      "UPDATE backup_deliveries SET state='processing',updated_at=now() WHERE version_id=$1",
      [v.id],
    );
    const messageId = await sendDocument(
      chatId,
      v.filename,
      v.mime,
      await readObject(v.storage_key),
      `Документ · CASE-${v.number}\nКлиент: ${v.client_name}\n${v.document_name} · ${v.type} · v${v.version}\nЗагрузил: ${v.author}\n${formatInTimeZone(v.created_at, cfg.timezone, "dd.MM.yyyy HH:mm")}`,
    );
    await db.query(
      "UPDATE backup_deliveries SET state='sent',message_id=$2,updated_at=now() WHERE version_id=$1",
      [v.id, messageId],
    );
    return;
  }
  if (job.kind === "notification") {
    const n = (
      await db.query(
        "SELECT n.*,l.telegram_id FROM notifications n LEFT JOIN telegram_links l ON l.user_id=n.user_id WHERE n.id=$1",
        [p.notificationId],
      )
    ).rows[0];
    if (!n) throw new CancelledJob();
    if (p.origin?.entity === "case_followup") {
      const current = await (
        await import("./case-followup")
      ).deliverCaseFollowupNotification(
        p.origin.id,
        p.origin.revision,
        n.user_id,
        async () => {
          if (!n.telegram_id) throw new Error("Telegram account not linked");
          await telegram("sendMessage", {
            chat_id: n.telegram_id,
            text: "Пора проверить статус дела. Подробности доступны в разделе уведомлений CRM.",
          });
        },
      );
      if (!current) throw new CancelledJob();
      return;
    }
    if (p.origin) {
      const table = p.origin.entity === "task" ? "tasks" : "cases";
      const fresh = (
        await db.query(
          "SELECT revision,status FROM " + table + " WHERE id=\u00241",
          [p.origin.id],
        )
      ).rows[0];
      if (
        !fresh ||
        fresh.revision !== p.origin.revision ||
        isClosedStatus(fresh.status)
      )
        throw new CancelledJob();
    }
    try {
      await requireCase(await actorFor(n.user_id), n.case_id);
    } catch (e) {
      if (e instanceof AppError) throw new CancelledJob();
      throw e;
    }
    if (!n.telegram_id) throw new Error("Telegram account not linked");
    await telegram("sendMessage", {
      chat_id: n.telegram_id,
      text: `${n.title}\n${n.message}\n${process.env.BETTER_AUTH_URL}/cases/${n.case_id}`,
    });
    return;
  }
  if (job.kind === "team") {
    const cfg = await settings();
    if (!cfg.teamEnabled) throw new CancelledJob();
    await telegram("sendMessage", {
      chat_id: (await telegramChatSettings()).teamChatId,
      text: p.text,
    });
    return;
  }
  if (job.kind === "reminder") {
    const table = p.entity === "task" ? "tasks" : "cases";
    const r = (
      await db.query(
        `SELECT r.*,cl.name client_name,c.number FROM ${table} r JOIN cases c ON c.id=${p.entity === "task" ? "r.case_id" : "r.id"} JOIN clients cl ON cl.id=c.client_id WHERE r.id=$1`,
        [p.id],
      )
    ).rows[0];
    if (!r || r.revision !== p.revision || isClosedStatus(r.status)) return;
    const cfg = await settings();
    const caseId = p.entity === "task" ? r.case_id : r.id;
    const title =
      p.kind === "overdue"
        ? "Срок просрочен"
        : p.kind === "today"
          ? "Срок сегодня"
          : "Приближается срок";
    const message = `${r.client_name} · CASE-${r.number}\n${r.title || "Срок визового дела"}\nСрок: ${formatInTimeZone(r.deadline, cfg.timezone, "dd.MM.yyyy HH:mm")}`;
    for (const uid of new Set(
      [
        r.responsible_id,
        ...(p.kind === "overdue" ? [r.escalation_id] : []),
      ].filter(Boolean),
    ))
      await notify(uid, caseId, title, message, `${job.dedupe_key}:${uid}`, {
        entity: p.entity,
        id: p.id,
        revision: p.revision,
      });
    if (cfg.teamEnabled)
      await enqueue(
        db,
        "team",
        {
          text: `${title} · CASE-${r.number}\n${process.env.BETTER_AUTH_URL}/cases/${caseId}`,
        },
        `team:${job.dedupe_key}`,
      );
    return;
  }
  if (job.kind === "completed") {
    const t = (
      await db.query(
        "SELECT t.*,c.responsible_id case_responsible,cl.name client_name,c.number FROM tasks t JOIN cases c ON c.id=t.case_id JOIN clients cl ON cl.id=c.client_id WHERE t.id=$1",
        [p.id],
      )
    ).rows[0];
    if (!t || t.status !== "Completed") return;
    for (const uid of new Set([t.creator_id, t.case_responsible]))
      if (uid !== p.actorId)
        await notify(
          uid,
          t.case_id,
          "Задача завершена",
          `${t.title}\n${t.client_name} · CASE-${t.number}`,
          `${job.dedupe_key}:${uid}`,
        );
    return;
  }
  throw new Error("Unknown job kind");
}
export async function tick() {
  await db.query(
    "UPDATE jobs SET status='pending',locked_at=NULL WHERE status='processing' AND locked_at<now()-interval '10 minutes'",
  );
  await db.query(
    "UPDATE telegram_updates SET state='pending' WHERE state='processing' AND locked_at<now()-interval '10 minutes'",
  );
  await db.query(
    "UPDATE telegram_uploads SET state='cancelled',file_id='' WHERE expires_at<now() AND state NOT IN ('saved','cancelled')",
  );
  const update = await tx(
    async (c) =>
      (
        await c.query(
          "UPDATE telegram_updates SET state='processing',locked_at=now(),attempts=attempts+1 WHERE id=(SELECT id FROM telegram_updates WHERE state='pending' AND next_at<=now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *",
        )
      ).rows[0],
  );
  if (update) {
    try {
      await processUpdate(update.body);
      await db.query(
        "UPDATE telegram_updates SET state='sent',body='{}' WHERE id=$1",
        [update.id],
      );
    } catch (e) {
      if (e instanceof AppError) {
        const chat =
          update.body.message?.chat ||
          update.body.callback_query?.message?.chat;
        if (chat?.type === "private") {
          try {
            await telegram("sendMessage", {
              chat_id: chat.id,
              text: e.message,
            });
          } catch {}
        }
      }
      await db.query(
        "UPDATE telegram_updates SET state=$2,next_at=now()+interval '1 minute' WHERE id=$1",
        [
          update.id,
          e instanceof AppError || update.attempts >= 5 ? "failed" : "pending",
        ],
      );
    }
  }
  const job = await tx(
    async (c) =>
      (
        await c.query(
          "UPDATE jobs SET status='processing',locked_at=now(),attempts=attempts+1 WHERE id=(SELECT id FROM jobs WHERE status='pending' AND run_at<=now() ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *",
        )
      ).rows[0],
  );
  if (!job) return Boolean(update);
  try {
    await execute(job);
    await db.query(
      "UPDATE jobs SET status='sent',locked_at=NULL,last_error=NULL WHERE id=$1",
      [job.id],
    );
  } catch (e) {
    if (e instanceof CancelledJob) {
      await db.query(
        "UPDATE jobs SET status='cancelled',locked_at=NULL WHERE id=$1",
        [job.id],
      );
      return true;
    }
    const fail =
      job.attempts >= 8 ||
      (e instanceof AppError &&
        [400, 401, 403, 404, 409, 410, 413].includes(e.status));
    await db.query(
      "UPDATE jobs SET status=$2,run_at=now()+($3*interval '1 second'),last_error=$4,locked_at=NULL WHERE id=$1",
      [
        job.id,
        fail ? "failed" : "pending",
        Math.min(3600, 30 * 2 ** job.attempts),
        e instanceof AppError
          ? e.message
          : "Внешний сервис недоступен или не настроен",
      ],
    );
    if (job.kind === "backup")
      await db.query(
        "UPDATE backup_deliveries SET state=$2,updated_at=now() WHERE version_id=$1",
        [job.payload.versionId, fail ? "failed" : "pending"],
      );
    if (job.kind === "scan" && fail)
      await db.query(
        "UPDATE document_versions SET scan_status='failed' WHERE id=$1",
        [job.payload.versionId],
      );
  }
  return true;
}

import { isClosedStatus } from "./domain";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import { db, tx } from "./db";
import {
  AppError,
  type Actor,
  audit,
  requireCase,
  requirePermission,
  scopeSql,
} from "./access";
import {
  caseStatuses,
  taskStatuses,
  permissions,
  parseDeadline,
  reminderTimes,
} from "./domain";
const id = z.string().uuid();
const text = z.string().trim().min(1).max(250);
const userId = z.string().min(1).max(100);
export async function settings(c: Pick<PoolClient, "query"> = db) {
  return (await c.query("SELECT value FROM system_settings WHERE id='general'"))
    .rows[0].value as {
    timezone: string;
    maxFileMb: number;
    reminderDays: number[];
    backupEnabled: boolean;
    teamEnabled: boolean;
  };
}
export async function enqueue(
  c: Pick<PoolClient, "query">,
  kind: string,
  payload: unknown,
  key: string,
  at = new Date(),
) {
  await c.query(
    "INSERT INTO jobs(kind,payload,dedupe_key,run_at) VALUES($1,$2,$3,$4) ON CONFLICT(dedupe_key) DO NOTHING",
    [kind, JSON.stringify(payload), key, at],
  );
}
export async function schedule(
  c: PoolClient,
  entity: "task" | "case",
  record: any,
) {
  await c.query(
    "UPDATE jobs SET status='cancelled' WHERE kind='reminder' AND payload->>'entity'=$1 AND payload->>'id'=$2 AND status IN ('pending','failed')",
    [entity, record.id],
  );
  if (!record.deadline || isClosedStatus(record.status)) return;
  const cfg = await settings(c);
  const now = new Date();
  for (const r of reminderTimes(
    new Date(record.deadline),
    cfg.timezone,
    cfg.reminderDays,
  )) {
    if (
      r.kind !== "overdue" &&
      (r.at <= now || r.at >= new Date(record.deadline))
    )
      continue;
    await enqueue(
      c,
      "reminder",
      { entity, id: record.id, revision: record.revision, kind: r.kind },
      `${entity}:${record.id}:${record.revision}:${r.kind}`,
      r.at < now ? now : r.at,
    );
  }
}
async function activeStaff(c: PoolClient, value: string | null | undefined) {
  if (
    value &&
    !(await c.query("SELECT 1 FROM staff WHERE user_id=$1 AND active", [value]))
      .rowCount
  )
    throw new AppError(400, "Выберите активного сотрудника");
}
export async function getData(
  a: Actor,
  section: string,
  params: URLSearchParams,
): Promise<any> {
  if (section === "chats")
    return (await import("./chat-rooms")).chatHub(a, params);
  if (section === "room")
    return (await import("./chat-rooms")).roomData(a, params);
  if (section === "chat-directory")
    return (await import("./chat-rooms")).roomDirectory(a);
  if (section === "chat")
    return (await import("./case-chat")).chatData(a, params);
  if (section === "accounting")
    return (await import("./accounting")).accountingData(a, params);
  if (section === "settings-telegram")
    return (await import("./telegram-settings")).telegramSettingsData(a);
  if (section === "settings-contracts") {
    (await import("./telegram-settings")).requireTelegramAdmin(a);
    return {};
  }
  if (section === "case-form") {
    requirePermission(a, "can_create_cases");
    return (await import("./case-form")).caseFormPolicy();
  }
  const scope = scopeSql(a);
  const base = [a.id];
  if (section === "partners") {
    const groups = (
      await db.query("SELECT * FROM partner_groups ORDER BY created_at,id")
    ).rows;
    const partners = (
      await db.query("SELECT * FROM partners ORDER BY created_at,id")
    ).rows;
    return groups.map((g) => ({
      ...g,
      partners: partners.filter((p) => p.group_id === g.id),
    }));
  }
  if (section === "me") return { actor: a, settings: await settings() };
  if (section === "staff") {
    requirePermission(a, "can_view_cases");
    return (
      await db.query(
        'SELECT u.id,u.name FROM "user" u JOIN staff s ON s.user_id=u.id WHERE s.active ORDER BY u.name',
      )
    ).rows;
  }
  if (section === "clients") {
    requirePermission(a, "can_create_cases");
    return (
      await db.query(
        `SELECT DISTINCT cl.id,cl.name,cl.phone,cl.email FROM clients cl JOIN cases c ON c.client_id=cl.id WHERE $1::text IS NOT NULL AND ${scope} ORDER BY cl.name LIMIT 200`,
        base,
      )
    ).rows;
  }
  if (section === "cases") {
    requirePermission(a, "can_view_cases");
    const q = params.get("q") || "",
      status = params.get("status") || "",
      owner = params.get("owner") || "",
      visa = params.get("visa") || "";
    const page = Math.max(1, Number(params.get("page")) || 1);
    const values = [
      a.id,
      `%${q}%`,
      status,
      owner,
      visa,
      Math.min(page - 1, 100000) * 20,
    ];
    const rows = (
      await db.query(
        `SELECT c.*,cl.name,cl.phone,cl.email,u.name responsible_name,EXISTS(SELECT 1 FROM case_workflows w WHERE w.case_id=c.id) has_checklist,(SELECT count(*)::int FROM documents d WHERE d.case_id=c.id AND d.group_id IS NOT NULL AND NOT d.is_output AND NOT d.archived AND d.required) documents_total,(SELECT count(*)::int FROM documents d WHERE d.case_id=c.id AND d.group_id IS NOT NULL AND NOT d.is_output AND NOT d.archived AND d.required AND EXISTS(SELECT 1 FROM document_versions v WHERE v.document_id=d.id)) documents_loaded,count(*) OVER() total FROM cases c JOIN clients cl ON cl.id=c.client_id JOIN "user" u ON u.id=c.responsible_id WHERE $1::text IS NOT NULL AND ${scope} AND (cl.name ILIKE $2 OR cl.phone ILIKE $2 OR cl.email ILIKE $2 OR ('CASE-'||lpad(c.number::text,greatest(3,length(c.number::text)),'0')) ILIKE $2) AND ($3='' OR c.status=$3) AND ($4='' OR c.responsible_id=$4) AND ($5='' OR c.visa_type ILIKE '%'||$5||'%') ORDER BY c.updated_at DESC,c.id DESC LIMIT 20 OFFSET $6`,
        values,
      )
    ).rows;
    return (await import("./accounting")).attachFinance(a, rows);
  }
  if (section === "task") {
    requirePermission(a, "can_view_cases");
    const taskId = id.parse(params.get("id"));
    const task = (
      await db.query(
        'SELECT t.*,u.name responsible_name,e.name escalation_name,cl.name client_name,c.number,c.status case_status,EXISTS(SELECT 1 FROM case_workflows w WHERE w.task_id=t.id) workflow_task FROM tasks t JOIN cases c ON c.id=t.case_id JOIN clients cl ON cl.id=c.client_id JOIN "user" u ON u.id=t.responsible_id LEFT JOIN "user" e ON e.id=t.escalation_id WHERE t.id=$1',
        [taskId],
      )
    ).rows[0];
    if (!task) throw new AppError(404, "Задача не найдена");
    await requireCase(a, task.case_id);
    const assign =
      ["Administrator", "Manager"].includes(a.role) &&
      a.permissions.includes("can_assign_tasks");
    return {
      task,
      staff: assign
        ? (
            await db.query(
              'SELECT u.id,u.name FROM "user" u JOIN staff s ON s.user_id=u.id WHERE s.active ORDER BY u.name',
            )
          ).rows
        : [],
    };
  }
  if (section === "case") {
    const caseId = id.parse(params.get("id"));
    await requireCase(a, caseId);
    const details = (
      await db.query(
        'SELECT c.*,cl.name,cl.email,cl.phone,u.name responsible_name,e.name escalation_name FROM cases c JOIN clients cl ON cl.id=c.client_id JOIN "user" u ON u.id=c.responsible_id LEFT JOIN "user" e ON e.id=c.escalation_id WHERE c.id=$1',
        [caseId],
      )
    ).rows[0];
    const docs = (
      await db.query(
        "SELECT d.*,coalesce((SELECT jsonb_agg(jsonb_build_object('id',v.id,'version',v.version,'filename',v.filename,'size',v.size,'review_status',v.review_status,'scan_status',v.scan_status,'expires_at',v.expires_at,'created_at',v.created_at,'author',u.name,'backup_state',b.state) ORDER BY v.version DESC) FROM document_versions v JOIN \"user\" u ON u.id=v.uploaded_by LEFT JOIN backup_deliveries b ON b.version_id=v.id WHERE v.document_id=d.id),'[]') versions FROM documents d WHERE d.case_id=$1 AND NOT d.finance_receipt ORDER BY d.created_at DESC",
        [caseId],
      )
    ).rows;
    const tasks = (
      await db.query(
        'SELECT t.*,u.name responsible_name FROM tasks t JOIN "user" u ON u.id=t.responsible_id WHERE case_id=$1 ORDER BY t.deadline',
        [caseId],
      )
    ).rows;
    const logs = (
      await db.query(
        'SELECT l.*,u.name author FROM audit_logs l LEFT JOIN "user" u ON u.id=l.user_id WHERE case_id=$1 ORDER BY l.created_at DESC LIMIT 100',
        [caseId],
      )
    ).rows;
    return {
      details: (
        await (await import("./accounting")).attachFinance(a, [details])
      )[0],
      documents: docs.filter((d) => !d.group_id),
      tasks,
      logs: logs.filter(
        (l) =>
          ![
            "case_finance",
            "client_payments",
            "client_expenses",
            "financial_event",
          ].includes(l.entity),
      ),
      chat_unread: await (await import("./case-chat")).chatUnread(a, caseId),
      contract:
        a.permissions.includes("accounting.view_contract") &&
        a.permissions.includes("accounting.view")
          ? (
              await db.query(
                "SELECT case_id,filename,size,generated_on FROM generated_contracts WHERE case_id=$1",
                [caseId],
              )
            ).rows[0] || null
          : null,
      workflow: await (await import("./workflow")).workflowData(caseId),
      followup:
        (
          await db.query(
            "SELECT f.*,a.filename,a.size,a.file_count,a.created_at archive_created_at,a.telegram_sent_at archive_telegram_sent_at,j.status telegram_status FROM case_followups f JOIN workflow_archives a ON a.id=f.archive_id LEFT JOIN jobs j ON j.dedupe_key='workflow-archive:'||a.id::text WHERE f.case_id=$1",
            [caseId],
          )
        ).rows[0] || null,
    };
  }
  if (section === "tasks" || section === "deadlines") {
    requirePermission(a, "can_view_cases");
    const tasks = (
      await db.query(
        `SELECT t.*,cl.name client_name,c.number,c.country,c.visa_type,u.name responsible_name,'task' entity FROM tasks t JOIN cases c ON c.id=t.case_id JOIN clients cl ON cl.id=c.client_id JOIN "user" u ON u.id=t.responsible_id WHERE $1::text IS NOT NULL AND ${scope} ORDER BY t.deadline`,
        base,
      )
    ).rows;
    if (section === "tasks") return tasks;
    return [
      ...tasks.filter((t) => t.deadline),
      ...(
        await db.query(
          `SELECT c.id,c.id case_id,c.number,c.status,c.deadline,c.responsible_id,cl.name client_name,u.name responsible_name,'Срок визового дела' title,'case' entity FROM cases c JOIN clients cl ON cl.id=c.client_id JOIN "user" u ON u.id=c.responsible_id WHERE $1::text IS NOT NULL AND ${scope} AND c.deadline IS NOT NULL`,
          base,
        )
      ).rows,
    ].sort(
      (x, y) => new Date(x.deadline).getTime() - new Date(y.deadline).getTime(),
    );
  }
  if (section === "dashboard") {
    requirePermission(a, "can_view_cases");
    const stage = params.get("stage") || "";
    if (stage && !caseStatuses.includes(stage as any))
      throw new AppError(400, "Неизвестный этап");
    const taskFilter = params.get("task_filter") || "";
    if (
      taskFilter &&
      !["overdue", "today", "mine", "completed"].includes(taskFilter)
    )
      throw new AppError(400, "Неизвестный фильтр задач");
    const zone = (await settings()).timezone;
    const conditions: Record<string, string> = {
      overdue: "t.status<>'Completed' AND t.deadline<now()",
      today:
        "t.status<>'Completed' AND (t.deadline AT TIME ZONE $2)::date=(now() AT TIME ZONE $2)::date",
      mine: "t.status<>'Completed' AND t.responsible_id=$1",
      completed: "t.status='Completed'",
    };
    const taskRows = (
      await db.query(
        "SELECT t.*,cl.name client_name,c.number,c.country,c.visa_type,u.name responsible_name,'task' entity FROM tasks t JOIN cases c ON c.id=t.case_id JOIN clients cl ON cl.id=c.client_id JOIN \"user\" u ON u.id=t.responsible_id WHERE $1::text IS NOT NULL AND $2::text IS NOT NULL AND " +
          scope +
          " AND " +
          (conditions[taskFilter] || "t.status<>'Completed'") +
          " ORDER BY t.deadline NULLS LAST,t.id",
        [a.id, zone],
      )
    ).rows;
    return {
      stage_cases: stage
        ? await getData(
            a,
            "cases",
            new URLSearchParams({
              status: stage,
              page: params.get("page") || "1",
            }),
          )
        : [],
      stats: (
        await db.query(
          `SELECT count(*) FILTER(WHERE t.status<>'Completed' AND t.deadline<now()) overdue,count(*) FILTER(WHERE t.status<>'Completed' AND (t.deadline AT TIME ZONE $2)::date=(now() AT TIME ZONE $2)::date) today,count(*) FILTER(WHERE t.status<>'Completed' AND t.responsible_id=$1) mine,count(*) FILTER(WHERE t.status='Completed') completed FROM tasks t JOIN cases c ON c.id=t.case_id WHERE ${scope}`,
          [a.id, (await settings()).timezone],
        )
      ).rows[0],
      tasks: taskFilter ? taskRows : taskRows.slice(0, 8),
      logs: (
        await db.query(
          `SELECT l.*,u.name author,cl.name client_name FROM audit_logs l JOIN cases c ON c.id=l.case_id JOIN clients cl ON cl.id=c.client_id LEFT JOIN "user" u ON u.id=l.user_id WHERE $1::text IS NOT NULL AND ${scope} ORDER BY l.created_at DESC LIMIT 8`,
          base,
        )
      ).rows,
      cases: (
        await db.query(
          `SELECT c.status,count(*) total FROM cases c WHERE $1::text IS NOT NULL AND ${scope} GROUP BY c.status`,
          base,
        )
      ).rows,
    };
  }
  if (section === "notifications")
    return (
      await db.query(
        `SELECT n.*,cm.thread_id chat_thread_id,rm.room_id FROM notifications n LEFT JOIN chat_room_messages rm ON rm.id=n.room_message_id LEFT JOIN case_chat_messages cm ON cm.id=n.chat_message_id LEFT JOIN cases c ON c.id=n.case_id WHERE n.user_id=$1 AND (n.room_message_id IS NULL OR EXISTS(SELECT 1 FROM chat_room_members crm WHERE crm.room_id=rm.room_id AND crm.user_id=$1 AND crm.active)) AND (n.case_id IS NULL OR (${a.permissions.includes("can_view_cases") ? scope : "FALSE"})) ORDER BY n.created_at DESC LIMIT 200`,
        base,
      )
    ).rows;
  if (section === "profile")
    return {
      actor: a,
      telegram: !!(
        await db.query(
          "SELECT 1 FROM telegram_links WHERE user_id=$1 AND telegram_id IS NOT NULL",
          base,
        )
      ).rowCount,
    };
  if (section === "settings") {
    requirePermission(a, "can_manage_settings");
    return {
      settings: await settings(),
      integrations: {
        database: !!process.env.DATABASE_URL,
        storage: !!process.env.S3_BUCKET,
        telegram: !!process.env.TELEGRAM_BOT_TOKEN,
        mail: !!process.env.SMTP_HOST,
        scanner: !!process.env.CLAMAV_HOST,
      },
      jobs: (
        await db.query(
          "SELECT id,kind,status,attempts,last_error,created_at FROM jobs WHERE status='failed' ORDER BY created_at DESC LIMIT 100",
        )
      ).rows,
      backups: (
        await db.query(
          "SELECT b.*,v.filename FROM backup_deliveries b JOIN document_versions v ON v.id=b.version_id WHERE b.state<>'sent' ORDER BY b.updated_at DESC LIMIT 100",
        )
      ).rows,
    };
  }
  if (section === "users") {
    requirePermission(a, "can_manage_users");
    return (
      await db.query(
        'SELECT u.id,u.name,u.email,s.role_id,s.active FROM "user" u JOIN staff s ON s.user_id=u.id ORDER BY u.name',
      )
    ).rows;
  }
  if (section === "role-options") {
    requirePermission(a, "can_manage_users");
    return (await db.query("SELECT id,name FROM roles ORDER BY name")).rows;
  }
  if (section === "roles") {
    requirePermission(a, "can_manage_roles");
    return (
      await db.query(
        "SELECT r.*,coalesce(array_agg(rp.permission_id) FILTER(WHERE rp.permission_id IS NOT NULL),'{}') permissions FROM roles r LEFT JOIN role_permissions rp ON rp.role_id=r.id GROUP BY r.id ORDER BY r.name",
      )
    ).rows;
  }
  if (section === "audit") {
    requirePermission(a, "can_view_audit_log");
    return (
      await db.query(
        'SELECT l.*,u.name author FROM audit_logs l LEFT JOIN "user" u ON u.id=l.user_id ORDER BY l.created_at DESC LIMIT 300',
      )
    ).rows;
  }
  throw new AppError(404, "Раздел не найден");
}
export async function mutate(a: Actor, raw: unknown) {
  const { action, data } = z
    .object({ action: z.string(), data: z.any() })
    .parse(raw);
  if (action.startsWith("room."))
    return (await import("./chat-rooms")).roomMutation(a, action, data);
  if (action.startsWith("chat."))
    return (await import("./case-chat")).chatMutation(a, action, data);
  if (action.startsWith("accounting."))
    return (await import("./accounting")).accountingMutation(a, action, data);
  if (action === "telegram-settings.save")
    return (await import("./telegram-settings")).saveTelegramSettings(a, data);
  if (action === "telegram-settings.check")
    return (await import("./telegram-settings")).checkTelegramChat(a, data);
  if (action === "case-form.save")
    return (await import("./case-form")).saveCaseFormPolicy(a, data);
  const createdStorageKeys: string[] = [];
  return tx(async (c) => {
    if (action === "partner-group.save") {
      requirePermission(a, "can_manage_partners");
      const d = z.object({ id: id.optional(), name: text }).parse(data);
      const result = d.id
        ? await c.query(
            "UPDATE partner_groups SET name=$2,updated_at=now() WHERE id=$1 RETURNING *",
            [d.id, d.name],
          )
        : await c.query(
            "INSERT INTO partner_groups(name) VALUES($1) RETURNING *",
            [d.name],
          );
      if (!result.rowCount)
        throw new AppError(404, "Группа партнёров не найдена");
      await audit(
        c,
        a,
        d.id ? "Группа партнёров изменена" : "Группа партнёров создана",
        "partner_group",
        result.rows[0].id,
      );
      return result.rows[0];
    }
    if (action === "partner.save") {
      requirePermission(a, "can_manage_partners");
      const d = z
        .object({
          id: id.optional(),
          group_id: id,
          name: text,
          phone: z.string().trim().max(60).default(""),
          email: z
            .string()
            .trim()
            .max(254)
            .email()
            .or(z.literal(""))
            .default(""),
          country: z.string().trim().max(120).default(""),
          city: z.string().trim().max(120).default(""),
          notes: z.string().max(10000).default(""),
        })
        .parse(data);
      if (
        !(
          await c.query("SELECT 1 FROM partner_groups WHERE id=$1", [
            d.group_id,
          ])
        ).rowCount
      )
        throw new AppError(404, "Группа партнёров не найдена");
      const values = [
        d.group_id,
        d.name,
        d.phone,
        d.email,
        d.country,
        d.city,
        d.notes,
      ];
      const result = d.id
        ? await c.query(
            "UPDATE partners SET group_id=$1,name=$2,phone=$3,email=$4,country=$5,city=$6,notes=$7,updated_at=now() WHERE id=$8 RETURNING *",
            [...values, d.id],
          )
        : await c.query(
            "INSERT INTO partners(group_id,name,phone,email,country,city,notes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
            values,
          );
      if (!result.rowCount) throw new AppError(404, "Партнёр не найден");
      await audit(
        c,
        a,
        d.id ? "Партнёр изменён" : "Партнёр добавлен",
        "partner",
        result.rows[0].id,
      );
      return result.rows[0];
    }
    if (action === "case.create") {
      requirePermission(a, "can_create_cases");
      const d = z
        .object({
          client_id: id.optional().or(z.literal("")),
          name: text,
          email: z.string().email().or(z.literal("")).default(""),
          phone: z.string().max(60).default(""),
          country: z.string().trim().max(250).default(""),
          visa_type: z.string().trim().max(250).default(""),
          responsible_id: userId,
          escalation_id: userId.optional().or(z.literal("")),
          deadline: z.string().optional(),
          finance: z.unknown().optional(),
        })
        .parse(data);
      if (
        !a.permissions.includes("can_assign_case_staff") &&
        (d.responsible_id !== a.id || d.escalation_id)
      )
        throw new AppError(403, "Нет права назначать сотрудников");
      await activeStaff(c, d.responsible_id);
      await activeStaff(c, d.escalation_id);
      if (!d.finance)
        throw new AppError(
          400,
          "Укажите договорённую сумму и валюту для автоматического договора",
        );
      const { creationFinanceSchema } = await import("./case-creation-finance");
      d.finance = creationFinanceSchema.parse(d.finance);
      if (!(await (await import("./contracts")).currentContractTemplate(c)))
        throw new AppError(
          409,
          "Загрузите шаблон договора DOCX в Настройки → Шаблон договора DOCX",
        );
      let clientId = d.client_id;
      if (clientId) {
        if (
          !(
            await c.query(
              `SELECT 1 FROM cases c WHERE c.client_id=$2 AND $1::text IS NOT NULL AND ${scopeSql(a)} LIMIT 1`,
              [a.id, clientId],
            )
          ).rowCount
        )
          throw new AppError(404, "Клиент недоступен");
      } else
        clientId = (
          await c.query(
            "INSERT INTO clients(name,email,phone) VALUES($1,$2,$3) RETURNING id",
            [d.name, d.email, d.phone],
          )
        ).rows[0].id;
      const client = (
        await c.query("SELECT name,phone,email FROM clients WHERE id=$1", [
          clientId,
        ])
      ).rows[0];
      await (await import("./case-form")).validateCaseFields(c, d, client);
      const r = (
        await c.query(
          "INSERT INTO cases(client_id,country,visa_type,responsible_id,escalation_id,deadline,status) VALUES($1,$2,$3,$4,$5,$6,'Contract signing') RETURNING *",
          [
            clientId,
            d.country,
            d.visa_type,
            d.responsible_id,
            d.escalation_id || null,
            parseDeadline(d.deadline, (await settings(c)).timezone, "08:05"),
          ],
        )
      ).rows[0];
      if (d.visa_type === "ВНЖ испания") {
        await (await import("./workflow")).initializeSpain(c, a, r);
      }
      const finance = await (
        await import("./case-creation-finance")
      ).initializeCaseFinance(c, a, r.id, d.finance);
      await (
        await import("./contracts")
      ).attachCreatedContract(
        c,
        a,
        r.id,
        client.name,
        finance,
        createdStorageKeys,
      );
      await schedule(c, "case", r);
      await audit(c, a, "Дело создано", "case", r.id, r.id);
      return r;
    }
    if (action === "case.update") {
      const d = z
        .object({
          id,
          status: z.enum(caseStatuses),
          name: text,
          email: z.string().email().or(z.literal("")),
          phone: z.string().max(60),
          country: text,
          visa_type: text,
          responsible_id: userId,
          escalation_id: z.string(),
          deadline: z.string(),
        })
        .parse(data);
      await c.query("SELECT id FROM cases WHERE id=$1 FOR UPDATE", [d.id]);
      const old = await requireCase(a, d.id, "can_edit_cases", c);

      if (
        d.responsible_id !== old.responsible_id ||
        (d.escalation_id || null) !== old.escalation_id
      )
        requirePermission(a, "can_assign_case_staff");
      await activeStaff(c, d.responsible_id);
      await activeStaff(c, d.escalation_id);
      if (
        isClosedStatus(d.status) &&
        (
          await c.query(
            "SELECT 1 FROM tasks WHERE case_id=$1 AND status<>'Completed'",
            [d.id],
          )
        ).rowCount
      )
        throw new AppError(409, "Сначала завершите открытые задачи дела");
      const existing = (
        await c.query("SELECT * FROM clients WHERE id=$1", [old.client_id])
      ).rows[0];
      if (
        existing.name !== d.name ||
        existing.email !== d.email ||
        existing.phone !== d.phone
      ) {
        if (
          !a.permissions.includes("can_view_all_cases") &&
          (
            await c.query(
              `SELECT 1 FROM cases c WHERE c.client_id=$2 AND NOT ${scopeSql(a)} LIMIT 1`,
              [a.id, old.client_id],
            )
          ).rowCount
        )
          throw new AppError(
            403,
            "Изменение общих контактов затрагивает недоступные дела. Обратитесь к менеджеру.",
          );
        await c.query(
          "UPDATE clients SET name=$2,email=$3,phone=$4,updated_at=now() WHERE id=$1",
          [old.client_id, d.name, d.email, d.phone],
        );
      }
      const r = (
        await c.query(
          "UPDATE cases SET status=$2,country=$3,visa_type=$4,responsible_id=$5,escalation_id=$6,deadline=$7,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",
          [
            d.id,
            d.status,
            d.country,
            d.visa_type,
            d.responsible_id,
            d.escalation_id || null,
            parseDeadline(d.deadline, (await settings(c)).timezone),
          ],
        )
      ).rows[0];
      await schedule(c, "case", r);
      await audit(c, a, "Дело изменено", "case", r.id, r.id, {
        status: { from: old.status, to: r.status },
        deadline: { from: old.deadline, to: r.deadline },
        responsible: { from: old.responsible_id, to: r.responsible_id },
      });
      return r;
    }
    if (action === "task.create" || action === "task.update") {
      const d = z
        .object({
          id: id.optional(),
          case_id: id,
          title: text,
          description: z.string().max(10000).default(""),
          responsible_id: userId,
          escalation_id: z.string().optional(),
          deadline: z.string().min(10),
          status: z.enum(taskStatuses).default("To do"),
          revision: z.number().int().positive().optional(),
        })
        .parse(data);
      await c.query("SELECT id FROM cases WHERE id=$1 FOR UPDATE", [d.case_id]);
      const rec = await requireCase(
        a,
        d.case_id,
        action === "task.create" ? "can_create_tasks" : "can_edit_tasks",
        c,
      );
      if (isClosedStatus(rec.status))
        throw new AppError(409, "Сначала откройте дело");
      let old: any = null;
      if (action === "task.update") {
        old = (
          await c.query(
            "SELECT * FROM tasks WHERE id=$1 AND case_id=$2 FOR UPDATE",
            [d.id, d.case_id],
          )
        ).rows[0];
        if (!old) throw new AppError(404, "Задача не найдена");
        if (d.revision !== undefined && d.revision !== old.revision)
          throw new AppError(409, "Задача изменилась. Обновите страницу");
      }
      if (
        old &&
        d.status !== old.status &&
        (
          await c.query("SELECT 1 FROM case_workflows WHERE task_id=$1", [
            old.id,
          ])
        ).rowCount
      )
        throw new AppError(
          409,
          "Статус сбора документов меняется через отправку и проверку пакета",
        );
      const escalation =
        d.escalation_id === undefined
          ? old
            ? old.escalation_id
            : rec.escalation_id
          : d.escalation_id || null;
      if (
        (old &&
          (old.responsible_id !== d.responsible_id ||
            old.escalation_id !== escalation)) ||
        (!old &&
          (d.responsible_id !== a.id || escalation !== rec.escalation_id))
      ) {
        if (!["Administrator", "Manager"].includes(a.role))
          throw new AppError(
            403,
            "Назначать ответственного и эскалатора может только администратор или менеджер",
          );
        requirePermission(a, "can_assign_tasks");
      }
      if (d.status === "Completed" && old?.status !== "Completed")
        requirePermission(a, "can_complete_tasks");
      await activeStaff(c, d.responsible_id);
      await activeStaff(c, escalation);
      const deadline = parseDeadline(d.deadline, (await settings(c)).timezone);
      const done =
        d.status === "Completed" ? old?.completed_at || new Date() : null;
      const r = old
        ? (
            await c.query(
              "UPDATE tasks SET title=$2,description=$3,responsible_id=$4,escalation_id=$5,deadline=$6,status=$7,completed_at=$8,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",
              [
                d.id,
                d.title,
                d.description,
                d.responsible_id,
                escalation,
                deadline,
                d.status,
                done,
              ],
            )
          ).rows[0]
        : (
            await c.query(
              "INSERT INTO tasks(case_id,title,description,responsible_id,escalation_id,deadline,status,completed_at,creator_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
              [
                d.case_id,
                d.title,
                d.description,
                d.responsible_id,
                escalation,
                deadline,
                d.status,
                done,
                a.id,
              ],
            )
          ).rows[0];
      await schedule(c, "task", r);
      await audit(
        c,
        a,
        old ? "Задача изменена" : "Задача создана",
        "task",
        r.id,
        r.case_id,
        {
          status: { from: old?.status, to: r.status },
          deadline: { from: old?.deadline, to: r.deadline },
        },
      );
      if (d.status === "Completed" && old?.status !== "Completed")
        await enqueue(
          c,
          "completed",
          { id: r.id, actorId: a.id },
          `completed:${r.id}:${r.revision}`,
        );
      return r;
    }
    if (action === "task.status") {
      const d = z.object({ id, status: z.enum(taskStatuses) }).parse(data);
      let t = (await c.query("SELECT * FROM tasks WHERE id=$1", [d.id]))
        .rows[0];
      if (!t) throw new AppError(404, "Задача не найдена");
      await c.query("SELECT id FROM cases WHERE id=$1 FOR UPDATE", [t.case_id]);
      t = (await c.query("SELECT * FROM tasks WHERE id=$1 FOR UPDATE", [d.id]))
        .rows[0];
      const rec = await requireCase(
        a,
        t.case_id,
        d.status === "Completed" ? "can_complete_tasks" : "can_edit_tasks",
        c,
      );
      if (isClosedStatus(rec.status) && d.status !== "Completed")
        throw new AppError(409, "Сначала откройте дело");
      if (
        (await c.query("SELECT 1 FROM case_workflows WHERE task_id=$1", [t.id]))
          .rowCount
      )
        throw new AppError(
          409,
          "Откройте перечень документов и используйте кнопку «Готово» или проверку администратора",
        );
      if (t.status === d.status) return t;
      const r = (
        await c.query(
          "UPDATE tasks SET status=$2,completed_at=CASE WHEN $2='Completed' THEN now() ELSE NULL END,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",
          [d.id, d.status],
        )
      ).rows[0];
      await schedule(c, "task", r);
      await audit(
        c,
        a,
        d.status === "Completed" ? "Задача завершена" : "Статус задачи изменён",
        "task",
        r.id,
        r.case_id,
        { from: t.status, to: d.status },
      );
      if (d.status === "Completed")
        await enqueue(
          c,
          "completed",
          { id: r.id, actorId: a.id },
          `completed:${r.id}:${r.revision}`,
        );
      return r;
    }
    if (action === "document.archive") {
      const d = z.object({ id, archived: z.boolean() }).parse(data);
      const doc = (await c.query("SELECT * FROM documents WHERE id=$1", [d.id]))
        .rows[0];
      if (!doc) throw new AppError(404, "Документ не найден");
      if (doc.finance_receipt)
        throw new AppError(403, "Чеки управляются в бухгалтерии");
      if (doc.group_id)
        throw new AppError(
          409,
          "Поля перечня документов нельзя архивировать. Измените обязательность в настройках группы",
        );
      await requireCase(a, doc.case_id, "can_archive_documents", c);
      await c.query("UPDATE documents SET archived=$2 WHERE id=$1", [
        d.id,
        d.archived,
      ]);
      await audit(
        c,
        a,
        d.archived ? "Документ архивирован" : "Документ восстановлен",
        "document",
        d.id,
        doc.case_id,
      );
      return {};
    }
    if (action === "document.open") {
      const versionId = id.parse(data.id);
      const v = (
        await c.query(
          "SELECT v.*,d.case_id,d.finance_receipt FROM document_versions v JOIN documents d ON d.id=v.document_id WHERE v.id=$1",
          [versionId],
        )
      ).rows[0];
      if (!v) throw new AppError(404, "Версия не найдена");
      if (v.finance_receipt) requirePermission(a, "accounting.view");
      await requireCase(a, v.case_id, "can_download_documents", c);
      if (v.scan_status !== "clean")
        throw new AppError(409, "Сначала дождитесь проверки безопасности");
      if (a.role === "Administrator") {
        await c.query("SELECT id FROM cases WHERE id=$1 FOR UPDATE", [
          v.case_id,
        ]);
        const changed = await c.query(
          "UPDATE document_versions SET review_status='Under review',reviewed_by=$2,reviewed_at=now() WHERE id=$1 AND review_status='Uploaded' RETURNING id",
          [v.id, a.id],
        );
        if (changed.rowCount)
          await audit(
            c,
            a,
            "Администратор открыл документ",
            "version",
            v.id,
            v.case_id,
          );
      }
      return (
        await c.query(
          "SELECT review_status FROM document_versions WHERE id=$1",
          [v.id],
        )
      ).rows[0];
    }
    if (action === "document.review") {
      const d = z
        .object({
          id,
          status: z.enum(["Uploaded", "Under review", "Approved"]),
          expires_at: z.string().optional(),
        })
        .parse(data);
      const v = (
        await c.query(
          "SELECT v.*,d.case_id,d.group_id,d.finance_receipt FROM document_versions v JOIN documents d ON d.id=v.document_id WHERE v.id=$1",
          [d.id],
        )
      ).rows[0];
      if (!v) throw new AppError(404, "Версия не найдена");
      if (v.finance_receipt) requirePermission(a, "accounting.view");
      await requireCase(a, v.case_id, "can_review_documents", c);
      if (v.group_id) {
        if (a.role !== "Administrator")
          throw new AppError(
            403,
            "Документы перечня подтверждает администратор",
          );
        await c.query("SELECT id FROM cases WHERE id=$1 FOR UPDATE", [
          v.case_id,
        ]);
        const latest = (
          await c.query(
            "SELECT id,review_status FROM document_versions WHERE document_id=$1 ORDER BY version DESC LIMIT 1",
            [v.document_id],
          )
        ).rows[0];
        if (latest.id !== v.id)
          throw new AppError(
            409,
            "Загружена новая версия. Откройте её для проверки",
          );
        if (d.status === "Approved" && latest.review_status === "Uploaded")
          throw new AppError(409, "Сначала откройте документ для просмотра");
        const wf = (
          await c.query("SELECT state FROM case_workflows WHERE case_id=$1", [
            v.case_id,
          ])
        ).rows[0];
        if (wf?.state === "approved" && d.status !== "Approved")
          throw new AppError(409, "Сначала верните пакет на доработку");
      }
      if (v.scan_status !== "clean")
        throw new AppError(
          409,
          "Сначала требуется проверка безопасности файла",
        );
      await c.query(
        "UPDATE document_versions SET review_status=$2,reviewed_by=$3,reviewed_at=now(),expires_at=$4 WHERE id=$1",
        [
          d.id,
          d.status,
          a.id,
          d.expires_at === undefined ? v.expires_at : d.expires_at || null,
        ],
      );
      await audit(c, a, "Версия проверена", "version", d.id, v.case_id, {
        status: d.status,
      });
      return {};
    }
    if (action === "notification.read") {
      await c.query(
        "UPDATE notifications SET read_at=now() WHERE id=$1 AND user_id=$2",
        [id.parse(data.id), a.id],
      );
      return {};
    }
    if (action === "user.create") {
      requirePermission(a, "can_manage_users");
      const d = z
        .object({
          name: text,
          email: z.string().email(),
          role_id: text,
          password: z
            .union([z.literal(""), z.string().min(12).max(128)])
            .optional(),
        })
        .parse(data);
      if (d.password && a.role !== "Administrator")
        throw new AppError(403, "Пароль может задать только администратор");
      const uid = randomUUID();
      await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)', [
        uid,
        d.name,
        d.email.toLowerCase(),
      ]);
      await c.query(
        'INSERT INTO account(id,"accountId","providerId","userId",password) VALUES($1,$2,\'credential\',$2,$3)',
        [
          randomUUID(),
          uid,
          await hashPassword(d.password || randomUUID() + randomUUID()),
        ],
      );
      await c.query("INSERT INTO staff(user_id,role_id) VALUES($1,$2)", [
        uid,
        d.role_id,
      ]);
      if (!d.password)
        await enqueue(c, "invite", { email: d.email }, `invite:${uid}`);
      await audit(c, a, "Сотрудник создан", "user", uid);
      return { id: uid };
    }
    if (action === "user.password") {
      requirePermission(a, "can_manage_users");
      if (a.role !== "Administrator")
        throw new AppError(403, "Пароль может задать только администратор");
      const d = z
        .object({ id: userId, password: z.string().min(12).max(128) })
        .parse(data);
      if (d.id === a.id)
        throw new AppError(409, "Свой пароль меняйте в профиле");
      const target = (
        await c.query("SELECT user_id FROM staff WHERE user_id=$1 FOR UPDATE", [
          d.id,
        ])
      ).rows[0];
      if (!target) throw new AppError(404, "Сотрудник не найден");
      const updated = await c.query(
        'UPDATE account SET password=$2,"updatedAt"=now() WHERE "userId"=$1 AND "providerId"=\'credential\'',
        [d.id, await hashPassword(d.password)],
      );
      if (!updated.rowCount)
        throw new AppError(409, "Учётная запись для входа не найдена");
      await c.query('DELETE FROM session WHERE "userId"=$1', [d.id]);
      await c.query(
        "DELETE FROM verification WHERE value=$1 AND identifier LIKE 'reset-password:%'",
        [d.id],
      );
      await audit(c, a, "Пароль сотрудника изменён", "user", d.id);
      return {};
    }
    if (action === "user.update") {
      requirePermission(a, "can_manage_users");
      const d = z
        .object({ id: userId, active: z.boolean(), role_id: text })
        .parse(data);
      if (d.id === a.id && (!d.active || d.role_id !== a.role))
        throw new AppError(
          409,
          "Нельзя заблокировать себя или изменить свою роль",
        );
      await c.query("SELECT pg_advisory_xact_lock(88888)");
      const existing = (
        await c.query("SELECT * FROM staff WHERE user_id=$1", [d.id])
      ).rows[0];
      if (!existing) throw new AppError(404, "Сотрудник не найден");
      if (
        existing.role_id === "Administrator" &&
        (!d.active || d.role_id !== "Administrator") &&
        (
          await c.query(
            "SELECT 1 FROM staff WHERE active AND role_id='Administrator' AND user_id<>$1",
            [d.id],
          )
        ).rowCount === 0
      )
        throw new AppError(409, "Нужен хотя бы один администратор");
      await c.query("UPDATE staff SET active=$2,role_id=$3 WHERE user_id=$1", [
        d.id,
        d.active,
        d.role_id,
      ]);
      await c.query('DELETE FROM session WHERE "userId"=$1', [d.id]);
      await audit(c, a, "Права сотрудника изменены", "user", d.id, null, {
        active: d.active,
        role: d.role_id,
      });
      return {};
    }
    if (action === "role.save") {
      requirePermission(a, "can_manage_roles");
      const d = z
        .object({ id: text, permissions: z.array(z.enum(permissions)) })
        .parse(data);
      if (d.id === "Administrator")
        throw new AppError(409, "Базовые права администратора защищены");
      await c.query(
        "INSERT INTO roles(id,name) VALUES($1,$1) ON CONFLICT DO NOTHING",
        [d.id],
      );
      await c.query("DELETE FROM role_permissions WHERE role_id=$1", [d.id]);
      for (const p of new Set(d.permissions))
        await c.query("INSERT INTO role_permissions VALUES($1,$2)", [d.id, p]);
      await audit(c, a, "Роль изменена", "role", d.id);
      return {};
    }
    if (action === "settings.save") {
      requirePermission(a, "can_manage_settings");
      const d = z
        .object({
          timezone: z.string().refine((v) => {
            try {
              new Intl.DateTimeFormat("ru", { timeZone: v });
              return true;
            } catch {
              return false;
            }
          }),
          maxFileMb: z.number().int().min(1).max(20),
          reminderDays: z.array(z.number().int().min(1).max(90)).max(10),
          backupEnabled: z.boolean().optional(),
          teamEnabled: z.boolean().optional(),
        })
        .parse(data);
      const previous = (
        await c.query(
          "SELECT value FROM system_settings WHERE id='general' FOR UPDATE",
        )
      ).rows[0].value;
      const merged = { ...previous, ...d };
      const chats = await (
        await import("./telegram-settings")
      ).telegramChatSettings(c);
      if (merged.backupEnabled && !chats.backupChatId)
        throw new AppError(400, "Сначала настройте Backup Chat");
      if (merged.teamEnabled && !chats.teamChatId)
        throw new AppError(400, "Сначала настройте Team Chat");
      await c.query("UPDATE system_settings SET value=$1 WHERE id='general'", [
        JSON.stringify(merged),
      ]);
      for (const entity of ["case", "task"] as const) {
        const records = await c.query(
          `UPDATE ${entity === "case" ? "cases" : "tasks"} SET revision=revision+1 WHERE deadline IS NOT NULL AND status NOT IN ('Completed','Cancelled','Visa approved','Visa refused') RETURNING *`,
        );
        for (const r of records.rows) await schedule(c, entity, r);
      }
      await audit(c, a, "Настройки изменены", "settings", "general");
      return {};
    }
    if (action === "job.retry") {
      requirePermission(a, "can_manage_settings");
      const jobId = id.parse(data.id);
      await c.query(
        "UPDATE jobs SET status='pending',attempts=0,run_at=now(),last_error=NULL WHERE id=$1 AND status='failed'",
        [jobId],
      );
      await audit(c, a, "Повтор фонового задания запрошен", "job", jobId);
      return {};
    }
    if (action === "document.create") {
      const d = z
        .object({
          case_id: id,
          name: text,
          type: z.enum(["Passport", "Bank Statement", "Insurance", "Other"]),
        })
        .parse(data);
      await requireCase(a, d.case_id, "can_upload_documents", c);
      const doc = (
        await c.query(
          "INSERT INTO documents(case_id,name,type) VALUES($1,$2,$3) RETURNING *",
          [d.case_id, d.name, d.type],
        )
      ).rows[0];
      await audit(
        c,
        a,
        "Создан ожидаемый документ",
        "document",
        doc.id,
        d.case_id,
      );
      return doc;
    }
    if (action === "backup.retry") {
      requirePermission(a, "can_manage_settings");
      const vid = id.parse(data.id);
      await c.query(
        "UPDATE jobs SET status='pending',attempts=0,run_at=now(),last_error=NULL WHERE kind IN ('backup','scan') AND payload->>'versionId'=$1 AND status='failed'",
        [vid],
      );
      await audit(c, a, "Повторная отправка запрошена", "version", vid);
      return {};
    }
    throw new AppError(400, "Неизвестное действие");
  }).catch(async (error) => {
    if (createdStorageKeys.length) {
      const { deleteObject } = await import("./storage");
      for (const key of createdStorageKeys)
        try {
          await deleteObject(key);
        } catch {
          await enqueue(db, "delete_object", { key }, "delete:" + key);
        }
    }
    throw error;
  });
}

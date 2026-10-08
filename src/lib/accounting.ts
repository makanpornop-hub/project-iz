import { isClosedStatus } from "./domain";
import {
  exchangeState,
  quote,
  exchangeToday,
  syncExchangeRates,
} from "./exchange-rates";
import { balanceInUsd, isLowBalance } from "./currency-domain";
import { z } from "zod";
import type { PoolClient } from "pg";
import { db, tx } from "./db";
import {
  AppError,
  requirePermission,
  requireCase,
  scopeSql,
  audit,
  type Actor,
} from "./access";
import { enqueue, settings, schedule } from "./service";
import {
  calculateFinance,
  cents,
  decimal,
  money,
  financialLabels,
} from "./accounting-domain";
import { telegram } from "./telegram";
type Connection = Pick<PoolClient, "query">;
const uuid = z.string().uuid();
const amount = z
  .string()
  .regex(/^\d{1,13}(\.\d{1,2})?$/)
  .refine((v) => cents(v) > 0n, "Сумма должна быть больше нуля");
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T00:00:00Z");
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
  });
const method = z.enum(["CASH", "CARD", "TRANSFER", "OTHER"]);
export async function financeRows(
  c: Connection,
  ids: string[],
  now = new Date(),
) {
  if (!ids.length) return [];
  const rows = (
    await c.query(
      `SELECT c.id case_id,c.client_id,c.revision case_revision,c.number,c.country,c.visa_type,c.status workflow_status,c.responsible_id,u.name responsible_name,cl.name client_name,cl.phone,
 f.currency,f.original_amount,f.exchange_rate,f.rate_date,f.contract_amount,to_char(f.payment_deadline,'YYYY-MM-DD') payment_deadline,coalesce(f.revision,0) revision,
 coalesce(p.paid,0)::text paid,coalesce(p.initial_payment,0)::text initial_payment,p.initial_date,coalesce(e.expenses,0)::text expenses
 FROM cases c JOIN clients cl ON cl.id=c.client_id JOIN "user" u ON u.id=c.responsible_id LEFT JOIN case_finances f ON f.case_id=c.id
 LEFT JOIN LATERAL (SELECT sum(CASE WHEN type='REFUND' THEN -amount ELSE amount END) paid,sum(amount) FILTER(WHERE type='INITIAL') initial_payment,to_char(min(paid_on) FILTER(WHERE type='INITIAL'),'YYYY-MM-DD') initial_date FROM client_payments WHERE case_id=c.id AND deleted_at IS NULL) p ON true
 LEFT JOIN LATERAL (SELECT sum(amount) expenses FROM client_expenses WHERE case_id=c.id AND deleted_at IS NULL) e ON true WHERE c.id=ANY($1::uuid[]) ORDER BY c.number DESC`,
      [ids],
    )
  ).rows;
  const zone = (await settings(c)).timezone;
  const usd = (await exchangeState(c)).rates.find((r) => r.currency === "USD");
  return rows.map((r) => {
    const result = calculateFinance(r, now, zone);
    return {
      ...r,
      ...result,
      balance: result.cash_result,
      balance_usd: usd ? balanceInUsd(result.cash_result, usd.rate) : null,
      balance_status:
        usd && isLowBalance(result.cash_result, usd.rate)
          ? "LOW_BALANCE"
          : null,
    };
  });
}
export function publicFinance(a: Actor, r: any) {
  if (!a.permissions.includes("accounting.view"))
    return {
      financial_status: r.financial_status,
      warnings: r.warnings,
      balance_status: r.balance_status,
    };
  const value = { ...r };
  if (!a.permissions.includes("accounting.view_contract")) {
    for (const key of [
      "contract_amount",
      "original_amount",
      "exchange_rate",
      "rate_date",
      "currency",
      "remaining",
      "planned_profit",
    ])
      delete value[key];
  }
  if (!a.permissions.includes("accounting.view_profit")) {
    for (const key of ["planned_profit", "cash_result"]) delete value[key];
  }
  return value;
}
async function withClientBalances(a: Actor, rows: any[]) {
  if (!rows.length) return rows;
  const totals = (
    await db.query(
      `SELECT c.client_id,sum(coalesce(p.paid,0)-coalesce(e.expenses,0))::text balance FROM cases c
  LEFT JOIN LATERAL (SELECT sum(CASE WHEN type='REFUND' THEN -amount ELSE amount END) paid FROM client_payments WHERE case_id=c.id AND deleted_at IS NULL) p ON true
  LEFT JOIN LATERAL (SELECT sum(amount) expenses FROM client_expenses WHERE case_id=c.id AND deleted_at IS NULL) e ON true
  WHERE $1::text IS NOT NULL AND ${scopeSql(a)} AND c.client_id=ANY($2::uuid[]) GROUP BY c.client_id`,
      [a.id, rows.map((r) => r.client_id)],
    )
  ).rows;
  const balances = new Map(totals.map((r) => [r.client_id, r.balance]));
  const usd = (await exchangeState()).rates.find((r) => r.currency === "USD");
  return rows.map((r) => {
    const balance = balances.get(r.client_id) || "0.00";
    return {
      ...r,
      client_balance: balance,
      client_balance_usd: usd ? balanceInUsd(balance, usd.rate) : null,
      balance_status:
        usd && isLowBalance(balance, usd.rate) ? "LOW_BALANCE" : null,
    };
  });
}
export async function attachFinance(a: Actor, rows: any[]) {
  const finances = await financeRows(
    db,
    rows.map((r) => r.id),
  );
  const map = new Map(
    (await withClientBalances(a, finances)).map((r) => [r.case_id, r]),
  );
  return rows.map((r) => ({
    ...r,
    finance: map.has(r.id) ? publicFinance(a, map.get(r.id)) : null,
  }));
}
export async function recalculateFinance(
  c: Connection,
  caseId: string,
  now = new Date(),
) {
  await c.query("SELECT id FROM cases WHERE id=$1 FOR UPDATE", [caseId]);
  const r = (await financeRows(c, [caseId], now))[0];
  if (!r) return;
  await c.query(
    "INSERT INTO case_finances(case_id) VALUES($1) ON CONFLICT DO NOTHING",
    [caseId],
  );
  await c.query(
    "UPDATE case_finances SET financial_status=$2,warnings=$3 WHERE case_id=$1",
    [caseId, r.financial_status, r.warnings],
  );
  const active = (
    await c.query(
      "SELECT * FROM financial_events WHERE case_id=$1 AND resolved_at IS NULL FOR UPDATE",
      [caseId],
    )
  ).rows;
  // Closed cases retain their finance record, but do not trigger new reminders.
  const critical = isClosedStatus(r.workflow_status) ? [] : r.warnings;
  for (const event of active)
    if (!critical.includes(event.kind)) {
      await c.query(
        "UPDATE financial_events SET resolved_at=now() WHERE id=$1",
        [event.id],
      );
      await c.query(
        "UPDATE jobs SET status='cancelled' WHERE kind='financial_notification' AND payload->>'eventId'=$1 AND status IN ('pending','failed')",
        [event.id],
      );
      await audit(
        c,
        null,
        "Финансовое предупреждение снято",
        "financial_event",
        event.id,
        caseId,
        { kind: event.kind },
        "system",
      );
    }
  for (const kind of critical)
    if (!active.some((e) => e.kind === kind)) {
      const event = (
        await c.query(
          "INSERT INTO financial_events(case_id,kind,snapshot) VALUES($1,$2,$3) RETURNING id",
          [caseId, kind, JSON.stringify(r)],
        )
      ).rows[0];
      const admins = (
        await c.query(
          "SELECT user_id FROM staff WHERE active AND role_id='Administrator'",
        )
      ).rows;
      for (const admin of admins)
        await c.query(
          "INSERT INTO notifications(user_id,case_id,title,message,dedupe_key) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
          [
            admin.user_id,
            caseId,
            financialLabels[kind],
            `${r.client_name} · CASE-${r.number}. ${kind === "PAYMENT_OVERDUE" ? "Задолженность: " + money(r.remaining) : "Превышение: " + money(r.expense_deficit)}`,
            `finance:${event.id}:${admin.user_id}`,
          ],
        );
      await enqueue(
        c,
        "financial_notification",
        { eventId: event.id },
        "finance-event:" + event.id,
      );
      await audit(
        c,
        null,
        "Создано финансовое предупреждение",
        "financial_event",
        event.id,
        caseId,
        { kind },
        "system",
      );
    }
  return r;
}
export async function checkFinanceDeadlines(now = new Date()) {
  const ids = (await db.query("SELECT case_id FROM case_finances")).rows;
  for (const r of ids) await tx((c) => recalculateFinance(c, r.case_id, now));
}
export async function deliverFinancialEvent(eventId: string) {
  const initial = (
    await db.query("SELECT case_id FROM financial_events WHERE id=$1", [
      eventId,
    ])
  ).rows[0];
  if (!initial) return;
  await tx((c) => recalculateFinance(c, initial.case_id));
  const event = (
    await db.query("SELECT * FROM financial_events WHERE id=$1", [eventId])
  ).rows[0];
  if (!event || event.resolved_at || event.sent_at) return;
  const r = (await financeRows(db, [event.case_id]))[0];
  const text =
    event.kind === "PAYMENT_OVERDUE"
      ? `⚠️ ПРОСРОЧЕНА ОПЛАТА\n\nКлиент: ${r.client_name}\nВизовое дело: CASE-${r.number} · ${r.country} · ${r.visa_type}\nДоговорённая сумма: ${money(r.contract_amount)}\nОплачено: ${money(r.paid)}\nЗадолженность: ${money(r.remaining)}\nДедлайн: ${r.payment_deadline}\nПросрочка: ${r.overdue_days} дн.`
      : `🚨 РАСХОДЫ ПРЕВЫСИЛИ ОПЛАТУ\n\nКлиент: ${r.client_name}\nВизовое дело: CASE-${r.number} · ${r.country} · ${r.visa_type}\nПолучено от клиента: ${money(r.paid)}\nРасходы: ${money(r.expenses)}\nПревышение: ${money(r.expense_deficit)}\nТребуется проверить оплату клиента.`;
  const chatId = (
    await (await import("./telegram-settings")).telegramChatSettings()
  ).financeChatId;
  if (!chatId) throw Error("Finance chat not configured");
  const sent = await telegram("sendMessage", { chat_id: chatId, text });
  await db.query(
    "UPDATE financial_events SET sent_at=now(),telegram_message_id=$2 WHERE id=$1",
    [eventId, String(sent.message_id)],
  );
}
export async function accountingData(a: Actor, params: URLSearchParams) {
  requirePermission(a, "accounting.view");
  requirePermission(a, "can_view_cases");
  const caseId = params.get("case_id");
  const clientId = params.get("client_id")
    ? uuid.parse(params.get("client_id"))
    : null;
  if (caseId) await requireCase(a, uuid.parse(caseId));
  const accessible = (
    await db.query(
      `SELECT c.id FROM cases c WHERE $1::text IS NOT NULL AND ${scopeSql(a)} AND ($2::uuid IS NULL OR c.id=$2) AND ($3::uuid IS NULL OR c.client_id=$3)`,
      [a.id, caseId || null, clientId],
    )
  ).rows.map((r) => r.id);
  let rows = await financeRows(db, accessible);
  rows = await withClientBalances(a, rows);
  const payments = (
    await db.query(
      `SELECT p.*,to_char(p.paid_on,'YYYY-MM-DD') paid_on,u.name employee_name FROM client_payments p JOIN "user" u ON u.id=p.created_by WHERE p.case_id=ANY($1::uuid[]) ORDER BY p.paid_on DESC,p.created_at DESC`,
      [accessible],
    )
  ).rows;
  const expenses = (
    await db.query(
      `SELECT e.*,to_char(e.spent_on,'YYYY-MM-DD') spent_on,u.name employee_name,v.filename receipt_filename,v.scan_status receipt_scan_status FROM client_expenses e JOIN "user" u ON u.id=e.created_by LEFT JOIN document_versions v ON v.id=e.receipt_version_id WHERE e.case_id=ANY($1::uuid[]) ORDER BY e.spent_on DESC,e.created_at DESC`,
      [accessible],
    )
  ).rows;
  const start = params.get("from") ? date.parse(params.get("from")) : "",
    end = params.get("to") ? date.parse(params.get("to")) : "";
  if (start && end && start > end)
    throw new AppError(400, "Начало периода позже окончания");
  const inPeriod = (day: string) =>
    (!start || day >= start) && (!end || day <= end);
  const type = params.get("expense_type") || "";
  rows = rows.filter(
    (r) =>
      (!params.get("country") || r.country === params.get("country")) &&
      (!params.get("visa") || r.visa_type === params.get("visa")) &&
      (!params.get("owner") || r.responsible_id === params.get("owner")) &&
      (!params.get("payment_status") ||
        r.payment_status === params.get("payment_status")) &&
      (!params.get("financial_status") ||
        r.financial_status === params.get("financial_status") ||
        r.balance_status === params.get("financial_status")) &&
      (!type ||
        expenses.some(
          (e) =>
            e.case_id === r.case_id &&
            !e.deleted_at &&
            e.expense_type_id === type &&
            inPeriod(e.spent_on),
        )) &&
      (Boolean(caseId) ||
        !(start || end) ||
        payments.some(
          (p) =>
            p.case_id === r.case_id && !p.deleted_at && inPeriod(p.paid_on),
        ) ||
        expenses.some(
          (e) =>
            e.case_id === r.case_id && !e.deleted_at && inPeriod(e.spent_on),
        )),
  );
  const ids = new Set(rows.map((r) => r.case_id));
  const filteredPayments = payments.filter(
    (p) => ids.has(p.case_id) && inPeriod(p.paid_on),
  );
  const filteredExpenses = expenses.filter(
    (e) =>
      ids.has(e.case_id) &&
      inPeriod(e.spent_on) &&
      (!type || e.expense_type_id === type),
  );
  rows = rows.map((r) => ({
    ...r,
    period_paid: decimal(
      filteredPayments
        .filter((p) => p.case_id === r.case_id && !p.deleted_at)
        .reduce(
          (s, p) => s + cents(p.amount) * (p.type === "REFUND" ? -1n : 1n),
          0n,
        ),
    ),
    period_expenses: decimal(
      filteredExpenses
        .filter((e) => e.case_id === r.case_id && !e.deleted_at)
        .reduce((s, e) => s + cents(e.amount), 0n),
    ),
  }));
  const types = (
    await db.query(
      "SELECT * FROM expense_types ORDER BY sort_order,lower(name)",
    )
  ).rows;
  const events = caseId
    ? (
        await db.query(
          "SELECT e.id,e.kind,e.created_at,e.resolved_at,e.sent_at,j.status delivery_status,j.last_error FROM financial_events e LEFT JOIN jobs j ON j.dedupe_key='finance-event:'||e.id::text WHERE e.case_id=$1 ORDER BY e.created_at DESC LIMIT 100",
          [caseId],
        )
      ).rows
    : [];
  return {
    cases: rows.map((r) => publicFinance(a, r)),
    payments: filteredPayments,
    expenses: filteredExpenses,
    types,
    events,
    timezone: (await settings()).timezone,
    exchange: await exchangeState(),
    staff: a.permissions.includes("can_assign_case_staff")
      ? (
          await db.query(
            'SELECT u.id,u.name FROM "user" u JOIN staff s ON s.user_id=u.id WHERE s.active ORDER BY u.name',
          )
        ).rows
      : [],
  };
}
export async function accountingMutation(a: Actor, action: string, raw: any) {
  requirePermission(a, "accounting.view");
  if (action === "accounting.exchange.sync") {
    requirePermission(a, "accounting.manage");
    await syncExchangeRates();
    return { ok: true };
  }
  return tx(async (c) => {
    if (action === "accounting.type.save") {
      requirePermission(a, "expense_types.manage");
      const d = z
        .object({
          id: uuid.optional(),
          revision: z.number().int().optional(),
          name: z.string().trim().min(1).max(150),
          category: z.string().trim().max(150).default(""),
          description: z.string().max(2000).default(""),
          active: z.boolean().default(true),
          sort_order: z.number().int().min(0).max(100000).default(0),
        })
        .parse(raw);
      const old = d.id
        ? (
            await c.query(
              "SELECT * FROM expense_types WHERE id=$1 FOR UPDATE",
              [d.id],
            )
          ).rows[0]
        : null;
      if (d.id && (!old || old.revision !== d.revision))
        throw new AppError(409, "Тип расхода изменён. Обновите данные");
      if (
        (
          await c.query(
            "SELECT id FROM expense_types WHERE lower(name)=lower($1) AND ($2::uuid IS NULL OR id<>$2)",
            [d.name, d.id || null],
          )
        ).rowCount
      )
        throw new AppError(409, "Такой тип расхода уже существует");
      const row = d.id
        ? (
            await c.query(
              "UPDATE expense_types SET name=$2,category=$3,description=$4,active=$5,sort_order=$6,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",
              [d.id, d.name, d.category, d.description, d.active, d.sort_order],
            )
          ).rows[0]
        : (
            await c.query(
              "INSERT INTO expense_types(name,category,description,active,sort_order) VALUES($1,$2,$3,$4,$5) RETURNING *",
              [d.name, d.category, d.description, d.active, d.sort_order],
            )
          ).rows[0];
      await audit(c, a, "Тип расхода сохранён", "expense_type", row.id, null, {
        before: old,
        after: row,
      });
      return row;
    }
    const caseId = uuid.parse(raw.case_id);
    await requireCase(a, caseId, "accounting.view", c);
    await c.query("SELECT id FROM cases WHERE id=$1 FOR UPDATE", [caseId]);
    await c.query(
      "INSERT INTO case_finances(case_id) VALUES($1) ON CONFLICT DO NOTHING",
      [caseId],
    );
    if (action === "accounting.received.save") {
      requirePermission(a, "payments.edit");
      requirePermission(a, "payments.create");
      const d = z
        .object({
          amount: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/),
          expected: z.string(),
          request_key: uuid,
        })
        .parse(raw);
      const previous = (
        await c.query(
          "SELECT id,case_id,comment FROM client_payments WHERE request_key=$1",
          [d.request_key],
        )
      ).rows[0];
      const note = "Корректировка итога «Получено» до " + d.amount + " сум";
      if (previous) {
        if (previous.case_id !== caseId || previous.comment !== note)
          throw new AppError(409, "Идентификатор занят");
        return { ok: true };
      }
      const current = (await financeRows(c, [caseId]))[0];
      if (current.paid !== d.expected)
        throw new AppError(409, "Сумма уже изменилась. Обновите данные");
      const difference = cents(d.amount) - cents(current.paid);
      if (difference !== 0n) {
        const value = decimal(difference < 0n ? -difference : difference);
        const row = (
          await c.query(
            "INSERT INTO client_payments(case_id,request_key,amount,original_amount,paid_on,type,method,comment,created_by,updated_by) VALUES($1,$2,$3,$3,$4,$5,'OTHER',$6,$7,$7) RETURNING *",
            [
              caseId,
              d.request_key,
              value,
              exchangeToday(),
              difference < 0n ? "REFUND" : "OTHER",
              note,
              a.id,
            ],
          )
        ).rows[0];
        await audit(
          c,
          a,
          "Итог полученных средств скорректирован",
          "client_payments",
          row.id,
          caseId,
          { before: current.paid, after: d.amount },
        );
        await c.query(
          "UPDATE case_finances SET revision=revision+1 WHERE case_id=$1",
          [caseId],
        );
      }
      await recalculateFinance(c, caseId);
      return { ok: true };
    }
    if (action === "accounting.contract.save") {
      requirePermission(a, "accounting.manage");
      requirePermission(a, "accounting.view_contract");
      const d = z
        .object({
          currency: z.enum(["UZS", "USD", "EUR"]).default("UZS"),
          initial_payment: z
            .string()
            .regex(/^\d{0,13}(\.\d{1,2})?$/)
            .optional(),
          responsible_id: z.string().optional(),
          case_revision: z.number().int().optional(),
          contract_amount: z.union([
            z.literal(""),
            z.string().regex(/^\d{1,13}(\.\d{1,2})?$/),
          ]),
          payment_deadline: z.union([z.literal(""), date]),
          revision: z.number().int().min(0),
        })
        .parse(raw);
      const old = (
        await c.query("SELECT * FROM case_finances WHERE case_id=$1", [caseId])
      ).rows[0];
      if (
        old.revision !== d.revision &&
        !(
          d.revision === 0 &&
          old.revision === 1 &&
          old.contract_amount === null
        )
      )
        throw new AppError(
          409,
          "Данные изменены другим сотрудником. Обновите страницу",
        );
      const rec = (await c.query("SELECT * FROM cases WHERE id=$1", [caseId]))
        .rows[0];
      if (d.responsible_id && d.responsible_id !== rec.responsible_id) {
        requirePermission(a, "can_edit_cases");
        requirePermission(a, "can_assign_case_staff");
        if (d.case_revision !== rec.revision)
          throw new AppError(409, "Ответственный уже изменён. Обновите данные");
        if (
          !(
            await c.query("SELECT 1 FROM staff WHERE user_id=$1 AND active", [
              d.responsible_id,
            ])
          ).rowCount
        )
          throw new AppError(400, "Сотрудник недоступен");
        const updated = (
          await c.query(
            "UPDATE cases SET responsible_id=$2,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",
            [caseId, d.responsible_id],
          )
        ).rows[0];
        await schedule(c, "case", updated);
        await audit(
          c,
          a,
          "Ответственный изменён из бухгалтерии",
          "case",
          caseId,
          caseId,
          { from: rec.responsible_id, to: d.responsible_id },
        );
      }
      const contractQuote = d.contract_amount
        ? old.currency === d.currency &&
          old.original_amount !== null &&
          cents(old.original_amount) === cents(d.contract_amount)
          ? {
              amount: old.contract_amount,
              rate: old.exchange_rate,
              date: old.rate_date,
            }
          : await quote(c, d.currency, d.contract_amount, exchangeToday())
        : { amount: null, rate: "1", date: null };
      if (d.initial_payment && cents(d.initial_payment) > 0n) {
        requirePermission(a, "payments.create");
        if (
          (
            await c.query(
              "SELECT 1 FROM client_payments WHERE case_id=$1 AND type='INITIAL' AND deleted_at IS NULL",
              [caseId],
            )
          ).rowCount
        )
          throw new AppError(
            409,
            "Первичный взнос уже существует. Измените его во вкладке платежей",
          );
        const deposit = await quote(
          c,
          d.currency,
          d.initial_payment,
          exchangeToday(),
        );
        const payment = (
          await c.query(
            "INSERT INTO client_payments(case_id,request_key,amount,original_amount,currency,exchange_rate,rate_date,paid_on,type,method,comment,created_by,updated_by) VALUES($1,gen_random_uuid(),$2,$3,$4,$5,$6,$7,'INITIAL','OTHER','Первичный взнос при сохранении договора',$8,$8) RETURNING *",
            [
              caseId,
              deposit.amount,
              d.initial_payment,
              d.currency,
              deposit.rate,
              deposit.date,
              exchangeToday(),
              a.id,
            ],
          )
        ).rows[0];
        await audit(
          c,
          a,
          "Первичный взнос сохранён",
          "client_payments",
          payment.id,
          caseId,
          { after: payment },
        );
      }
      const paid = (await financeRows(c, [caseId]))[0].paid;
      if (
        contractQuote.amount !== null &&
        cents(paid) >= cents(contractQuote.amount)
      )
        d.payment_deadline = "";
      await c.query(
        "UPDATE case_finances SET currency=$2,original_amount=$3,exchange_rate=$4,rate_date=$5 WHERE case_id=$1",
        [
          caseId,
          d.currency,
          d.contract_amount || null,
          contractQuote.rate,
          contractQuote.date,
        ],
      );
      await c.query(
        "UPDATE case_finances SET contract_amount=$2,payment_deadline=$3,revision=revision+1,updated_by=$4,updated_at=now() WHERE case_id=$1",
        [caseId, contractQuote.amount, d.payment_deadline || null, a.id],
      );
      await audit(
        c,
        a,
        "Условия оплаты изменены",
        "case_finance",
        caseId,
        caseId,
        {
          before: {
            contract_amount: old.contract_amount,
            payment_deadline: old.payment_deadline,
          },
          after: d,
        },
      );
    } else {
      const match = /^accounting\.(payment|expense)\.(save|delete)$/.exec(
        action,
      );
      if (!match) throw new AppError(400, "Неизвестная финансовая операция");
      const payment = match[1] === "payment",
        remove = match[2] === "delete";
      const table = payment ? "client_payments" : "client_expenses";
      const id = raw.id ? uuid.parse(raw.id) : null;
      requirePermission(
        a,
        payment
          ? id
            ? "payments.edit"
            : "payments.create"
          : id
            ? "expenses.edit"
            : "expenses.create",
      );
      if (remove && !id) throw new AppError(400, "Запись не указана");
      const old = id
        ? (
            await c.query(
              `SELECT *,to_char(${payment ? "paid_on" : "spent_on"},'YYYY-MM-DD') operation_date FROM ${table} WHERE id=$1 AND case_id=$2 FOR UPDATE`,
              [id, caseId],
            )
          ).rows[0]
        : null;
      if (id && (!old || old.deleted_at || old.revision !== raw.revision))
        throw new AppError(409, "Операция уже изменена. Обновите данные");
      let row: any;
      if (remove)
        row = (
          await c.query(
            `UPDATE ${table} SET deleted_at=now(),updated_at=now(),updated_by=$2,revision=revision+1 WHERE id=$1 RETURNING *`,
            [id, a.id],
          )
        ).rows[0];
      else {
        const common = z
          .object({
            amount,
            currency: z.enum(["UZS", "USD", "EUR"]).default("UZS"),
            date,
            method,
            comment: z.string().max(5000).default(""),
            request_key: uuid.optional(),
          })
          .parse(raw);
        if (!id && !common.request_key)
          throw new AppError(400, "Не указан идентификатор операции");
        if (!id) {
          const previous = (
            await c.query(
              `SELECT *,to_char(${payment ? "paid_on" : "spent_on"},'YYYY-MM-DD') operation_date FROM ${table} WHERE request_key=$1`,
              [common.request_key],
            )
          ).rows[0];
          if (previous) {
            if (previous.case_id !== caseId || previous.created_by !== a.id)
              throw new AppError(409, "Идентификатор занят");
            if (
              previous.deleted_at ||
              cents(previous.original_amount) !== cents(common.amount) ||
              previous.currency !== common.currency ||
              previous.operation_date !== common.date ||
              previous.method !== common.method ||
              previous.comment !== common.comment ||
              (payment
                ? previous.type !== raw.type
                : previous.expense_type_id !== raw.expense_type_id ||
                  (previous.receipt_version_id || null) !==
                    (raw.receipt_version_id || null))
            )
              throw new AppError(
                409,
                "Операция уже сохранена с другими данными. Обновите страницу",
              );
            return { ok: true, id: previous.id };
          }
        }
        const originalAmount = common.amount;
        const converted = await quote(
          c,
          common.currency,
          originalAmount,
          common.date,
          old,
        );
        common.amount = converted.amount;
        if (cents(common.amount) <= 0n)
          throw new AppError(
            400,
            "Сумма после пересчёта должна быть больше нуля",
          );
        if (payment) {
          const type = z
            .enum(["INITIAL", "ADDITIONAL", "FULL", "REFUND", "OTHER"])
            .parse(raw.type);
          row = id
            ? (
                await c.query(
                  "UPDATE client_payments SET amount=$2,paid_on=$3,type=$4,method=$5,comment=$6,updated_by=$7,updated_at=now(),revision=revision+1 WHERE id=$1 RETURNING *",
                  [
                    id,
                    common.amount,
                    common.date,
                    type,
                    common.method,
                    common.comment,
                    a.id,
                  ],
                )
              ).rows[0]
            : (
                await c.query(
                  "INSERT INTO client_payments(case_id,request_key,original_amount,amount,paid_on,type,method,comment,created_by,updated_by) VALUES($1,$2,$3,$3,$4,$5,$6,$7,$8,$8) RETURNING *",
                  [
                    caseId,
                    common.request_key,
                    common.amount,
                    common.date,
                    type,
                    common.method,
                    common.comment,
                    a.id,
                  ],
                )
              ).rows[0];
        } else {
          const typeId = uuid.parse(raw.expense_type_id),
            receipt = raw.receipt_version_id
              ? uuid.parse(raw.receipt_version_id)
              : null;
          const type = (
            await c.query("SELECT * FROM expense_types WHERE id=$1 FOR SHARE", [
              typeId,
            ])
          ).rows[0];
          if (!type || (!type.active && old?.expense_type_id !== type.id))
            throw new AppError(400, "Выберите активный тип расхода");
          if (
            receipt &&
            !(
              await c.query(
                "SELECT 1 FROM document_versions v JOIN documents d ON d.id=v.document_id WHERE v.id=$1 AND d.case_id=$2 AND d.finance_receipt AND NOT d.archived AND v.scan_status NOT IN ('infected','failed')",
                [receipt, caseId],
              )
            ).rowCount
          )
            throw new AppError(400, "Чек недоступен или заблокирован");
          row = id
            ? (
                await c.query(
                  "UPDATE client_expenses SET amount=$2,spent_on=$3,expense_type_id=$4,type_name=$5,type_category=$6,method=$7,comment=$8,receipt_version_id=$9,updated_by=$10,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",
                  [
                    id,
                    common.amount,
                    common.date,
                    type.id,
                    type.name,
                    type.category,
                    common.method,
                    common.comment,
                    receipt,
                    a.id,
                  ],
                )
              ).rows[0]
            : (
                await c.query(
                  "INSERT INTO client_expenses(case_id,request_key,original_amount,amount,spent_on,expense_type_id,type_name,type_category,method,comment,receipt_version_id,created_by,updated_by) VALUES($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING *",
                  [
                    caseId,
                    common.request_key,
                    common.amount,
                    common.date,
                    type.id,
                    type.name,
                    type.category,
                    common.method,
                    common.comment,
                    receipt,
                    a.id,
                  ],
                )
              ).rows[0];
        }
        row = (
          await c.query(
            `UPDATE ${table} SET original_amount=$2,currency=$3,exchange_rate=$4,rate_date=$5 WHERE id=$1 RETURNING *`,
            [
              row.id,
              originalAmount,
              common.currency,
              converted.rate,
              converted.date,
            ],
          )
        ).rows[0];
      }
      await c.query(
        "UPDATE case_finances SET revision=revision+1,updated_by=$2,updated_at=now() WHERE case_id=$1",
        [caseId, a.id],
      );
      await audit(
        c,
        a,
        (payment ? "Платёж" : "Расход") + (remove ? " удалён" : " сохранён"),
        table,
        row.id,
        caseId,
        { before: old, after: row },
      );
    }
    await recalculateFinance(c, caseId);
    return { ok: true };
  });
}

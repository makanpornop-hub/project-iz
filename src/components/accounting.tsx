"use client";
import { isClosedStatus } from "@/lib/domain";
import { useT } from "./language";
import { useState, useEffect, useRef, useId, type FormEvent } from "react";
import Link from "next/link";
import { Plus, Pencil, Trash2, Download, RefreshCw } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import {
  financialLabels,
  paymentTypes,
  paymentMethods,
  money as baseMoney,
  cents,
  decimal,
} from "@/lib/accounting-domain";
import FinanceWarnings from "./finance-warnings";
import { currencies, displayAmount, convertToUzs } from "@/lib/currency-domain";
type Any = Record<string, any>;
const emptyFilters = {
  from: "",
  to: "",
  country: "",
  visa: "",
  owner: "",
  payment_status: "",
  financial_status: "",
  expense_type: "",
};
function TypePicker({
  types,
  value,
  onChange,
  disabled,
}: {
  types: Any[];
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
}) {
  const tr = useT();

  const uid = useId();
  const [text, setText] = useState(
    types.find((t) => t.id === value)?.name || "",
  );
  return (
    <label>
      {tr(" Тип расхода ")}
      <input
        list={uid}
        value={text}
        required
        disabled={disabled}
        placeholder={tr("Начните вводить, например: пер")}
        onChange={(e) => {
          setText(e.target.value);
          onChange(
            types.find(
              (t) =>
                t.name.toLocaleLowerCase() ===
                e.target.value.trim().toLocaleLowerCase(),
            )?.id || "",
          );
        }}
      />
      <datalist id={uid}>
        {types.map((t) => (
          <option key={t.id} value={t.name}>
            {tr(t.category)}
            {tr(!t.active ? " · Неактивен" : "")}
          </option>
        ))}
      </datalist>
    </label>
  );
}
export default function Accounting({
  actor,
  caseId,
  initialData,
  onCaseRefresh,
}: {
  actor: Any;
  caseId?: string;
  initialData?: Any;
  onCaseRefresh?: () => Promise<void>;
}) {
  const tr = useT();

  const [data, setData] = useState<Any | null>(initialData || null),
    [choices, setChoices] = useState<Any[]>(initialData?.cases || []),
    [displayCurrency, setDisplayCurrency] = useState("UZS"),
    [tab, setTab] = useState("overview"),
    [drillClient, setDrillClient] = useState(""),
    [filters, setFilters] = useState(emptyFilters),
    [editor, setEditor] = useState<Any | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(!initialData),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [history, setHistory] = useState(false);
  const formRef = useRef<HTMLFormElement>(null),
    sequence = useRef(0);
  const can = (permission: string) => actor.permissions.includes(permission);
  const zone = data?.timezone || "Asia/Tashkent";
  const rate = (currency: string) =>
    currency === "UZS"
      ? "1"
      : data?.exchange?.rates?.find((r: Any) => r.currency === currency)?.rate;
  const money = (
    value: string | number | null | undefined,
    currency = "UZS",
  ) => {
    if (value == null || displayCurrency === currency)
      return baseMoney(value, currency);
    const from = rate(currency),
      to = rate(displayCurrency);
    return from && to
      ? baseMoney(displayAmount(String(value), from, to), displayCurrency)
      : "Курс недоступен";
  };
  const editorCase = (data?.cases || []).find(
    (r: Any) => r.case_id === editor?.case_id,
  );
  const hasInitial = paymentsAvailable();
  function paymentsAvailable() {
    return (data?.payments || []).some(
      (p: Any) =>
        p.case_id === editor?.case_id && p.type === "INITIAL" && !p.deleted_at,
    );
  }
  const editorFullPaid = (() => {
    try {
      if (editor?.kind !== "contract" || editor.contract_amount === "")
        return false;
      const r =
        editorCase?.currency === editor.currency &&
        String(editorCase?.original_amount) === String(editor.contract_amount)
          ? editorCase.exchange_rate
          : rate(editor.currency);
      if (!r) return false;
      const contract = convertToUzs(editor.contract_amount || "0", r);
      const deposit = convertToUzs(
        editor.initial_payment || "0",
        rate(editor.currency) || r,
      );
      return cents(editorCase?.paid || "0") + cents(deposit) >= cents(contract);
    } catch {
      return false;
    }
  })();
  const today = () => formatInTimeZone(new Date(), zone, "yyyy-MM-dd");
  async function load() {
    const seq = ++sequence.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        ...filters,
        ...(caseId ? { case_id: caseId } : {}),
        ...(drillClient ? { client_id: drillClient } : {}),
      });
      const r = await fetch("/api/data/accounting?" + params, {
        cache: "no-store",
      });
      const result = await r.json();
      if (!r.ok) throw Error(result.error);
      if (seq !== sequence.current) return;
      setData(result);
      if (!Object.values(filters).some(Boolean)) setChoices(result.cases);
    } catch (e) {
      if (seq === sequence.current) setError((e as Error).message);
    } finally {
      if (seq === sequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setDrillClient(p.get("client_id") || "");
    if (["expenses", "payments"].includes(p.get("tab") || ""))
      setTab(p.get("tab")!);
  }, []);
  useEffect(() => {
    void load();
    return () => {
      sequence.current++;
    };
  }, [caseId, drillClient, JSON.stringify(filters)]);
  useEffect(() => {
    if (editor) {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      formRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    }
  }, [editor?.kind, editor?.id, editor?.request_key]);
  const cases: Any[] = data?.cases || [],
    types: Any[] = data?.types || [],
    payments: Any[] = data?.payments || [],
    expenses: Any[] = data?.expenses || [];
  const current = cases[0];
  const caseName = (id: string) => {
    const r =
      choices.find((c) => c.case_id === id) ||
      cases.find((c) => c.case_id === id);
    return r ? `${r.client_name} · CASE-${r.number}` : "Визовое дело";
  };
  const link = (id: string) => (
    <Link href={"/cases/" + id + "#accounting"}>{tr(caseName(id))}</Link>
  );
  const total = (key: string) =>
    decimal(
      cases.reduce((sum, r) => sum + (r[key] != null ? cents(r[key]) : 0n), 0n),
    );
  function open(kind: string, row: Any = {}) {
    setError("");
    setNotice("");
    setEditor({
      kind,
      case_id: caseId || choices[0]?.case_id || "",
      request_key: crypto.randomUUID(),
      amount: "",
      currency: "UZS",
      initial_payment: "",
      type: "ADDITIONAL",
      method: "CASH",
      comment: "",
      expense_type_id: "",
      active: true,
      sort_order: 0,
      ...row,
      ...(kind === "contract"
        ? {
            contract_amount: row.original_amount ?? row.contract_amount ?? "",
            currency: row.currency || "UZS",
            initial_payment: "",
          }
        : {}),
      ...(row.original_amount != null && ["payment", "expense"].includes(kind)
        ? { amount: row.original_amount }
        : {}),
      date: row.paid_on || row.spent_on || row.date || today(),
    });
  }
  async function mutate(action: string, body: Any) {
    const r = await fetch("/api/data/accounting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, data: body }),
    });
    const result = await r.json();
    if (!r.ok) throw Error(result.error || "Операция не выполнена");
    return result;
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editor || busy) return;
    setBusy(true);
    setError("");
    try {
      if (editor.kind === "expense" && !editor.expense_type_id)
        throw Error("Выберите тип расхода из подсказок");
      const payload = { ...editor };
      if (editor.kind === "contract") {
        delete payload.responsible_id;
        delete payload.case_revision;
        if (hasInitial) delete payload.initial_payment;
      }
      if (editor.kind === "type")
        payload.sort_order = Number(payload.sort_order);
      await mutate("accounting." + editor.kind + ".save", payload);
      setEditor(null);
      setNotice("Сохранено. Финансовые итоги пересчитаны.");
      await load();
      await onCaseRefresh?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(kind: string, row: Any) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await mutate("accounting." + kind + ".delete", {
        id: row.id,
        case_id: row.case_id,
        revision: row.revision,
      });
      setNotice("Операция удалена из расчётов и сохранена в истории.");
      await load();
      await onCaseRefresh?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function receipt(file?: File) {
    if (!file || !editor) return;
    if (!editor.case_id) {
      setError("Сначала выберите визовое дело");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("case_id", editor.case_id);
      form.set("file", file);
      const r = await fetch("/api/accounting/receipts", {
        method: "POST",
        body: form,
      });
      const result = await r.json();
      if (!r.ok) throw Error(result.error);
      setEditor((old) => ({
        ...old,
        receipt_version_id: result.id,
        receipt_filename: result.filename,
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const field = (key: string) => (e: any) =>
    setEditor((old) => ({ ...old, [key]: e.target.value }));
  function transactionTable(kind: "payment" | "expense") {
    const list = (kind === "payment" ? payments : expenses).filter(
      (r) => history || !r.deleted_at,
    );
    const edit = can(kind === "payment" ? "payments.edit" : "expenses.edit");
    return (
      <section className="panel padded">
        <div className="workflow-heading">
          <h3>{tr(kind === "payment" ? "Платежи клиента" : "Расходы")}</h3>
          {can(kind === "payment" ? "payments.create" : "expenses.create") && (
            <button disabled={busy} onClick={() => open(kind)}>
              <Plus size={16} />
              {tr(" Добавить ")}
              {tr(kind === "payment" ? "платёж" : "расход")}
            </button>
          )}
        </div>
        {!list.length ? (
          <p className="muted">{tr("Операций пока нет.")}</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {!caseId && <th>{tr("Клиент / дело")}</th>}
                  <th>{tr("Дата")}</th>
                  <th>{tr("Сумма")}</th>
                  <th>{tr("Тип")}</th>
                  <th>{tr("Способ")}</th>
                  <th>{tr("Сотрудник")}</th>
                  <th>{tr("Комментарий / чек")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr
                    key={r.id}
                    className={r.deleted_at ? "finance-deleted" : ""}
                  >
                    {!caseId && <td>{tr(link(r.case_id))}</td>}
                    <td>
                      {tr(r.paid_on || r.spent_on)}
                      {r.deleted_at && (
                        <small>{tr("Удалено из расчётов")}</small>
                      )}
                    </td>
                    <td>
                      {tr(
                        kind === "payment" && r.type === "REFUND" ? "− " : "",
                      )}
                      {tr(money(r.amount))}
                      {r.currency !== "UZS" && (
                        <small>
                          {tr(
                            baseMoney(
                              r.original_amount ?? r.amount,
                              r.currency,
                            ),
                          )}
                          {tr(" ")}
                          {tr(" · курс ")}
                          {tr(r.exchange_rate)} ·{" "}
                          {tr(r.rate_date?.slice(0, 10))}
                        </small>
                      )}
                    </td>
                    <td>
                      {tr(
                        kind === "payment" ? paymentTypes[r.type] : r.type_name,
                      )}
                      {kind === "expense" && (
                        <small>{tr(r.type_category)}</small>
                      )}
                    </td>
                    <td>{tr(paymentMethods[r.method])}</td>
                    <td>{tr(r.employee_name)}</td>
                    <td>
                      {r.comment || "—"}
                      {r.receipt_version_id &&
                        (r.receipt_scan_status === "clean" ? (
                          <a
                            className="text-btn"
                            href={"/api/documents/" + r.receipt_version_id}
                          >
                            <Download size={14} />
                            {tr(" Чек ")}
                          </a>
                        ) : (
                          <small>
                            {tr(
                              r.receipt_scan_status === "pending"
                                ? "Чек проверяется"
                                : "Чек недоступен: проверка не пройдена",
                            )}
                          </small>
                        ))}
                    </td>
                    <td>
                      {!r.deleted_at && edit && (
                        <div className="row-actions">
                          <button
                            disabled={busy}
                            title={tr("Изменить")}
                            onClick={() => open(kind, r)}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            disabled={busy}
                            title={tr(
                              "Удалить из расчётов; запись останется в истории",
                            )}
                            onClick={() => remove(kind, r)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  }
  function caseTable(rows: Any[], period = false) {
    return rows.length ? (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{tr("Клиент / дело")}</th>
              {can("accounting.view_contract") && <th>{tr("Договор")}</th>}
              <th>{tr(period ? "Получено за период" : "Получено")}</th>
              {can("accounting.view_contract") && <th>{tr("Остаток")}</th>}
              <th>{tr(period ? "Расходы за период" : "Расходы")}</th>
              {can("accounting.view_profit") &&
                can("accounting.view_contract") && (
                  <th>{tr("Плановая прибыль")}</th>
                )}
              <th>{tr("Дедлайн / ответственный")}</th>
              <th>{tr("Баланс клиента")}</th>
              <th>{tr("Финансовый статус")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.case_id}
                className={r.warnings.length ? "finance-critical-row" : ""}
              >
                <td>
                  {tr(link(r.case_id))}
                  <small>
                    {r.country} · {r.visa_type}
                  </small>
                  <small>{r.phone}</small>
                </td>
                {can("accounting.view_contract") && (
                  <td>
                    {tr(money(r.contract_amount))}
                    {r.currency !== "UZS" && (
                      <small>
                        {tr(" Договор:")}
                        {tr(" ")}
                        {tr(
                          baseMoney(
                            r.original_amount ?? r.contract_amount,
                            r.currency,
                          ),
                        )}
                      </small>
                    )}
                    {can("accounting.manage") && (
                      <button
                        className="text-btn"
                        title={tr("Изменить договор и дедлайн")}
                        onClick={() => open("contract", r)}
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                  </td>
                )}
                <td>
                  {tr(money(period ? r.period_paid : r.paid))}
                  {!period &&
                    can("payments.edit") &&
                    can("payments.create") && (
                      <button
                        className="text-btn"
                        title={tr("Изменить полученную сумму")}
                        onClick={() =>
                          open("received", {
                            case_id: r.case_id,
                            amount: r.paid,
                            expected: r.paid,
                          })
                        }
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                </td>
                {can("accounting.view_contract") && (
                  <td>
                    {tr(money(r.remaining))}
                    {Number(r.remaining) < 0 && (
                      <small>{tr("Переплата")}</small>
                    )}
                  </td>
                )}
                <td>
                  <a
                    href={
                      "/accounting?client_id=" + r.client_id + "&tab=expenses"
                    }
                    title={tr("Открыть расходы клиента")}
                  >
                    {tr(money(period ? r.period_expenses : r.expenses))}
                    {tr(" · Расходы ")}
                  </a>
                </td>
                {can("accounting.view_profit") &&
                  can("accounting.view_contract") && (
                    <td>{tr(money(r.planned_profit))}</td>
                  )}
                <td>
                  {tr(r.payment_deadline || "Не указан")}
                  <small>
                    {r.days_to_payment == null
                      ? ""
                      : r.days_to_payment < 0
                        ? "Просрочка: " + r.overdue_days + " дн."
                        : r.days_to_payment === 0
                          ? "Сегодня"
                          : "Через " + r.days_to_payment + " дн."}
                  </small>
                  <small>{r.responsible_name}</small>
                  {can("accounting.manage") &&
                    can("accounting.view_contract") && (
                      <button
                        className="text-btn"
                        onClick={() => open("contract", r)}
                      >
                        <Pencil size={14} />
                        {tr(" Изменить ")}
                      </button>
                    )}
                </td>
                <td>
                  {tr(money(r.client_balance ?? r.balance))}
                  <small>
                    {tr(
                      baseMoney(r.client_balance_usd ?? r.balance_usd, "USD"),
                    )}
                  </small>
                </td>
                <td>
                  <span
                    className={"badge finance-status-" + r.financial_status}
                  >
                    {tr(financialLabels[r.financial_status])}
                  </span>
                  <FinanceWarnings value={r} formatMoney={money} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <p className="muted">{tr("По выбранным условиям записей нет.")}</p>
    );
  }
  const tabs = caseId
    ? [
        ["overview", "Обзор"],
        ["payments", "Платежи клиента"],
        ["expenses", "Расходы"],
        ["reports", "Финансовый отчёт"],
      ]
    : [
        ["overview", "Обзор"],
        ["payments", "Платежи клиентов"],
        ["expenses", "Расходы"],
        ["expected", "Ожидаемые платежи"],
        ["reports", "Отчёты"],
        ...(can("expense_types.manage") || can("can_manage_roles")
          ? [["settings", "Настройки"]]
          : []),
      ];
  const pending = cases.filter(
    (r) =>
      r.remaining !== undefined &&
      r.remaining !== null &&
      Number(r.remaining) > 0 &&
      r.days_to_payment !== null &&
      !isClosedStatus(r.workflow_status),
  );
  const weekDay = new Date(today() + "T00:00:00Z").getUTCDay(),
    weekEnd = (7 - weekDay) % 7;
  return (
    <div className="accounting">
      {tab !== "settings" && (
        <section className="panel padded">
          <strong>{tr("Показывать суммы в валюте: ")}</strong>
          <div className="row-actions">
            {Object.entries(currencies).map(([code, label]) => (
              <button
                key={code}
                disabled={code !== "UZS" && !rate(code)}
                aria-pressed={displayCurrency === code}
                className={displayCurrency === code ? "primary" : ""}
                onClick={() => setDisplayCurrency(code)}
              >
                {tr(label)} · {tr(code)}
              </button>
            ))}
          </div>
          <small>
            {tr(
              " Пересчёт отображения по последнему курсу ЦБ. Валюта и суммы сохранённых операций не изменяются. ",
            )}
          </small>
        </section>
      )}
      {drillClient && (
        <section className="panel padded">
          <a href="/accounting">{tr("← Все визовые дела")}</a>
          <h2>{current?.client_name || "Финансы клиента"}</h2>
          <p>
            {tr("Платежи и расходы по доступным визовым делам этого клиента")}
          </p>
        </section>
      )}
      <section className="panel padded finance-exchange">
        <strong>{tr("Курсы ЦБ Узбекистана")}</strong>
        {tr(" ")}
        {(data?.exchange?.rates || []).map((r: Any) => (
          <span key={r.currency}>
            1 {tr(r.currency)} = {tr(baseMoney(Number(r.rate).toFixed(2)))} ·
            {tr(" ")}
            {tr(r.rate_date)}
          </span>
        ))}
        {!data?.exchange?.rates?.length && (
          <span>
            {tr("Курсы ещё не загружены. Порог 50 $ пока не рассчитан.")}
          </span>
        )}
        {tr(" ")}
        {data?.exchange?.sync?.error && (
          <p className="error">{tr(data.exchange.sync.error)}</p>
        )}
        <small>
          {tr(
            data?.exchange?.sync?.succeeded_at
              ? "Последняя синхронизация: " +
                  formatInTimeZone(
                    new Date(data.exchange.sync.succeeded_at),
                    zone,
                    "dd.MM.yyyy HH:mm",
                  ) +
                  ". "
              : "",
          )}
          {tr(
            " Итоги в сумах. Курсы операций фиксируются на их дату. Баланс минимален при остатке ≤ 50 $ по последнему курсу ЦБ. ",
          )}
        </small>
        {can("accounting.manage") && (
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await mutate("accounting.exchange.sync", {});
                await load();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {tr(" Обновить курсы ")}
          </button>
        )}
      </section>
      <div className="tabs standalone">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "selected" : ""}
            onClick={() => {
              setTab(id);
              setEditor(null);
            }}
          >
            {tr(label)}
          </button>
        ))}
        <button disabled={loading || busy} onClick={() => load()}>
          <RefreshCw size={15} />
          {tr(" Обновить ")}
        </button>
      </div>
      {notice && (
        <p className="finance-notice" role="status">
          {tr(notice)}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {tr(error)}
        </p>
      )}
      {(!caseId || tab === "reports") && tab !== "settings" && (
        <div className="panel padded finance-filters">
          <label>
            {tr(" С даты ")}
            <input
              type="date"
              value={filters.from}
              onChange={(e) => setFilters({ ...filters, from: e.target.value })}
            />
          </label>
          <label>
            {tr(" По дату ")}
            <input
              type="date"
              value={filters.to}
              onChange={(e) => setFilters({ ...filters, to: e.target.value })}
            />
          </label>
          {!caseId && (
            <>
              <label>
                {tr(" Страна ")}
                <select
                  value={filters.country}
                  onChange={(e) =>
                    setFilters({ ...filters, country: e.target.value })
                  }
                >
                  <option value="">{tr("Все")}</option>
                  {[...new Set(choices.map((r) => r.country))].map((v) => (
                    <option key={v}>{tr(v)}</option>
                  ))}
                </select>
              </label>
              <label>
                {tr(" Виза ")}
                <select
                  value={filters.visa}
                  onChange={(e) =>
                    setFilters({ ...filters, visa: e.target.value })
                  }
                >
                  <option value="">{tr("Все")}</option>
                  {[...new Set(choices.map((r) => r.visa_type))].map((v) => (
                    <option key={v}>{tr(v)}</option>
                  ))}
                </select>
              </label>
              <label>
                {tr(" Сотрудник ")}
                <select
                  value={filters.owner}
                  onChange={(e) =>
                    setFilters({ ...filters, owner: e.target.value })
                  }
                >
                  <option value="">{tr("Все")}</option>
                  {Array.from(
                    new Map(
                      choices.map((r) => [
                        r.responsible_id,
                        r.responsible_name,
                      ]),
                    ).entries(),
                  ).map(([id, name]) => (
                    <option key={id} value={id}>
                      {tr(name)}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <label>
            {tr(" Статус оплаты ")}
            <select
              value={filters.payment_status}
              onChange={(e) =>
                setFilters({ ...filters, payment_status: e.target.value })
              }
            >
              <option value="">{tr("Все")}</option>
              {["UNSET", "UNPAID", "PARTIALLY_PAID", "PAID"].map((s) => (
                <option key={s} value={s}>
                  {tr(financialLabels[s])}
                </option>
              ))}
            </select>
          </label>
          <label>
            {tr(" Финансовый статус ")}
            <select
              value={filters.financial_status}
              onChange={(e) =>
                setFilters({ ...filters, financial_status: e.target.value })
              }
            >
              <option value="">{tr("Все")}</option>
              {Object.entries(financialLabels).map(([s, l]) => (
                <option key={s} value={s}>
                  {tr(l)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {tr(" Тип расхода ")}
            <select
              value={filters.expense_type}
              onChange={(e) =>
                setFilters({ ...filters, expense_type: e.target.value })
              }
            >
              <option value="">{tr("Все")}</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {tr(!t.active ? " (неактивен)" : "")}
                </option>
              ))}
            </select>
          </label>
          <button onClick={() => setFilters(emptyFilters)}>
            {tr("Сбросить")}
          </button>
        </div>
      )}
      {loading && (
        <p className="muted" role="status">
          {tr(" Загрузка финансовых данных… ")}
        </p>
      )}
      {editor && (
        <form
          ref={formRef}
          className="panel padded finance-editor"
          onSubmit={save}
        >
          <h3>
            {tr(
              editor.kind === "contract"
                ? "Условия оплаты"
                : editor.kind === "received"
                  ? "Изменить полученную сумму"
                  : editor.kind === "type"
                    ? "Тип расхода"
                    : editor.kind === "payment"
                      ? "Платёж клиента"
                      : "Расход",
            )}
          </h3>
          <fieldset disabled={busy}>
            {editor.kind === "type" ? (
              <>
                <label>
                  {tr(" Название ")}
                  <input
                    required
                    maxLength={150}
                    value={editor.name || ""}
                    onChange={field("name")}
                  />
                </label>
                <label>
                  {tr(" Категория ")}
                  <input
                    maxLength={150}
                    value={editor.category || ""}
                    onChange={field("category")}
                  />
                </label>
                <label>
                  {tr(" Описание ")}
                  <textarea
                    maxLength={2000}
                    value={editor.description || ""}
                    onChange={field("description")}
                  />
                </label>
                <label>
                  {tr(" Порядок ")}
                  <input
                    type="number"
                    min={0}
                    max={100000}
                    value={editor.sort_order}
                    onChange={field("sort_order")}
                  />
                </label>
                <label>
                  {tr(" Состояние ")}
                  <select
                    value={editor.active ? "true" : "false"}
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        active: e.target.value === "true",
                      })
                    }
                  >
                    <option value="true">{tr("Активен")}</option>
                    <option value="false">{tr("Неактивен")}</option>
                  </select>
                </label>
              </>
            ) : editor.kind === "received" ? (
              <>
                <label>
                  {tr(" Получено всего по делу, сум ")}
                  <input
                    required
                    type="number"
                    min="0"
                    step="0.01"
                    value={editor.amount}
                    onChange={field("amount")}
                  />
                </label>
                <p className="muted">
                  {tr(
                    " Разница сохранится отдельной корректировкой в истории платежей. Валютные платежи можно редактировать во вкладке «Платежи». ",
                  )}
                </p>
              </>
            ) : editor.kind === "contract" ? (
              <>
                <label>
                  {tr(" Валюта договора ")}
                  <select value={editor.currency} onChange={field("currency")}>
                    {Object.entries(currencies).map(([code, label]) => (
                      <option key={code} value={code}>
                        {tr(label)} · {tr(code)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {tr(" Договорённая сумма ")}
                  <input
                    type="number"
                    min="0"
                    max="9999999999999.99"
                    step="0.01"
                    value={editor.contract_amount ?? ""}
                    onChange={field("contract_amount")}
                  />
                </label>
                <label>
                  {tr(" Первичный взнос ")}
                  {hasInitial ? (
                    <>
                      <input
                        readOnly
                        value={money(editorCase?.initial_payment)}
                      />
                      <small>
                        {tr(
                          " Для изменения сохранённого взноса откройте «Платежи клиента». ",
                        )}
                      </small>
                    </>
                  ) : (
                    <input
                      disabled={!can("payments.create")}
                      type="number"
                      min="0"
                      max="9999999999999.99"
                      step="0.01"
                      value={editor.initial_payment || ""}
                      onChange={field("initial_payment")}
                    />
                  )}
                </label>
                {!hasInitial && (
                  <small>
                    {tr(
                      " Взнос записывается в валюте договора на сегодняшнюю дату; способ оплаты можно уточнить в платежах. ",
                    )}
                  </small>
                )}
                {!editorFullPaid && (
                  <label>
                    {tr(" Дедлайн оплаты остатка ")}
                    <input
                      type="date"
                      value={editor.payment_deadline || ""}
                      onChange={field("payment_deadline")}
                    />
                  </label>
                )}
                {editorFullPaid && (
                  <p className="finance-notice">
                    {tr(" Полная оплата — дедлайн остатка не требуется. ")}
                  </p>
                )}
                <p className="muted">
                  {tr(
                    " Оплата считается просроченной со следующего дня в часовом поясе компании. Пустая сумма означает, что договор ещё не задан. ",
                  )}
                </p>
              </>
            ) : (
              <>
                {!caseId && (
                  <label>
                    {tr(" Визовое дело ")}
                    <select
                      required
                      disabled={!!editor.id || !!editor.receipt_version_id}
                      value={editor.case_id}
                      onChange={field("case_id")}
                    >
                      <option value="">{tr("Выберите дело")}</option>
                      {choices.map((c) => (
                        <option key={c.case_id} value={c.case_id}>
                          {c.client_name} · CASE-{tr(c.number)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  {tr(" Валюта ")}
                  <select value={editor.currency} onChange={field("currency")}>
                    {Object.entries(currencies).map(([code, label]) => (
                      <option key={code} value={code}>
                        {tr(label)} · {tr(code)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="form-row">
                  <label>
                    {tr(" Сумма ")}
                    <input
                      required
                      type="number"
                      min="0.01"
                      max="9999999999999.99"
                      step="0.01"
                      value={editor.amount}
                      onChange={field("amount")}
                    />
                  </label>
                  <label>
                    {tr(" Дата ")}
                    <input
                      required
                      type="date"
                      value={editor.date}
                      onChange={field("date")}
                    />
                  </label>
                </div>
                {editor.kind === "payment" ? (
                  <label>
                    {tr(" Тип платежа ")}
                    <select value={editor.type} onChange={field("type")}>
                      {Object.entries(paymentTypes).map(([v, l]) => (
                        <option key={v} value={v}>
                          {tr(l)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <TypePicker
                    key={editor.request_key}
                    disabled={busy}
                    types={types.filter(
                      (t) => t.active || t.id === editor.expense_type_id,
                    )}
                    value={editor.expense_type_id}
                    onChange={(id) =>
                      setEditor({ ...editor, expense_type_id: id })
                    }
                  />
                )}
                <label>
                  {tr(" Способ оплаты ")}
                  <select value={editor.method} onChange={field("method")}>
                    {Object.entries(paymentMethods).map(([v, l]) => (
                      <option key={v} value={v}>
                        {tr(l)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {tr(" Комментарий ")}
                  <textarea
                    maxLength={5000}
                    value={editor.comment}
                    onChange={field("comment")}
                  />
                </label>
                {editor.kind === "expense" && (
                  <div>
                    <label>
                      {tr(" Прикреплённый чек")}
                      {tr(" ")}
                      {can("can_upload_documents") && (
                        <input
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                          onChange={(e) => receipt(e.target.files?.[0])}
                        />
                      )}
                    </label>
                    {editor.receipt_filename && (
                      <p>
                        {tr(editor.receipt_filename)}
                        {tr(" ")}
                        <button
                          type="button"
                          onClick={() =>
                            setEditor({
                              ...editor,
                              receipt_version_id: null,
                              receipt_filename: null,
                            })
                          }
                        >
                          {tr(" Убрать из расхода ")}
                        </button>
                      </p>
                    )}
                  </div>
                )}
                <p className="muted">
                  {tr(
                    " Сотрудник и время операции записываются автоматически. Возврат вводится положительной суммой и вычитается из оплаты. ",
                  )}
                </p>
              </>
            )}
          </fieldset>
          <div className="row-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditor(null)}
            >
              {tr(" Отмена ")}
            </button>
            <button disabled={busy} className="primary">
              {tr(busy ? "Сохранение…" : "Сохранить")}
            </button>
          </div>
          {error && (
            <p className="error" role="alert">
              {tr(error)}
            </p>
          )}
        </form>
      )}
      {(tab === "overview" || tab === "reports") && (
        <>
          {caseId && current && (
            <section className="panel padded">
              <div className="workflow-heading">
                <div>
                  <h3>
                    {current.client_name} · CASE-{tr(current.number)}
                  </h3>
                  <p>
                    {current.country} · {current.visa_type} ·{tr(" ")}
                    {current.responsible_name}
                  </p>
                </div>
                {can("accounting.manage") &&
                  can("accounting.view_contract") && (
                    <button
                      onClick={() =>
                        open("contract", {
                          ...current,
                          payment_deadline: current.payment_deadline || "",
                          contract_amount: current.contract_amount ?? "",
                        })
                      }
                    >
                      <Pencil size={15} />
                      {tr(" Условия оплаты ")}
                    </button>
                  )}
              </div>
              <FinanceWarnings value={current} formatMoney={money} />
              <p>
                {tr(" Статус оплаты: ")}
                {tr(financialLabels[current.payment_status])} ·{tr(" ")}
                {tr(financialLabels[current.financial_status])}
              </p>
            </section>
          )}
          <div className="finance-metrics">
            {caseId && can("accounting.view_contract") && (
              <Metric
                label="Валюта договора"
                value={
                  currencies[
                    (current?.currency || "UZS") as keyof typeof currencies
                  ]
                }
              />
            )}
            {can("accounting.view_contract") && (
              <Metric
                label="Договорённая сумма"
                value={
                  caseId
                    ? money(current?.contract_amount)
                    : money(total("contract_amount"))
                }
              />
            )}
            {caseId && (
              <>
                <Metric
                  label="Первичный взнос"
                  value={money(current?.initial_payment)}
                />
                <Metric
                  label="Дата первичного взноса"
                  value={current?.initial_date || "—"}
                />
              </>
            )}
            <Metric label="Оплачено всего" value={money(total("paid"))} />
            {can("accounting.view_contract") && (
              <Metric
                label="Остаток к оплате"
                value={
                  caseId ? money(current?.remaining) : money(total("remaining"))
                }
              />
            )}
            {caseId && current?.payment_status !== "PAID" && (
              <Metric
                label="Дедлайн оплаты остатка"
                value={current?.payment_deadline || "Не указан"}
              />
            )}
            <Metric label="Общие расходы" value={money(total("expenses"))} />
            <Metric
              label="Баланс: получено минус расходы"
              value={money(total("balance"))}
            />

            {can("accounting.view_profit") && (
              <>
                {can("accounting.view_contract") && (
                  <Metric
                    label="Плановая прибыль"
                    value={
                      caseId
                        ? money(current?.planned_profit)
                        : money(total("planned_profit"))
                    }
                  />
                )}
                <Metric
                  label="Фактический денежный результат"
                  value={money(total("cash_result"))}
                />
              </>
            )}
            {!caseId && (
              <>
                <Metric
                  label="Дела с просроченной оплатой"
                  value={String(
                    cases.filter((r) => r.warnings.includes("PAYMENT_OVERDUE"))
                      .length,
                  )}
                />
                <Metric
                  label="Дела: расходы выше оплаты"
                  value={String(
                    cases.filter((r) =>
                      r.warnings.includes("EXPENSES_EXCEED_PAYMENTS"),
                    ).length,
                  )}
                />
              </>
            )}
          </div>
          {tab === "reports" && (
            <>
              <p className="muted">
                {tr(
                  " Договор, остаток и прибыль — текущие итоги по выбранным делам. Платежи и расходы в отчётной таблице — за выбранный период. Суммы в сумах. ",
                )}
              </p>
              <div className="finance-metrics">
                <Metric
                  label="Платежи за период (за вычетом возвратов)"
                  value={money(total("period_paid"))}
                />
                <Metric
                  label="Расходы за период по фильтру"
                  value={money(total("period_expenses"))}
                />
              </div>
              {!caseId && (
                <section className="panel padded">
                  {tr(caseTable(cases, true))}
                </section>
              )}
            </>
          )}
          {caseId ? (
            <>
              {tr(transactionTable("payment"))}
              {tr(transactionTable("expense"))}
            </>
          ) : tab === "overview" ? (
            <>
              {[
                [
                  "Просроченные платежи",
                  cases.filter((r) => r.warnings.includes("PAYMENT_OVERDUE")),
                ],
                [
                  "Расходы выше оплаты",
                  cases.filter((r) =>
                    r.warnings.includes("EXPENSES_EXCEED_PAYMENTS"),
                  ),
                ],
                [
                  "Ближайшие платежи",
                  pending.filter(
                    (r) => r.days_to_payment >= 0 && r.days_to_payment <= 7,
                  ),
                ],
              ].map(([title, rows]) => (
                <section className="panel padded" key={String(title)}>
                  <h3>{tr(String(title))}</h3>
                  {tr(caseTable(rows as Any[]))}
                </section>
              ))}
              <section className="panel padded">
                <h3>{tr("Все доступные визовые дела")}</h3>
                {tr(caseTable(cases))}
              </section>
            </>
          ) : null}
        </>
      )}
      {(tab === "payments" || tab === "expenses" || caseId) && (
        <label className="finance-history-toggle">
          <input
            type="checkbox"
            checked={history}
            onChange={(e) => setHistory(e.target.checked)}
          />
          {tr(" Показать удалённые операции ")}
        </label>
      )}
      {tr(tab === "payments" && transactionTable("payment"))}
      {tr(tab === "expenses" && transactionTable("expense"))}
      {tab === "expected" &&
        (!can("accounting.view_contract") ? (
          <p className="muted">
            {tr(
              " Для просмотра остатков требуется право «Просмотр договора и остатка». ",
            )}
          </p>
        ) : (
          <>
            {[
              ["Сегодня", pending.filter((r) => r.days_to_payment === 0)],
              ["Завтра", pending.filter((r) => r.days_to_payment === 1)],
              [
                "На этой неделе",
                pending.filter(
                  (r) => r.days_to_payment >= 0 && r.days_to_payment <= weekEnd,
                ),
              ],
              ["Просрочено", pending.filter((r) => r.days_to_payment < 0)],
            ].map(([title, rows]) => (
              <section className="panel padded" key={String(title)}>
                <h3>{tr(String(title))}</h3>
                {tr(caseTable(rows as Any[]))}
              </section>
            ))}
          </>
        ))}
      {tab === "settings" && (
        <section className="panel padded">
          <div className="workflow-heading">
            <h3>{tr("Типы расходов")}</h3>
            {can("expense_types.manage") && (
              <button onClick={() => open("type")}>
                <Plus size={16} />
                {tr(" Добавить тип ")}
              </button>
            )}
          </div>
          <p className="muted">
            {tr(
              " Неактивные типы сохраняются в старых операциях. Их нельзя выбрать для нового расхода. ",
            )}
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{tr("Название")}</th>
                  <th>{tr("Категория")}</th>
                  <th>{tr("Описание")}</th>
                  <th>{tr("Порядок")}</th>
                  <th>{tr("Состояние")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {types.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td>{tr(t.category)}</td>
                    <td>{t.description}</td>
                    <td>{tr(t.sort_order)}</td>
                    <td>{tr(t.active ? "Активен" : "Неактивен")}</td>
                    <td>
                      {can("expense_types.manage") && (
                        <button onClick={() => open("type", t)}>
                          <Pencil size={15} />
                          {tr(" Изменить ")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {can("can_manage_roles") && (
            <p>
              <Link href="/roles">
                {tr("Настроить права бухгалтерии для ролей →")}
              </Link>
            </p>
          )}
        </section>
      )}
      {caseId && data?.events?.length > 0 && (
        <details className="panel padded">
          <summary>{tr("История финансовых предупреждений")}</summary>
          {data?.events.map((e: Any) => (
            <p key={e.id}>
              {tr(
                formatInTimeZone(
                  new Date(e.created_at),
                  zone,
                  "dd.MM.yyyy HH:mm",
                ),
              )}
              {tr(" ")}· {tr(financialLabels[e.kind])} ·{tr(" ")}
              {tr(e.resolved_at ? "Устранено" : "Активно")} ·{tr(" ")}
              {tr(
                e.sent_at
                  ? "Telegram: отправлено"
                  : "Telegram: " +
                      (e.resolved_at
                        ? "отменено"
                        : e.delivery_status === "failed"
                          ? "ошибка доставки"
                          : "в очереди"),
              )}
            </p>
          ))}
        </details>
      )}
    </div>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  const tr = useT();

  return (
    <div className="panel padded finance-metric">
      <span>{tr(label)}</span>
      <strong>{tr(value)}</strong>
    </div>
  );
}

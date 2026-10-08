"use client";
import { LanguageSelector, useT } from "./language";
import {
  useEffect,
  useState,
  useCallback,
  useRef,
  type FormEvent,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import AgentTools from "./agent-tools";
import BlankLoading from "./blank-loading";
import Partners from "./partners";
import Accounting from "./accounting";
import TaskPage from "./task-page";
import CaseDeadlineInput from "./case-deadline-input";
import NewCaseFinance from "./new-case-finance";
import CaseRequiredFields from "./case-required-fields";
import DashboardCases from "./dashboard-cases";
import type { CaseFormPolicy } from "@/lib/case-form-domain";
import ContractTemplate from "./contract-template";
import TelegramSettings from "./telegram-settings";
import FinanceWarnings from "./finance-warnings";
import CaseWorkflow from "./case-workflow";
import CaseFollowup from "./case-followup";
import CaseChat from "./case-chat";
import ChatHub from "./chat-hub";
import DeadlineRemaining from "./deadline-remaining";
import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";
import {
  LayoutDashboard,
  BriefcaseBusiness,
  ListTodo,
  CalendarDays,
  Bell,
  Settings,
  UserRound,
  Search,
  Plus,
  ArrowUpRight,
  ArrowRight,
  Check,
  Clock3,
  FileText,
  FolderOpen,
  ChevronRight,
  ChevronLeft,
  LogOut,
  ShieldCheck,
  X,
  Loader2,
  Download,
  Upload,
  Archive,
  CheckCircle2,
  AlertCircle,
  Menu,
  SlidersHorizontal,
  Send,
  RefreshCw,
  Globe2,
  Users,
  Activity,
  MessageCircle,
} from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import {
  labels,
  caseStatuses,
  visaTypes,
  taskStatuses,
  overdue,
  permissions,
  permissionLabels,
  type Permission,
} from "@/lib/domain";
const authClient = createAuthClient({ plugins: [usernameClient()] });
const nav = [
  ["/", "Обзор", LayoutDashboard],
  ["/cases", "Визовые дела", BriefcaseBusiness],
  ["/tasks", "Задачи", ListTodo],
  ["/deadlines", "Сроки", CalendarDays],
  ["/chats", "Чат", MessageCircle],
  ["/notifications", "Уведомления", Bell],
  ["/partners", "Информация партнёров", Users],
  ["/accounting", "Бухгалтерия", BriefcaseBusiness],
] as const;
type Any = Record<string, any>;
function Badge({ value }: { value: string }) {
  const tr = useT();

  return (
    <span className={`badge b-${value.toLowerCase().replaceAll(" ", "-")}`}>
      {tr(labels[value] || value)}
    </span>
  );
}
function Empty({
  title = "Здесь пока ничего нет",
  text = "Новые записи появятся в этом разделе.",
  action,
}: {
  title?: string;
  text?: string;
  action?: React.ReactNode;
}) {
  const tr = useT();

  return (
    <div className="empty">
      <FolderOpen size={36} />
      <h3>{tr(title)}</h3>
      <p>{tr(text)}</p>
      {tr(action)}
    </div>
  );
}
async function api(section: string, body?: unknown) {
  const r = await fetch(
    "/api/data/" + section,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  );
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Ошибка запроса");
  return data;
}
export default function Workspace() {
  const tr = useT();

  const [clientDetails, setClientDetails] = useState({
    name: "",
    phone: "",
    email: "",
  });
  const [contractReady, setContractReady] = useState(false);
  const [casePolicy, setCasePolicy] = useState<CaseFormPolicy | null>(null);
  const requiredCase = (field: string) =>
    !!casePolicy?.required.includes(field as any);
  const [dashboardStage, setDashboardStage] = useState("");
  const [dashboardTaskFilter, setDashboardTaskFilter] = useState("");
  function filterDashboard(stage: string, taskFilter = "") {
    setDashboardStage(stage);
    setDashboardTaskFilter(taskFilter);
    setPage(1);
  }
  const pathname = usePathname(),
    router = useRouter();
  const [health, setHealth] = useState<Any | null>(null),
    [actor, setActor] = useState<Any | null>(null),
    [config, setConfig] = useState<Any>({ timezone: "Asia/Tashkent" }),
    [data, setData] = useState<any>(null),
    [dataKey, setDataKey] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [modal, setModal] = useState<Any | null>(null),
    [staff, setStaff] = useState<Any[]>([]),
    [caseOptions, setCaseOptions] = useState<Any[]>([]),
    [clients, setClients] = useState<Any[]>([]),
    [roleOptions, setRoleOptions] = useState<Any[]>([]),
    [busy, setBusy] = useState(false),
    [q, setQ] = useState(""),
    [status, setStatus] = useState(""),
    [owner, setOwner] = useState(""),
    [visa, setVisa] = useState(""),
    [page, setPage] = useState(1),
    [tab, setTab] = useState("all"),
    [mobile, setMobile] = useState(false);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) setModal(null);
      if (e.key === "Tab" && dialog) {
        const nodes = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            "button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled)",
          ),
        );
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [!!modal, busy]);
  const caseId = pathname.startsWith("/cases/") ? pathname.split("/")[2] : null;
  const taskId = pathname.startsWith("/tasks/") ? pathname.split("/")[2] : null;
  const section =
    pathname === "/settings/contracts"
      ? "settings-contracts"
      : pathname === "/settings/telegram"
        ? "settings-telegram"
        : taskId
          ? "task"
          : caseId
            ? "case"
            : pathname === "/"
              ? "dashboard"
              : pathname.slice(1);
  const can = (p: Permission) => actor?.permissions?.includes(p);
  const dt = (d: string | Date | null, short = false) =>
    d
      ? formatInTimeZone(
          new Date(d),
          config.timezone,
          short ? "dd.MM" : "dd.MM.yyyy, HH:mm",
        )
      : "Не указан";
  const requestSequence = useRef(0);
  const loadedDataKey = useRef("");
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const dashboardView = data?.dashboardSelection || {
    stage: dashboardStage,
    taskFilter: dashboardTaskFilter,
    page,
  };
  const load = useCallback(
    async (quiet = false) => {
      if (!actor) return;
      const sequence = ++requestSequence.current;
      const currentKey = section + (caseId || taskId);
      const inlineDashboard =
        section === "dashboard" && loadedDataKey.current === currentKey;
      if (inlineDashboard) setDashboardLoading(true);
      else if (!quiet) setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          q,
          status,
          owner,
          visa,
          page: String(page),
          ...(section === "dashboard"
            ? { stage: dashboardStage, task_filter: dashboardTaskFilter }
            : {}),
          ...(caseId || taskId ? { id: caseId || taskId! } : {}),
        });
        const result = await api(section + "?" + params);
        if (sequence !== requestSequence.current) return;
        setData(
          section === "dashboard"
            ? {
                ...result,
                dashboardSelection: {
                  stage: dashboardStage,
                  taskFilter: dashboardTaskFilter,
                  page,
                },
              }
            : result,
        );
        loadedDataKey.current = currentKey;
        setDataKey(currentKey);
        if (section === "users") setRoleOptions(await api("role-options"));
      } catch (e) {
        if (sequence === requestSequence.current)
          setError((e as Error).message);
      } finally {
        if (sequence === requestSequence.current) {
          setLoading(false);
          setDashboardLoading(false);
        }
      }
    },
    [
      actor,
      section,
      caseId,
      taskId,
      q,
      status,
      owner,
      visa,
      page,
      dashboardStage,
      dashboardTaskFilter,
    ],
  );
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(async (h) => {
        if (h.ready) {
          try {
            const me = await api("me");
            setActor(me.actor);
            setConfig(me.settings);
          } catch {}
        }
        setHealth(h);
        setLoading(false);
      })
      .catch(() => {
        setHealth({ ready: false, reason: "database" });
        setLoading(false);
      });
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    setTab(window.location.hash === "#accounting" ? "accounting" : "all");
    setPage(1);
    setMobile(false);
    setModal(null);
  }, [pathname]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const [chatTarget, setChatTarget] = useState<{
    thread?: string;
    document?: string;
    message?: string;
  }>({});
  const [chatAttachment, setChatAttachment] = useState<Any | null>(null);
  const [focusDocument, setFocusDocument] = useState("");
  function openChat(
    target: { thread?: string; document?: string; message?: string } = {},
  ) {
    setChatTarget(target);
    setTab("chat");
    window.location.hash = "chat?" + new URLSearchParams(target).toString();
  }
  useEffect(() => {
    function followHash() {
      const [page, query] = window.location.hash.slice(1).split("?");
      if (page === "chat") {
        const p = new URLSearchParams(query);
        setChatTarget({
          thread: p.get("thread") || undefined,
          document: p.get("document") || undefined,
          message: p.get("message") || undefined,
        });
        setTab("chat");
      } else if (
        ["accounting", "followup", "tasks", "history", "all"].includes(page)
      ) {
        setTab(page);
        if (page === "all")
          setFocusDocument(new URLSearchParams(query).get("document") || "");
      }
    }
    followHash();
    window.addEventListener("hashchange", followHash);
    return () => window.removeEventListener("hashchange", followHash);
  }, [pathname]);
  useEffect(() => {
    if (tab !== "all" || !focusDocument) return;
    const node = document.getElementById("workflow-field-" + focusDocument);
    const group = node?.closest<HTMLDetailsElement>("details.workflow-group");
    if (group) group.open = true;
    node?.scrollIntoView({ block: "center", behavior: "smooth" });
    node?.focus({ preventScroll: true });
    if (node) setFocusDocument("");
  }, [tab, focusDocument, data]);
  async function open(kind: string, record: Any = {}) {
    if (kind === "edit-task") {
      router.push("/tasks/" + record.id);
      return;
    }
    if (kind === "case") {
      setContractReady(false);
      setCasePolicy(null);
    }
    if (kind === "case" || kind === "edit-case")
      setClientDetails({
        name: record.name || "",
        phone: record.phone || "",
        email: record.email || "",
      });
    setError("");
    setModal({ kind, ...record });
    try {
      if (["case", "task", "edit-case", "edit-task"].includes(kind))
        setStaff(await api("staff"));
      if (kind === "task" && !caseId) setCaseOptions(await api("cases"));
      if (kind === "case") {
        setClients(await api("clients"));
        setCasePolicy(await api("case-form"));
      }
      if (kind === "user") setRoleOptions(await api("role-options"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function act(action: string, d: Any) {
    setBusy(true);
    try {
      const r = await api("mutate", { action, data: d });
      setModal(null);
      setToast("Изменения сохранены");
      await load();
      return r;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const d = Object.fromEntries(f.entries()) as Any;
    const kind = modal?.kind;
    if (kind === "case" || kind === "edit-case") {
      const result = await act(
        kind === "case" ? "case.create" : "case.update",
        {
          ...d,
          ...(kind === "case" && d.contract_amount
            ? {
                finance: {
                  currency: d.contract_currency,
                  contract_amount: d.contract_amount,
                  initial_payment: d.initial_payment || "",
                  payment_deadline: d.payment_deadline || "",
                  method: d.initial_method || "OTHER",
                },
              }
            : {}),
          ...(kind === "edit-case" ? { id: caseId } : {}),
        },
      );
      if (kind === "case" && result?.id) router.push("/cases/" + result.id);
    }
    if (kind === "task" || kind === "edit-task") {
      if (
        kind === "task" &&
        !(
          ["Administrator", "Manager"].includes(actor?.role) &&
          can("can_assign_tasks")
        )
      )
        delete d.escalation_id;
      const result = await act(
        kind === "task" ? "task.create" : "task.update",
        {
          ...d,
          case_id: caseId || d.case_id,
          ...(kind === "edit-task" ? { id: modal?.id } : {}),
        },
      );
      if (result?.id) router.push("/tasks/" + result.id);
    }
    if (kind === "user") await act("user.create", d);
    if (kind === "user-password")
      await act("user.password", { id: modal?.id, password: d.password });
    if (kind === "document")
      await act("document.create", { ...d, case_id: caseId });
    if (kind === "upload") {
      setBusy(true);
      try {
        f.set("case_id", caseId!);
        const r = await fetch("/api/documents", { method: "POST", body: f });
        const result = await r.json();
        if (!r.ok) throw new Error(result.error);
        setModal(null);
        setToast("Файл сохранён и ожидает проверки безопасности");
        await load();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    }
    if (kind === "review")
      await act("document.review", { ...d, id: modal?.id });
  }
  const button = (kind: string, label: string) => (
    <button className="primary" onClick={() => open(kind)}>
      <Plus size={18} />
      {tr(label)}
    </button>
  );
  if (!health) return <BlankLoading />;
  if (!health.ready)
    return (
      <div className="setup">
        <LanguageSelector floating />
        <div className="brand">
          <span className="brandmark">iz</span>Project Iz
        </div>
        <div className="setup-card">
          <span className="eyebrow">{tr("ПЕРВЫЙ ЗАПУСК")}</span>
          <h1>
            {tr(" Ваше рабочее пространство ")}
            <br />
            {tr(" почти готово. ")}
          </h1>
          <p>
            {tr(
              " Подключите базу данных и создайте администратора, чтобы начать вести визовые дела. ",
            )}
          </p>
          <div className="setup-steps">
            {[
              "Настроить подключение к базе данных",
              "Применить структуру базы",
              "Создать первого администратора",
            ].map((s, i) => (
              <div key={s}>
                <span>{tr(i + 1)}</span>
                <strong>{tr(s)}</strong>
              </div>
            ))}
          </div>
          <div className="notice">
            <ShieldCheck size={20} />
            <span>
              {tr(
                " Инструкция запуска находится в файле README.md в папке проекта. Данные клиентов не используются для демонстрации. ",
              )}
            </span>
          </div>
          <button className="primary" onClick={() => location.reload()}>
            <RefreshCw size={17} />
            {tr(" Проверить подключение ")}
          </button>
        </div>
        <div className="setup-foot">
          PROJECT IZ <span>{tr("Внутренняя система визовой компании")}</span>
        </div>
      </div>
    );
  if (!actor) return <Login onLogin={() => location.reload()} />;
  const title = caseId
    ? "Визовое дело"
    : (
        {
          dashboard: "Обзор",
          cases: "Визовые дела",
          tasks: "Задачи",
          task: "Задача",
          deadlines: "Сроки",
          notifications: "Уведомления",
          chats: "Чат",
          partners: "Информация партнёров",
          accounting: "Бухгалтерия",
          settings: "Настройки",
          "settings-contracts": "Шаблон договора DOCX",
          "settings-telegram": "Telegram-чаты",
          users: "Сотрудники",
          roles: "Роли и права",
          audit: "Журнал действий",
          profile: "Мой профиль",
        } as Any
      )[section] || "Страница не найдена";
  function taskTable(rows: Any[], compact = false) {
    const today = formatInTimeZone(new Date(), config.timezone, "yyyy-MM-dd");
    const filtered = rows.filter(
      (t) =>
        tab === "all" ||
        tab === "tasks" ||
        (tab === "mine" && t.responsible_id === actor?.id) ||
        (tab === "overdue" && overdue(t.status, t.deadline)) ||
        (tab === "completed" &&
          ["Completed", "Cancelled"].includes(t.status)) ||
        (tab === "today" &&
          !["Completed", "Cancelled"].includes(t.status) &&
          formatInTimeZone(
            new Date(t.deadline),
            config.timezone,
            "yyyy-MM-dd",
          ) === today) ||
        (tab === "week" &&
          !["Completed", "Cancelled"].includes(t.status) &&
          new Date(t.deadline) >= new Date() &&
          new Date(t.deadline).getTime() < Date.now() + 7 * 86400000),
    );
    return filtered.length ? (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{tr("Задача / дело")}</th>
              <th>{tr("Ответственный")}</th>
              <th>{tr("Срок")}</th>
              <th>{tr("Статус")}</th>
              {!compact && <th />}
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <tr key={t.entity + t.id}>
                <td>
                  <Link
                    className="row-title"
                    href={
                      t.entity === "case"
                        ? "/cases/" + t.case_id
                        : "/tasks/" + t.id
                    }
                  >
                    {tr(t.title)}
                  </Link>
                  <small>
                    {t.client_name || data?.details?.name}
                    {tr(" ")}
                    <span>
                      · CASE-
                      {tr(
                        String(t.number || data?.details?.number).padStart(
                          3,
                          "0",
                        ),
                      )}
                    </span>
                  </small>
                </td>
                <td>
                  <span className="person">
                    <i>{t.responsible_name?.[0]}</i>
                    {t.responsible_name}
                  </span>
                </td>
                <td className={overdue(t.status, t.deadline) ? "danger" : ""}>
                  {tr(dt(t.deadline))}
                  {overdue(t.status, t.deadline) && (
                    <small className="danger">{tr("Просрочено")}</small>
                  )}
                </td>
                <td>
                  <Badge value={t.status} />
                </td>
                {!compact && (
                  <td>
                    {t.entity !== "case" && (
                      <div className="row-actions">
                        {can("can_edit_tasks") && (
                          <button
                            className="text-btn"
                            onClick={() => open("edit-task", t)}
                          >
                            {tr(" Изменить ")}
                          </button>
                        )}
                        {can("can_complete_tasks") &&
                          t.status !== "Completed" && (
                            <button
                              aria-label={tr("Завершить задачу")}
                              className="icon-btn"
                              disabled={busy}
                              onClick={() =>
                                act("task.status", {
                                  id: t.id,
                                  status: "Completed",
                                })
                              }
                            >
                              <Check size={18} />
                            </button>
                          )}
                        {can("can_edit_tasks") && t.status === "Completed" && (
                          <button
                            className="text-btn"
                            onClick={() =>
                              act("task.status", { id: t.id, status: "To do" })
                            }
                          >
                            {tr(" Открыть ")}
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <Empty
        title={tr("Задач пока нет")}
        text="Создайте задачу в визовом деле — она появится здесь."
      />
    );
  }
  return (
    <div className={section === "chats" ? "app chat-page" : "app"}>
      <AgentTools />
      <aside className={mobile ? "sidebar open" : "sidebar"}>
        <Link className="brand" href="/">
          <span className="brandmark">iz</span>
          <span>
            Project Iz<small>{tr("ВИЗОВЫЙ ОФИС")}</small>
          </span>
        </Link>
        <div className="workspace-label">
          <span className="office-icon">
            <BriefcaseBusiness size={17} />
          </span>
          <div>
            {tr(" Рабочее пространство")}
            <small>{tr("Команда компании")}</small>
          </div>
          <ChevronRight size={14} />
        </div>
        <p className="nav-caption">{tr("РАБОТА")}</p>
        <nav>
          {nav
            .filter(([url]) => url !== "/accounting" || can("accounting.view"))
            .map(([url, name, Icon]) => (
              <Link
                key={url}
                href={url}
                className={
                  pathname === url || (url === "/cases" && caseId)
                    ? "active"
                    : ""
                }
              >
                <Icon size={19} />
                {tr(name)}
                {url === "/" && <span className="nav-dot" />}
              </Link>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="secure-note">
            <ShieldCheck size={19} />
            <span>
              {tr(" Закрытое пространство")}
              <small>{tr("Доступ только сотрудникам")}</small>
            </span>
          </div>
          {can("can_manage_settings") && (
            <Link
              className={section.startsWith("settings") ? "active" : ""}
              href="/settings"
            >
              <Settings size={19} />
              {tr(" Настройки ")}
            </Link>
          )}
          <Link href="/profile" className="profile-link">
            <span className="avatar">
              {actor.name?.slice(0, 2).toUpperCase()}
            </span>
            <span>
              {actor.name}
              <small>{tr(labels[actor.role] || actor.role)}</small>
            </span>
            <ChevronRight size={16} />
          </Link>
        </div>
      </aside>
      {mobile && (
        <button
          className="menu-overlay"
          aria-label={tr("Закрыть меню")}
          onClick={() => setMobile(false)}
        />
      )}
      <div className="main">
        <header className="topbar">
          <button
            className="icon-btn mobile-only"
            onClick={() => setMobile(!mobile)}
            aria-label={tr("Меню")}
          >
            <Menu size={20} />
          </button>
          <div className="crumb">
            {tr(" Рабочее пространство ")}
            <ChevronRight size={14} />
            <span>{tr(title)}</span>
          </div>
          <div className="top-right">
            <LanguageSelector />
            <span className="today">
              <CalendarDays size={15} />
              {tr(formatInTimeZone(new Date(), config.timezone, "dd.MM.yyyy"))}
            </span>
            <Link
              aria-label={tr("Уведомления")}
              className="icon-btn"
              href="/notifications"
            >
              <Bell size={19} />
            </Link>
            <Link className="avatar small" href="/profile">
              {actor.name?.[0]}
            </Link>
          </div>
        </header>
        <main>
          {section === "chats" && (
            <button
              className="icon-btn chat-menu-toggle"
              onClick={() => setMobile(true)}
              aria-label={tr("Меню")}
            >
              <Menu size={20} />
            </button>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {tr(
                  section === "dashboard" ? "ВСЁ ПОД КОНТРОЛЕМ" : "PROJECT IZ",
                )}
              </div>
              <h1>
                {section === "dashboard"
                  ? `${tr("Добрый день")}, ${actor.name.split(" ")[0]}`
                  : caseId && data?.details
                    ? data.details.name
                    : tr(title)}
                <span className="heading-dot">.</span>
              </h1>
              <p>
                {section === "dashboard"
                  ? tr("Дела, задачи и сроки вашей команды — в одном месте.")
                  : section === "cases"
                    ? tr("От первого документа до решения по визе.")
                    : section === "tasks"
                      ? tr("Следующий шаг для каждого визового дела.")
                      : section === "deadlines"
                        ? tr("Ближайшие сроки и то, что требует внимания.")
                        : caseId && data?.details
                          ? `CASE-${String(data.details.number).padStart(3, "0")} · ${data.details.country} · ${data.details.visa_type}`
                          : ""}
              </p>
            </div>
            <div className="heading-actions">
              {tr(
                section === "cases" &&
                  can("can_create_cases") &&
                  button("case", "Новое дело"),
              )}
              {tr(
                section === "dashboard" &&
                  can("can_create_cases") &&
                  button("case", "Новое дело"),
              )}
              {tr(
                section === "tasks" &&
                  can("can_create_tasks") &&
                  button("task", "Новая задача"),
              )}
              {tr(
                section === "users" &&
                  can("can_manage_users") &&
                  button("user", "Добавить сотрудника"),
              )}
              {caseId && can("can_edit_cases") && (
                <button onClick={() => open("edit-case", data.details)}>
                  {tr(" Изменить дело ")}
                </button>
              )}
            </div>
          </div>
          {error && (
            <div role="alert" className="error">
              <AlertCircle size={18} />
              {tr(error)}
              <button onClick={() => setError("")} aria-label={tr("Закрыть")}>
                <X size={16} />
              </button>
            </div>
          )}
          {loading || (!error && dataKey !== section + (caseId || taskId)) ? (
            <BlankLoading />
          ) : (
            data &&
            dataKey === section + (caseId || taskId) && (
              <>
                {section === "task" && (
                  <TaskPage
                    value={data}
                    actor={actor}
                    timezone={config.timezone}
                    onRefresh={() => load(true)}
                  />
                )}
                {section === "dashboard" && (
                  <>
                    <div className="stats">
                      {[
                        [
                          "Требуют внимания",
                          data.stats.overdue,
                          "Просроченные задачи",
                          AlertCircle,
                          "red",
                        ],
                        [
                          "На сегодня",
                          data.stats.today,
                          "Запланировано на день",
                          CalendarDays,
                          "orange",
                        ],
                        [
                          "Мои задачи",
                          data.stats.mine,
                          "В работе и к выполнению",
                          ListTodo,
                          "blue",
                        ],
                        [
                          "Завершено",
                          data.stats.completed,
                          "В доступных вам делах",
                          CheckCircle2,
                          "green",
                        ],
                      ].map(([label, n, sub, Icon, color]: any, index) => (
                        <button
                          type="button"
                          className={
                            "stat stat-filter" +
                            (dashboardTaskFilter ===
                            ["overdue", "today", "mine", "completed"][index]
                              ? " selected"
                              : "")
                          }
                          key={label}
                          aria-pressed={
                            dashboardTaskFilter ===
                            ["overdue", "today", "mine", "completed"][index]
                          }
                          onClick={() =>
                            filterDashboard(
                              "",
                              ["overdue", "today", "mine", "completed"][index],
                            )
                          }
                        >
                          <div>
                            <span>{tr(label)}</span>
                            <Icon className={color} size={19} />
                          </div>
                          <strong>{tr(n)}</strong>
                          <small>{tr(sub)}</small>
                        </button>
                      ))}
                    </div>
                    <div className="dashboard-grid">
                      <section className="panel task-panel">
                        <div className="panel-head">
                          <div>
                            <h2>
                              {tr(
                                dashboardView.stage
                                  ? tr("Дела:") +
                                      " " +
                                      tr(labels[dashboardView.stage])
                                  : (
                                      {
                                        overdue: "Требуют внимания",
                                        today: "На сегодня",
                                        mine: "Мои задачи",
                                        completed: "Завершено",
                                      } as Record<string, string>
                                    )[dashboardView.taskFilter] ||
                                      "Ближайшие задачи",
                              )}
                            </h2>
                            {dashboardView.stage || dashboardView.taskFilter ? (
                              <button
                                type="button"
                                className="text-btn"
                                onClick={() => filterDashboard("")}
                              >
                                {tr("Сбросить фильтр")}
                              </button>
                            ) : (
                              <span>{tr("Сначала — самое важное")}</span>
                            )}
                          </div>
                          <Link
                            className="text-btn"
                            href={dashboardView.stage ? "/cases" : "/tasks"}
                          >
                            {tr(
                              dashboardView.stage ? "Все дела" : "Все задачи",
                            )}
                            <ArrowUpRight size={16} />
                          </Link>
                        </div>
                        <div
                          className="dashboard-list"
                          aria-busy={dashboardLoading}
                        >
                          {dashboardLoading && (
                            <div
                              className="dashboard-list-updating"
                              role="status"
                            >
                              <Loader2 size={15} className="spin" />
                              {tr("Обновление списка…")}
                            </div>
                          )}
                          {dashboardView.stage ? (
                            <DashboardCases
                              rows={data.stage_cases}
                              page={dashboardView.page}
                              onPage={setPage}
                              dt={dt}
                            />
                          ) : (
                            tr(taskTable(data.tasks, true))
                          )}
                        </div>
                      </section>
                      <section className="panel pipeline">
                        <div className="panel-head">
                          <h2>{tr("Дела по этапам")}</h2>
                          <BriefcaseBusiness size={18} />
                        </div>
                        <div className="pipeline-total">
                          <strong>
                            {data.cases.reduce(
                              (n: number, c: Any) => n + Number(c.total),
                              0,
                            )}
                          </strong>
                          <span>{tr("доступных дел")}</span>
                        </div>
                        {caseStatuses.map((s) => {
                          const n = Number(
                            data.cases.find((c: Any) => c.status === s)
                              ?.total || 0,
                          );
                          const total = data.cases.reduce(
                            (n: number, c: Any) => n + Number(c.total),
                            0,
                          );
                          return (
                            <button
                              type="button"
                              className={
                                "pipeline-row pipeline-filter" +
                                (dashboardStage === s ? " selected" : "")
                              }
                              key={s}
                              aria-pressed={dashboardStage === s}
                              onClick={() => filterDashboard(s)}
                            >
                              <div>
                                <span>
                                  <i
                                    style={{
                                      background:
                                        (
                                          {
                                            "Contract signing": "#6e80bc",
                                            "Waiting for payment": "#cd9b53",
                                            "Documents collecting": "#e6a052",
                                            "Under review": "#7880bc",
                                            "Ready for submission": "#629ba5",
                                            "Waiting for decision": "#ad8fd0",
                                            "Additional request": "#cc8954",
                                            "Visa approved": "#55a584",
                                            "Visa refused": "#c77676",
                                          } as Record<string, string>
                                        )[s] || "#97a0b1",
                                    }}
                                  />
                                  {tr(labels[s])}
                                </span>
                                <b>{tr(n)}</b>
                              </div>
                              <div className="bar">
                                <i
                                  style={{
                                    width: `${total ? (n / total) * 100 : 0}%`,
                                  }}
                                />
                              </div>
                            </button>
                          );
                        })}
                      </section>
                      <section className="panel activity-panel">
                        <div className="panel-head">
                          <h2>{tr("Последняя активность")}</h2>
                          <Activity size={18} />
                        </div>
                        {data.logs.length ? (
                          <div className="timeline">
                            {data.logs.map((l: Any) => (
                              <Link href={"/cases/" + l.case_id} key={l.id}>
                                <span className="timeline-icon">
                                  <FileText size={17} />
                                </span>
                                <div>
                                  <strong>{tr(l.action)}</strong>
                                  <span>
                                    {tr(l.author || "Система")} ·{" "}
                                    {l.client_name}
                                  </span>
                                </div>
                                <time>{tr(dt(l.created_at))}</time>
                              </Link>
                            ))}
                          </div>
                        ) : (
                          <Empty
                            title={tr("История начинается здесь")}
                            text="Действия сотрудников будут отображаться автоматически."
                          />
                        )}
                      </section>
                    </div>
                  </>
                )}
                {section === "cases" && (
                  <section className="panel">
                    <div className="filters">
                      <div className="search">
                        <Search size={18} />
                        <input
                          aria-label={tr("Поиск дел")}
                          placeholder={tr("Имя, контакт или номер дела")}
                          value={q}
                          onChange={(e) => {
                            setQ(e.target.value);
                            setPage(1);
                          }}
                        />
                      </div>
                      <select
                        aria-label={tr("Статус")}
                        value={status}
                        onChange={(e) => {
                          setStatus(e.target.value);
                          setPage(1);
                        }}
                      >
                        <option value="">{tr("Все статусы")}</option>
                        {caseStatuses.map((s) => (
                          <option key={s} value={s}>
                            {tr(labels[s])}
                          </option>
                        ))}
                      </select>
                      <input
                        className="filter-input"
                        aria-label={tr("Тип визы")}
                        placeholder={tr("Тип визы")}
                        value={visa}
                        onChange={(e) => {
                          setVisa(e.target.value);
                          setPage(1);
                        }}
                      />
                      <button
                        onClick={async () => {
                          setStaff(await api("staff"));
                          setModal({ kind: "filter" });
                        }}
                      >
                        <SlidersHorizontal size={16} />
                        {tr(" Ответственный ")}
                      </button>
                    </div>
                    {data.length ? (
                      <>
                        <div className="table-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th>{tr("Клиент / дело")}</th>
                                <th>{tr("Виза")}</th>
                                <th>{tr("Статус")}</th>
                                <th>{tr("Ответственный")}</th>
                                <th>{tr("Срок")}</th>
                                <th>{tr("До дедлайна")}</th>
                                <th />
                              </tr>
                            </thead>
                            <tbody>
                              {data.map((c: Any) => (
                                <tr
                                  key={c.id}
                                  className={
                                    c.finance?.warnings?.length
                                      ? "finance-critical-row"
                                      : ""
                                  }
                                >
                                  <td>
                                    <Link
                                      className="row-title"
                                      href={"/cases/" + c.id}
                                    >
                                      {c.name}
                                    </Link>
                                    <small>
                                      CASE-
                                      {tr(String(c.number).padStart(3, "0"))}
                                    </small>
                                  </td>
                                  <td>
                                    <strong className="normal">
                                      {c.country}
                                    </strong>
                                    <small>{c.visa_type}</small>
                                  </td>
                                  <td>
                                    <Badge value={c.status} />
                                    <FinanceWarnings value={c.finance} />
                                    {c.has_checklist && (
                                      <div
                                        className="case-document-progress"
                                        title={tr(
                                          "Обязательные документы: " +
                                            c.documents_loaded +
                                            " из " +
                                            c.documents_total,
                                        )}
                                      >
                                        <small>
                                          {tr(" Документы ·")}
                                          {tr(" ")}
                                          {tr(
                                            c.documents_total
                                              ? Math.round(
                                                  (c.documents_loaded /
                                                    c.documents_total) *
                                                    100,
                                                )
                                              : 0,
                                          )}
                                          %
                                        </small>
                                        <progress
                                          max={Math.max(c.documents_total, 1)}
                                          value={c.documents_loaded}
                                          aria-label={tr(
                                            "Заполнение обязательных документов",
                                          )}
                                        />
                                      </div>
                                    )}
                                  </td>
                                  <td>
                                    <span className="person">
                                      <i>{c.responsible_name?.[0]}</i>
                                      {c.responsible_name}
                                    </span>
                                  </td>
                                  <td
                                    className={
                                      overdue(c.status, c.deadline)
                                        ? "danger"
                                        : ""
                                    }
                                  >
                                    {tr(dt(c.deadline))}
                                  </td>
                                  <td
                                    className={
                                      overdue(c.status, c.deadline)
                                        ? "danger"
                                        : ""
                                    }
                                  >
                                    <DeadlineRemaining
                                      deadline={c.deadline}
                                      status={c.status}
                                    />
                                  </td>
                                  <td>
                                    <Link
                                      className="icon-btn"
                                      aria-label={tr("Открыть дело")}
                                      href={"/cases/" + c.id}
                                    >
                                      <ArrowUpRight size={18} />
                                    </Link>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="pagination">
                          <span>
                            {tr("Всего дел: ")}
                            {tr(data[0]?.total)}
                          </span>
                          <button
                            disabled={page === 1}
                            onClick={() => setPage(page - 1)}
                          >
                            <ChevronLeft size={16} />
                          </button>
                          <span>{tr(page)}</span>
                          <button
                            disabled={page * 20 >= Number(data[0]?.total)}
                            onClick={() => setPage(page + 1)}
                          >
                            <ChevronRight size={16} />
                          </button>
                        </div>
                      </>
                    ) : (
                      <Empty
                        title={tr("Добавьте первое визовое дело")}
                        text="Контакты клиента, документы и задачи будут собраны в одной карточке."
                        action={
                          can("can_create_cases") &&
                          button("case", "Новое дело")
                        }
                      />
                    )}
                  </section>
                )}
                {["tasks", "deadlines"].includes(section) && (
                  <section className="panel">
                    <div className="tabs">
                      {[
                        ["all", "Все доступные"],
                        ["mine", "Мои"],
                        ["overdue", "Просрочены"],
                        ["today", "Сегодня"],
                        ["week", "7 дней"],
                        ["completed", "Завершены"],
                      ].map(([v, l]) => (
                        <button
                          className={tab === v ? "selected" : ""}
                          key={v}
                          onClick={() => setTab(v)}
                        >
                          {tr(l)}
                        </button>
                      ))}
                    </div>
                    {tr(taskTable(data))}
                  </section>
                )}
                {caseId && data.details && (
                  <>
                    <div className="case-summary">
                      <div>
                        <span>{tr("Статус")}</span>
                        <Badge value={data.details.status} />
                        <FinanceWarnings value={data.details.finance} />
                      </div>
                      <div>
                        <span>{tr("Ответственный")}</span>
                        <strong>{data.details.responsible_name}</strong>
                      </div>
                      <div>
                        <span>{tr("Эскалация")}</span>
                        <strong>
                          {data.details.escalation_name || "Не назначена"}
                        </strong>
                      </div>
                      <div>
                        <span>{tr("Срок дела")}</span>
                        <strong>{tr(dt(data.details.deadline))}</strong>
                      </div>
                      <div>
                        <span>{tr("Контакты")}</span>
                        <strong>{data.details.phone || "—"}</strong>
                        <small>{data.details.email}</small>
                      </div>
                    </div>
                    <div className="tabs standalone">
                      {[
                        ["all", "Документы"],
                        ["tasks", "Задачи"],
                        ["chat", "Чат"],
                        ["history", "История"],
                        ...(can("accounting.view")
                          ? [["accounting", "Бухгалтерия"]]
                          : []),
                        ["followup", "Дозапрос"],
                      ].map(([v, l]) => (
                        <button
                          className={tab === v ? "selected" : ""}
                          key={v}
                          onClick={() => {
                            setTab(v);
                            window.location.hash = v;
                          }}
                        >
                          {tr(l)}
                          {v === "chat" && data.chat_unread > 0 && (
                            <span className="chat-tab-count">
                              {data.chat_unread}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                    {tab === "accounting" && can("accounting.view") && (
                      <Accounting
                        actor={actor}
                        caseId={caseId}
                        onCaseRefresh={() => load(true)}
                      />
                    )}
                    {tab === "followup" && (
                      <CaseFollowup
                        caseId={caseId!}
                        value={data.followup}
                        timezone={config.timezone}
                        canEdit={can("can_upload_documents")}
                        canDownload={can("can_download_documents")}
                        caseStatus={data.details.status}
                        responsibleName={data.details.responsible_name}
                        workflowState={data.workflow?.state}
                        onRefresh={() => load(true)}
                        onDocuments={() => {
                          setTab("all");
                          window.location.hash = "all";
                        }}
                      />
                    )}
                    {tab === "chat" && (
                      <CaseChat
                        caseId={caseId!}
                        actor={actor}
                        initialThread={chatTarget.thread}
                        initialDocument={chatTarget.document}
                        focusMessage={chatTarget.message}
                        attachment={chatAttachment}
                        onAttachmentClear={() => setChatAttachment(null)}
                        onCount={(n) =>
                          setData((d: Any) => ({ ...d, chat_unread: n }))
                        }
                        onDocuments={(id) => {
                          setFocusDocument(id);
                          setTab("all");
                          window.location.hash = "all";
                          void load(true);
                        }}
                      />
                    )}
                    {tab === "all" &&
                      data.contract &&
                      can("accounting.view_contract") && (
                        <section className="panel padded case-contract">
                          <h2>{tr("Договор клиента")}</h2>
                          <p translate="no">{data.contract.filename}</p>
                          <small>
                            {tr("Дата создания договора")}:{" "}
                            {formatInTimeZone(
                              new Date(data.contract.generated_on),
                              config.timezone,
                              "dd.MM.yyyy",
                            )}
                          </small>
                          {can("can_download_documents") && (
                            <a
                              className="button"
                              href={"/api/contracts?case_id=" + caseId}
                            >
                              {tr("Скачать договор DOCX")}
                            </a>
                          )}
                        </section>
                      )}
                    {tab === "all" && data.workflow && (
                      <CaseWorkflow
                        value={data.workflow}
                        timezone={config.timezone}
                        followup={data.followup}
                        onSubmitted={() => {
                          setTab("all");
                          window.location.hash = "all";
                        }}
                        responsibleId={data.details.responsible_id}
                        onOpenChat={openChat}
                        onForward={(file) => {
                          setChatAttachment(file);
                          openChat();
                        }}
                        caseId={caseId!}
                        canEdit={can("can_upload_documents")}
                        canDownload={can("can_download_documents")}
                        isAdmin={actor.role === "Administrator"}
                        onRefresh={() => load(true)}
                      />
                    )}
                    {tab === "all" && (
                      <section className="panel">
                        <div className="panel-head">
                          <div>
                            <h2>
                              {tr(
                                data.workflow
                                  ? "Дополнительные документы"
                                  : "Документы дела",
                              )}
                            </h2>
                            <span>{tr("Оригиналы и история версий")}</span>
                          </div>
                          {can("can_upload_documents") && (
                            <div className="row-actions">
                              <button onClick={() => open("document")}>
                                <Plus size={17} />
                                {tr(" Ожидаемый документ ")}
                              </button>
                              <button
                                className="primary"
                                onClick={() => open("upload")}
                              >
                                <Upload size={17} />
                                {tr(" Загрузить документ ")}
                              </button>
                            </div>
                          )}
                        </div>
                        {data.documents.length ? (
                          <div className="document-list">
                            {data.documents.map((d: Any) => (
                              <div
                                key={d.id}
                                className={
                                  "document " + (d.archived ? "archived" : "")
                                }
                              >
                                <div className="document-head">
                                  <div className="file-icon">
                                    <FileText size={23} />
                                  </div>
                                  <div>
                                    <h3>
                                      <span translate="no">{d.name}</span>
                                      {tr(d.archived && " · Архив")}
                                    </h3>
                                    <small>
                                      {labels[d.type]} · {tr(d.versions.length)}
                                      {tr(" ")}
                                      {tr(" версий ")}
                                    </small>
                                  </div>
                                  {can("can_archive_documents") && (
                                    <button
                                      className="icon-btn"
                                      aria-label={tr(
                                        d.archived
                                          ? "Восстановить"
                                          : "Архивировать",
                                      )}
                                      onClick={() =>
                                        act("document.archive", {
                                          id: d.id,
                                          archived: !d.archived,
                                        })
                                      }
                                    >
                                      <Archive size={18} />
                                    </button>
                                  )}
                                </div>
                                {!d.versions.length && (
                                  <div className="version">
                                    <Badge value="Missing" />
                                  </div>
                                )}
                                {d.versions.map((v: Any, i: number) => (
                                  <div className="version" key={v.id}>
                                    <span className="version-num">
                                      v{tr(v.version)}
                                    </span>
                                    <div>
                                      <strong>
                                        <span translate="no">{v.filename}</span>
                                      </strong>
                                      <small>
                                        {tr(v.author)} · {tr(dt(v.created_at))}{" "}
                                        ·{tr(" ")}
                                        {tr((v.size / 1024 / 1024).toFixed(2))}
                                        {tr(" МБ ")}
                                      </small>
                                    </div>
                                    <Badge
                                      value={
                                        v.scan_status !== "clean"
                                          ? v.scan_status
                                          : v.expires_at &&
                                              v.expires_at.slice(0, 10) <
                                                formatInTimeZone(
                                                  new Date(),
                                                  config.timezone,
                                                  "yyyy-MM-dd",
                                                )
                                            ? "Expired"
                                            : v.review_status
                                      }
                                    />
                                    {i === 0 && (
                                      <span className="current-label">
                                        {tr(" Текущая ")}
                                      </span>
                                    )}
                                    {can("can_review_documents") &&
                                      v.scan_status === "clean" && (
                                        <button
                                          className="text-btn"
                                          onClick={() => open("review", v)}
                                        >
                                          {tr(" Проверить ")}
                                        </button>
                                      )}
                                    {can("can_download_documents") &&
                                      v.scan_status === "clean" && (
                                        <a
                                          className="icon-btn"
                                          aria-label={tr("Скачать версию")}
                                          href={"/api/documents/" + v.id}
                                        >
                                          <Download size={18} />
                                        </a>
                                      )}
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <Empty
                            title={tr(
                              data.workflow
                                ? "Дополнительных документов пока нет"
                                : "Документы ещё не загружены",
                            )}
                            text="Загрузите первый файл. Все последующие версии будут сохранены."
                          />
                        )}
                      </section>
                    )}
                    {tab === "tasks" && (
                      <section className="panel">
                        <div className="panel-head">
                          <h2>{tr("Задачи дела")}</h2>
                          {tr(
                            can("can_create_tasks") &&
                              button("task", "Новая задача"),
                          )}
                        </div>
                        {tr(taskTable(data.tasks))}
                      </section>
                    )}
                    {tab === "history" && (
                      <section className="panel">
                        <LogTable rows={data.logs} dt={dt} />
                      </section>
                    )}
                  </>
                )}
                {section === "notifications" && (
                  <section className="panel">
                    {data.length ? (
                      <div className="notification-list">
                        {data.map((n: Any) => (
                          <div key={n.id} className={n.read_at ? "read" : ""}>
                            <span className="notification-icon">
                              <Bell size={20} />
                            </span>
                            <div>
                              <strong>{tr(n.title)}</strong>
                              <p>{n.message}</p>
                              <small>{tr(dt(n.created_at))}</small>
                              {(n.case_id || n.room_id) && (
                                <Link
                                  className="text-btn"
                                  href={
                                    n.room_id
                                      ? "/chats#room=" +
                                        n.room_id +
                                        "&message=" +
                                        n.room_message_id
                                      : "/cases/" +
                                        n.case_id +
                                        (n.dedupe_key?.startsWith(
                                          "case-followup:",
                                        )
                                          ? "#followup"
                                          : n.chat_message_id
                                            ? "#chat?message=" +
                                              n.chat_message_id +
                                              (n.chat_thread_id
                                                ? "&thread=" + n.chat_thread_id
                                                : "")
                                            : "")
                                  }
                                >
                                  {tr(
                                    n.room_id
                                      ? "Открыть чат"
                                      : " Открыть дело ",
                                  )}
                                  <ArrowRight size={14} />
                                </Link>
                              )}
                            </div>
                            {!n.read_at && (
                              <button
                                className="text-btn"
                                onClick={() =>
                                  act("notification.read", { id: n.id })
                                }
                              >
                                {tr(" Прочитано ")}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Empty
                        title={tr("Новых уведомлений нет")}
                        text="Напоминания о сроках и завершённых задачах появятся здесь."
                      />
                    )}
                  </section>
                )}
                {section === "profile" && (
                  <div className="settings-grid">
                    <section className="panel padded">
                      <h2>{tr("Личные данные")}</h2>
                      <div className="profile-display">
                        <span className="avatar large">{actor.name?.[0]}</span>
                        <div>
                          <h3>{actor.name}</h3>
                          <p>{actor.email}</p>
                          <Badge value={actor.role} />
                        </div>
                      </div>
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const f = new FormData(e.currentTarget);
                          const r = await authClient.changePassword({
                            currentPassword: String(f.get("currentPassword")),
                            newPassword: String(f.get("newPassword")),
                            revokeOtherSessions: true,
                          });
                          if (r.error)
                            setError(
                              r.error.message || "Не удалось изменить пароль",
                            );
                          else setToast("Пароль изменён");
                        }}
                      >
                        <h3>{tr("Сменить пароль")}</h3>
                        <label>
                          {tr(" Текущий пароль ")}
                          <input
                            name="currentPassword"
                            type="password"
                            required
                            autoComplete="current-password"
                          />
                        </label>
                        <label>
                          {tr(" Новый пароль ")}
                          <input
                            name="newPassword"
                            type="password"
                            minLength={12}
                            required
                            autoComplete="new-password"
                          />
                        </label>
                        <button>{tr("Сохранить пароль")}</button>
                      </form>
                      <button
                        className="text-btn danger"
                        onClick={async () => {
                          await authClient.signOut();
                          location.reload();
                        }}
                      >
                        <LogOut size={16} />
                        {tr(" Выйти из системы ")}
                      </button>
                    </section>
                    <section className="panel padded">
                      <Send size={28} className="blue" />
                      <h2>Telegram</h2>
                      <p>
                        {tr(
                          " Получайте напоминания и загружайте документы из личного диалога с ботом. ",
                        )}
                      </p>
                      <Badge
                        value={data.telegram ? "Подключён" : "Не подключён"}
                      />
                      <button
                        className="primary"
                        onClick={async () => {
                          try {
                            const r = await fetch("/api/telegram/link", {
                              method: data.telegram ? "DELETE" : "POST",
                            });
                            const d = await r.json();
                            if (!r.ok) throw new Error(d.error);
                            if (d.url) {
                              setModal({ kind: "telegram", url: d.url });
                            } else {
                              setToast("Telegram отключён");
                              await load();
                            }
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        {tr(
                          data.telegram
                            ? "Отключить Telegram"
                            : "Подключить Telegram",
                        )}
                      </button>
                    </section>
                  </div>
                )}
                {section === "settings-contracts" && (
                  <>
                    <Link href="/settings" className="text-btn settings-back">
                      {tr("Вернуться в настройки")}
                    </Link>
                    <ContractTemplate />
                  </>
                )}
                {section === "settings-telegram" && (
                  <TelegramSettings value={data} onRefresh={() => load(true)} />
                )}
                {section === "settings" && (
                  <>
                    <div className="settings-nav">
                      {actor.role === "Administrator" &&
                        can("can_manage_settings") && (
                          <>
                            <Link href="/settings/contracts">
                              <FileText size={18} />
                              {tr("Шаблон договора DOCX")}
                              <ArrowUpRight size={16} />
                            </Link>
                            <Link href="/settings/telegram">
                              <Send size={18} />
                              {tr("Telegram-чаты")}
                              <ArrowUpRight size={16} />
                            </Link>
                          </>
                        )}

                      {can("can_manage_users") && (
                        <Link href="/users">
                          <Users size={18} />
                          {tr(" Сотрудники ")}
                          <ArrowUpRight size={16} />
                        </Link>
                      )}
                      {can("can_manage_roles") && (
                        <Link href="/roles">
                          <ShieldCheck size={18} />
                          {tr(" Роли и права ")}
                          <ArrowUpRight size={16} />
                        </Link>
                      )}
                      {can("can_view_audit_log") && (
                        <Link href="/audit">
                          <Activity size={18} />
                          {tr(" Журнал действий ")}
                          <ArrowUpRight size={16} />
                        </Link>
                      )}
                    </div>
                    <div className="settings-grid">
                      <section className="panel padded">
                        <h2>{tr("Общие настройки")}</h2>
                        <form
                          onSubmit={async (e) => {
                            e.preventDefault();
                            const f = new FormData(e.currentTarget);
                            const r = await act("settings.save", {
                              timezone: String(f.get("timezone")),
                              maxFileMb: Number(f.get("maxFileMb")),
                              reminderDays: String(f.get("days"))
                                .split(",")
                                .filter(Boolean)
                                .map(Number),
                            });
                            if (r)
                              setConfig({
                                ...config,
                                timezone: f.get("timezone"),
                              });
                          }}
                        >
                          <label>
                            {tr(" Часовой пояс ")}
                            <input
                              name="timezone"
                              defaultValue={data.settings.timezone}
                              required
                            />
                          </label>
                          <label>
                            {tr(" Максимальный файл, МБ ")}
                            <input
                              name="maxFileMb"
                              type="number"
                              min={1}
                              max={20}
                              defaultValue={data.settings.maxFileMb}
                            />
                          </label>
                          <label>
                            {tr(" Напомнить за сколько дней ")}
                            <input
                              name="days"
                              defaultValue={data.settings.reminderDays.join(
                                ",",
                              )}
                            />
                            <small>{tr("Через запятую, например: 3,1")}</small>
                          </label>
                          <button className="primary" disabled={busy}>
                            {tr(" Сохранить настройки ")}
                          </button>
                        </form>
                      </section>
                      <section className="panel padded">
                        <h2>{tr("Подключения")}</h2>
                        {Object.entries(data.integrations).map(([k, v]) => (
                          <div className="integration" key={k}>
                            <span>
                              {
                                {
                                  database: "База данных",
                                  storage: "Хранилище файлов",
                                  telegram: "Telegram-бот",
                                  mail: "Отправка почты",
                                  scanner: "Проверка файлов",
                                }[k]
                              }
                            </span>
                            <Badge value={v ? "Настроено" : "Не настроено"} />
                          </div>
                        ))}
                        <p className="muted">
                          {tr(
                            " Статус показывает наличие настроек. Доступность сервисов проверяется при выполнении операций. ",
                          )}
                        </p>
                        <h3>{tr("Копии, ожидающие отправки")}</h3>
                        {data.backups.length ? (
                          data.backups.map((b: Any) => (
                            <div className="integration" key={b.version_id}>
                              <span>{b.filename}</span>
                              <Badge value={b.state} />
                              {b.state === "failed" && (
                                <button
                                  onClick={() =>
                                    act("backup.retry", { id: b.version_id })
                                  }
                                >
                                  {tr(" Повторить ")}
                                </button>
                              )}
                            </div>
                          ))
                        ) : (
                          <p className="muted">{tr("Нет ожидающих копий.")}</p>
                        )}
                        <h3>{tr("Задания с ошибками")}</h3>
                        {data.jobs?.length ? (
                          data.jobs.map((j: Any) => (
                            <div className="integration" key={j.id}>
                              <div>
                                <strong>
                                  {tr(
                                    (
                                      {
                                        scan: "Проверка файла",
                                        backup: "Копия документа",
                                        invite: "Приглашение",
                                        notification: "Уведомление",
                                        telegram_upload: "Загрузка из Telegram",
                                        team: "Уведомление команды",
                                      } as Any
                                    )[j.kind] || "Фоновая операция",
                                  )}
                                </strong>
                                <small>{tr(j.last_error)}</small>
                              </div>
                              <button
                                disabled={busy}
                                onClick={() => act("job.retry", { id: j.id })}
                              >
                                {tr(" Повторить ")}
                              </button>
                            </div>
                          ))
                        ) : (
                          <p className="muted">
                            {tr("Нет заданий с ошибками.")}
                          </p>
                        )}
                      </section>
                    </div>
                  </>
                )}
                {section === "chats" && (
                  <ChatHub actor={actor} initialData={data} />
                )}
                {section === "accounting" && can("accounting.view") && (
                  <Accounting actor={actor} initialData={data} />
                )}
                {section === "partners" && (
                  <Partners
                    groups={data}
                    canEdit={can("can_manage_partners")}
                    onRefresh={load}
                  />
                )}
                {section === "users" && (
                  <section className="panel">
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>{tr("Сотрудник")}</th>
                            <th>Email</th>
                            <th>{tr("Роль")}</th>
                            <th>{tr("Доступ")}</th>
                            {actor.role === "Administrator" && (
                              <th>{tr("Пароль")}</th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {data.map((u: Any) => (
                            <tr key={u.id}>
                              <td>{u.name}</td>
                              <td>{u.email}</td>
                              <td>
                                <select
                                  aria-label={"Роль " + u.name}
                                  disabled={u.id === actor.id}
                                  value={u.role_id}
                                  onChange={(e) =>
                                    act("user.update", {
                                      id: u.id,
                                      active: u.active,
                                      role_id: e.target.value,
                                    })
                                  }
                                >
                                  {roleOptions.map((r) => (
                                    <option key={r.id} value={r.id}>
                                      {tr(labels[r.name] || r.name)}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td>
                                <button
                                  disabled={u.id === actor.id}
                                  onClick={() =>
                                    act("user.update", {
                                      id: u.id,
                                      active: !u.active,
                                      role_id: u.role_id,
                                    })
                                  }
                                >
                                  {tr(
                                    u.active
                                      ? "Заблокировать"
                                      : "Разблокировать",
                                  )}
                                </button>
                              </td>
                              {actor.role === "Administrator" && (
                                <td>
                                  {u.id === actor.id ? (
                                    <Link href="/profile">
                                      {tr("Мой профиль")}
                                    </Link>
                                  ) : (
                                    <button
                                      onClick={() =>
                                        open("user-password", {
                                          id: u.id,
                                          name: u.name,
                                        })
                                      }
                                    >
                                      {tr(" Задать пароль ")}
                                    </button>
                                  )}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
                {section === "roles" && (
                  <>
                    <form
                      className="role-create"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void act("role.save", {
                          id: String(f.get("role_name")),
                          permissions: [],
                        });
                      }}
                    >
                      <input
                        name="role_name"
                        required
                        placeholder={tr("Название новой роли")}
                        aria-label={tr("Название новой роли")}
                      />
                      <button className="primary" disabled={busy}>
                        <Plus size={17} />
                        {tr(" Создать роль ")}
                      </button>
                    </form>
                    <div className="role-grid">
                      {data.map((r: Any) => (
                        <section className="panel padded" key={r.id}>
                          <h2>{tr(labels[r.name] || r.name)}</h2>
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              const f = new FormData(e.currentTarget);
                              void act("role.save", {
                                id: r.id,
                                permissions: f.getAll("permissions"),
                              });
                            }}
                          >
                            {permissions.map((p) => (
                              <label className="check-label" key={p}>
                                <input
                                  type="checkbox"
                                  name="permissions"
                                  value={p}
                                  defaultChecked={r.permissions.includes(p)}
                                  disabled={r.id === "Administrator"}
                                />
                                {tr(permissionLabels[p])}
                              </label>
                            ))}
                            {r.id !== "Administrator" && (
                              <button className="primary" disabled={busy}>
                                {tr(" Сохранить права ")}
                              </button>
                            )}
                          </form>
                        </section>
                      ))}
                    </div>
                  </>
                )}
                {section === "audit" && (
                  <section className="panel">
                    <LogTable rows={data} dt={dt} />
                  </section>
                )}
              </>
            )
          )}
          <footer>
            Project Iz <span>{tr("Рабочее пространство команды")}</span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {tr(toast)}
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setModal(null);
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <div className="modal-head">
              <h2 id="modal-title">
                {tr(
                  (
                    {
                      case: "Новое визовое дело",
                      "edit-case": "Изменить дело",
                      task: "Новая задача",
                      "edit-task": "Изменить задачу",
                      upload: "Загрузить документ",
                      document: "Ожидаемый документ",
                      user: "Новый сотрудник",
                      "user-password": "Задать пароль сотрудника",
                      review: "Проверка версии",
                      filter: "Ответственный",
                      telegram: "Подключить Telegram",
                    } as Any
                  )[modal.kind],
                )}
              </h2>
              <button
                className="icon-btn"
                disabled={busy}
                aria-label={tr("Закрыть")}
                onClick={() => setModal(null)}
              >
                <X size={20} />
              </button>
            </div>
            {error && (
              <div role="alert" className="error">
                {tr(error)}
              </div>
            )}
            {modal.kind === "telegram" ? (
              <>
                <p>
                  {tr(
                    " Откройте одноразовую ссылку и нажмите «Старт» в боте. Ссылка действует 10 минут. ",
                  )}
                </p>
                <a
                  className="primary button"
                  href={modal.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {tr(" Открыть Telegram ")}
                  <ArrowUpRight size={17} />
                </a>
              </>
            ) : modal.kind === "filter" ? (
              <>
                <select
                  value={owner}
                  onChange={(e) => {
                    setOwner(e.target.value);
                    setPage(1);
                    setModal(null);
                  }}
                >
                  <option value="">{tr("Все сотрудники")}</option>
                  {staff.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <form onSubmit={submit}>
                {["case", "edit-case"].includes(modal.kind) && (
                  <>
                    {modal.kind === "case" &&
                      actor.role === "Administrator" &&
                      can("can_manage_settings") &&
                      casePolicy && (
                        <CaseRequiredFields
                          policy={casePolicy}
                          onSave={setCasePolicy}
                          onBusy={setBusy}
                        />
                      )}
                    {modal.kind === "case" && (
                      <label>
                        {tr(" Существующий клиент (необязательно) ")}
                        <select
                          name="client_id"
                          onChange={(e) => {
                            const client = clients.find(
                              (c) => c.id === e.target.value,
                            );
                            setClientDetails({
                              name: client?.name || "",
                              phone: client?.phone || "",
                              email: client?.email || "",
                            });
                          }}
                        >
                          <option value="">
                            {tr("Создать нового клиента")}
                          </option>
                          {clients.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} · {c.phone}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label>
                      {tr(" Имя клиента ")}
                      <input
                        name="name"
                        required
                        value={clientDetails.name}
                        onChange={(e) =>
                          setClientDetails((previous) => ({
                            ...previous,
                            name: e.target.value,
                          }))
                        }
                        autoFocus
                      />
                    </label>
                    <div className="form-row">
                      <label>
                        {tr(" Телефон ")}
                        <input
                          name="phone"
                          required={
                            modal.kind === "case" && requiredCase("phone")
                          }
                          value={clientDetails.phone}
                          onChange={(e) =>
                            setClientDetails((previous) => ({
                              ...previous,
                              phone: e.target.value,
                            }))
                          }
                          type="tel"
                        />
                      </label>
                      <label>
                        Email
                        <input
                          name="email"
                          required={
                            modal.kind === "case" && requiredCase("email")
                          }
                          value={clientDetails.email}
                          onChange={(e) =>
                            setClientDetails((previous) => ({
                              ...previous,
                              email: e.target.value,
                            }))
                          }
                          type="email"
                        />
                      </label>
                    </div>
                    <div className="form-row">
                      <label>
                        {tr(" Страна ")}
                        <input
                          name="country"
                          required={
                            modal.kind !== "case" || requiredCase("country")
                          }
                          defaultValue={modal.country}
                        />
                      </label>
                      <label>
                        {tr(" Тип визы ")}
                        <select
                          name="visa_type"
                          required={
                            modal.kind !== "case" || requiredCase("visa_type")
                          }
                          defaultValue={modal.visa_type || ""}
                        >
                          <option value="">{tr(" Выберите тип визы ")}</option>
                          {modal.visa_type &&
                            !visaTypes.some(
                              (type) => type === modal.visa_type,
                            ) && (
                              <option value={modal.visa_type}>
                                {modal.visa_type}
                                {tr(" (текущее значение) ")}
                              </option>
                            )}
                          {visaTypes.map((type) => (
                            <option key={type} value={type}>
                              {tr(type)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {modal.kind === "edit-case" && (
                      <label>
                        {tr(" Статус ")}
                        <select name="status" defaultValue={modal.status}>
                          {caseStatuses.map((s) => (
                            <option key={s} value={s}>
                              {tr(labels[s])}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </>
                )}
                {["task", "edit-task"].includes(modal.kind) && (
                  <>
                    {!caseId && (
                      <label>
                        {tr(" Визовое дело ")}
                        <select
                          name="case_id"
                          required
                          defaultValue={modal.case_id}
                        >
                          {modal.case_id && (
                            <option value={modal.case_id}>
                              {modal.client_name} · CASE-{tr(modal.number)}
                            </option>
                          )}
                          {caseOptions.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} · {c.country} · CASE-{tr(c.number)}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label>
                      {tr(" Название задачи ")}
                      <input
                        name="title"
                        required
                        defaultValue={modal.title}
                        autoFocus
                      />
                    </label>
                    <label>
                      {tr(" Описание ")}
                      <textarea
                        name="description"
                        rows={3}
                        defaultValue={modal.description}
                      />
                    </label>
                    {modal.kind === "edit-task" && (
                      <label>
                        {tr(" Статус ")}
                        <select name="status" defaultValue={modal.status}>
                          {taskStatuses.map((s) => (
                            <option key={s} value={s}>
                              {tr(labels[s])}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </>
                )}
                {["case", "edit-case", "task", "edit-task"].includes(
                  modal.kind,
                ) && (
                  <>
                    <label>
                      {tr(" Ответственный ")}
                      <select
                        key={staff.length}
                        name="responsible_id"
                        disabled={
                          modal.kind.includes("task")
                            ? !(
                                ["Administrator", "Manager"].includes(
                                  actor.role,
                                ) && can("can_assign_tasks")
                              )
                            : !can("can_assign_case_staff")
                        }
                        defaultValue={modal.responsible_id || actor.id}
                        required
                      >
                        {staff.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {!(modal.kind.includes("task")
                      ? ["Administrator", "Manager"].includes(actor.role) &&
                        can("can_assign_tasks")
                      : can("can_assign_case_staff")) && (
                      <input
                        type="hidden"
                        name="responsible_id"
                        value={modal.responsible_id || actor.id}
                      />
                    )}
                    <label>
                      {tr(" Сотрудник для эскалации ")}
                      <select
                        name="escalation_id"
                        required={
                          modal.kind === "case" && requiredCase("escalation_id")
                        }
                        disabled={
                          modal.kind.includes("task")
                            ? !(
                                ["Administrator", "Manager"].includes(
                                  actor.role,
                                ) && can("can_assign_tasks")
                              )
                            : !can("can_assign_case_staff")
                        }
                        defaultValue={
                          modal.escalation_id ||
                          data?.details?.escalation_id ||
                          ""
                        }
                      >
                        <option value="">{tr("Не назначен")}</option>
                        {staff.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {!(modal.kind.includes("task")
                      ? ["Administrator", "Manager"].includes(actor.role) &&
                        can("can_assign_tasks")
                      : can("can_assign_case_staff")) && (
                      <input
                        type="hidden"
                        name="escalation_id"
                        value={
                          modal.escalation_id ||
                          data?.details?.escalation_id ||
                          ""
                        }
                      />
                    )}
                    {modal.kind === "case" ? (
                      <CaseDeadlineInput
                        timezone={config.timezone}
                        required={requiredCase("deadline")}
                      />
                    ) : (
                      <label>
                        {tr(" Срок · ")}
                        {tr(config.timezone)}
                        <input
                          name="deadline"
                          type="datetime-local"
                          required={modal.kind.includes("task")}
                          defaultValue={
                            modal.deadline
                              ? formatInTimeZone(
                                  new Date(modal.deadline),
                                  config.timezone,
                                  "yyyy-MM-dd'T'HH:mm",
                                )
                              : ""
                          }
                        />
                      </label>
                    )}
                    {modal.kind === "case" &&
                      can("accounting.manage") &&
                      can("accounting.view_contract") &&
                      can("accounting.view") && (
                        <NewCaseFinance
                          clientName={clientDetails.name}
                          timezone={config.timezone}
                          canPay={can("payments.create")}
                          canDownload={can("can_download_documents")}
                          requiredFields={casePolicy?.required || []}
                          onReady={setContractReady}
                          onBusy={setBusy}
                        />
                      )}
                  </>
                )}
                {modal.kind === "document" && (
                  <>
                    <label>
                      {tr(" Название ")}
                      <input name="name" required autoFocus />
                    </label>
                    <label>
                      {tr(" Тип ")}
                      <select name="type">
                        {[
                          "Passport",
                          "Bank Statement",
                          "Insurance",
                          "Other",
                        ].map((t) => (
                          <option key={t} value={t}>
                            {labels[t]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="muted">
                      {tr(
                        " Документ будет отмечен как отсутствующий до загрузки первой версии. ",
                      )}
                    </p>
                  </>
                )}
                {modal.kind === "upload" && (
                  <>
                    <label>
                      {tr(" Файл ")}
                      <input
                        name="file"
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                        required
                      />
                      <small>
                        {tr(
                          " До 20 МБ. Файл будет проверен перед скачиванием. ",
                        )}
                      </small>
                    </label>
                    <label>
                      {tr(" Сохранить как ")}
                      <select name="document_id">
                        <option value="">{tr("Новый документ")}</option>
                        {data.documents
                          .filter((d: Any) => !d.archived)
                          .map((d: Any) => (
                            <option key={d.id} value={d.id}>
                              {tr(" Новая версия: ")}
                              <span translate="no">{d.name}</span>
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      {tr(" Название нового документа ")}
                      <input
                        name="name"
                        placeholder={tr("Например, заграничный паспорт")}
                      />
                    </label>
                    <label>
                      {tr(" Тип ")}
                      <select name="type">
                        {[
                          "Passport",
                          "Bank Statement",
                          "Insurance",
                          "Other",
                        ].map((t) => (
                          <option key={t} value={t}>
                            {labels[t]}
                          </option>
                        ))}
                      </select>
                    </label>
                    {busy && (
                      <p className="notice">
                        <Loader2 className="spin" size={18} />
                        {tr(" Загрузка файла… Не закрывайте окно. ")}
                      </p>
                    )}
                  </>
                )}
                {modal.kind === "review" && (
                  <>
                    <p>
                      {modal.filename} · v{tr(modal.version)}
                    </p>
                    <label>
                      {tr(" Результат проверки ")}
                      <select name="status" defaultValue={modal.review_status}>
                        {["Uploaded", "Under review", "Approved"].map((t) => (
                          <option key={t} value={t}>
                            {tr(labels[t])}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {tr(" Действует до (необязательно) ")}
                      <input
                        type="date"
                        name="expires_at"
                        defaultValue={modal.expires_at?.slice(0, 10)}
                      />
                    </label>
                  </>
                )}
                {modal.kind === "user-password" && (
                  <>
                    <p>
                      {tr("Сотрудник: ")}
                      {modal.name}
                    </p>
                    <label>
                      {tr(" Новый пароль ")}
                      <input
                        name="password"
                        type="password"
                        required
                        minLength={12}
                        maxLength={128}
                        autoComplete="new-password"
                        autoFocus
                        placeholder={tr("Не менее 12 символов")}
                      />
                    </label>
                    <p className="muted">
                      {tr(
                        " Предыдущий пароль перестанет работать. Сотруднику потребуется войти заново. Передайте ему новый пароль лично. ",
                      )}
                    </p>
                  </>
                )}
                {modal.kind === "user" && (
                  <>
                    <label>
                      {tr(" Имя ")}
                      <input name="name" required autoFocus />
                    </label>
                    <label>
                      Email
                      <input name="email" type="email" required />
                    </label>
                    <label>
                      {tr(" Роль ")}
                      <select name="role_id">
                        {roleOptions.map((r) => (
                          <option key={r.id} value={r.id}>
                            {tr(labels[r.name] || r.name)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {actor.role === "Administrator" && (
                      <label>
                        {tr(" Пароль (необязательно) ")}
                        <input
                          name="password"
                          type="password"
                          minLength={12}
                          maxLength={128}
                          autoComplete="new-password"
                          placeholder={tr("Не менее 12 символов")}
                        />
                      </label>
                    )}
                    <p className="muted">
                      {tr(
                        " Если пароль задан, сотрудник сможет сразу войти с указанным email. Если оставить поле пустым, будет создано приглашение для установки пароля. ",
                      )}
                    </p>
                  </>
                )}
                <div className="modal-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setModal(null)}
                  >
                    {tr(" Отмена ")}
                  </button>
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      (modal.kind === "case" && (!casePolicy || !contractReady))
                    }
                  >
                    {busy ? (
                      <Loader2 className="spin" size={17} />
                    ) : (
                      <Check size={17} />
                    )}
                    {tr(" Сохранить ")}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
function LogTable({ rows, dt }: { rows: Any[]; dt: (d: string) => string }) {
  const tr = useT();

  return rows.length ? (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{tr("Действие")}</th>
            <th>{tr("Сотрудник")}</th>
            <th>{tr("Источник")}</th>
            <th>{tr("Дата")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id}>
              <td>{tr(l.action)}</td>
              <td>{tr(l.author || "Система")}</td>
              <td>
                {tr(
                  l.source === "website"
                    ? "Сайт"
                    : l.source === "telegram"
                      ? "Telegram"
                      : "Система",
                )}
              </td>
              <td>{tr(dt(l.created_at))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty title={tr("Действий пока нет")} />
  );
}
function Login({ onLogin }: { onLogin: () => void }) {
  const tr = useT();

  const [mode, setMode] = useState("login"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [sent, setSent] = useState(false);
  const token =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("token")
      : null;
  return (
    <div className="login-page">
      <LanguageSelector floating />
      <div className="login-story">
        <div className="brand">
          <span className="brandmark">iz</span>Project Iz
        </div>
        <div>
          <span className="eyebrow">{tr("РАБОЧЕЕ ПРОСТРАНСТВО КОМАНДЫ")}</span>
          <h1>
            {tr(" Каждое дело. ")}
            <br />
            {tr(" Каждый документ. ")}
            <br />
            <em>{tr("Всё на месте.")}</em>
          </h1>
          <p>
            {tr(" Спокойная работа со сложными процессами —")}
            <br />
            {tr(" от первого обращения до готовой визы. ")}
          </p>
        </div>
        <span className="login-security">
          <ShieldCheck size={18} />
          {tr(" Доступ только сотрудникам компании ")}
        </span>
      </div>
      <div className="login-form">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const f = new FormData(e.currentTarget);
              const r = token
                ? await authClient.resetPassword({
                    newPassword: String(f.get("password")),
                    token,
                  })
                : mode === "login"
                  ? String(f.get("email")).includes("@")
                    ? await authClient.signIn.email({
                        email: String(f.get("email")).trim(),
                        password: String(f.get("password")),
                      })
                    : await authClient.signIn.username({
                        username: String(f.get("email")).trim(),
                        password: String(f.get("password")),
                      })
                  : await authClient.requestPasswordReset({
                      email: String(f.get("email")),
                      redirectTo: window.location.origin + "/reset-password",
                    });
              if (r.error)
                throw new Error(
                  r.error.message || "Не удалось выполнить запрос",
                );
              if (token) {
                location.href = "/";
              } else if (mode === "login") onLogin();
              else setSent(true);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <span className="eyebrow">{tr("ДОБРО ПОЖАЛОВАТЬ")}</span>
          <h2>
            {tr(
              token
                ? "Новый пароль"
                : mode === "login"
                  ? "Вход в систему"
                  : "Восстановление пароля",
            )}
          </h2>
          <p>
            {tr(
              token
                ? "Не менее 12 символов."
                : mode === "login"
                  ? "Войдите в рабочее пространство компании."
                  : "Отправим ссылку на вашу рабочую почту.",
            )}
          </p>
          {error && (
            <div className="error" role="alert">
              {tr(error)}
            </div>
          )}
          {sent && (
            <div className="notice">
              {tr(" Если аккаунт существует, письмо отправлено. ")}
            </div>
          )}
          {!token && (
            <label>
              {tr(
                mode === "login"
                  ? "Логин или рабочая почта"
                  : " Рабочая почта ",
              )}
              <input
                name="email"
                type={mode === "login" ? "text" : "email"}
                placeholder={
                  mode === "login"
                    ? "Admin / name@company.com"
                    : "name@company.com"
                }
                required
                autoComplete={mode === "login" ? "username" : "email"}
                autoCapitalize="none"
                spellCheck={false}
              />
            </label>
          )}
          {(token || mode === "login") && (
            <label>
              {tr(" Пароль ")}
              <input
                name="password"
                type="password"
                required
                minLength={token ? 12 : 1}
                autoComplete={token ? "new-password" : "current-password"}
              />
            </label>
          )}
          <button className="primary" disabled={busy}>
            {busy ? (
              <Loader2 className="spin" size={17} />
            ) : (
              <ArrowRight size={18} />
            )}
            {tr(" ")}
            {tr(
              token
                ? "Сохранить пароль"
                : mode === "login"
                  ? "Войти"
                  : "Отправить ссылку",
            )}
          </button>
          {!token && (
            <button
              type="button"
              className="text-btn"
              onClick={() => {
                setMode(mode === "login" ? "reset" : "login");
                setError("");
                setSent(false);
              }}
            >
              {tr(mode === "login" ? "Забыли пароль?" : "Вернуться ко входу")}
            </button>
          )}
          <small className="login-help">
            {tr(" Нет доступа? Обратитесь к администратору компании. ")}
          </small>
        </form>
      </div>
    </div>
  );
}

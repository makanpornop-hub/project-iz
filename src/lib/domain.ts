import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
export const caseStatuses = [
  "Contract signing",
  "Waiting for payment",
  "Documents collecting",
  "Under review",
  "Ready for submission",
  "Waiting for decision",
  "Visa approved",
  "Additional request",
  "Visa refused",
] as const;
export const visaTypes = [
  "ВНЖ испания",
  "Non Lucrative Visa Spain",
  "Shengen",
] as const;
export const taskStatuses = ["To do", "In progress", "Completed"] as const;
export const labels: Record<string, string> = {
  New: "Новое",
  "Contract signing": "Подписывается договор",
  "Waiting for payment": "Ожидание оплаты",
  "Documents collecting": "Подготовка документов",
  "Under review": "Проверка документов",
  "Ready for submission": "Готова к подаче",
  "Visa approved": "Одобрено",
  "Visa refused": "Отказ",
  "Waiting for decision": "Ожидание решения",
  "Additional request": "Дозапрос",
  Completed: "Завершено",
  Cancelled: "Отменено",
  "To do": "К выполнению",
  "In progress": "В работе",
  Uploaded: "Загружен",
  Approved: "Одобрен",
  Expired: "Истёк срок",
  Missing: "Не загружен",
  Passport: "Паспорт",
  "Bank Statement": "Выписка из банка",
  Insurance: "Страховка",
  Other: "Другое",
  pending: "Ожидает",
  processing: "Обработка",
  sent: "Отправлено",
  failed: "Ошибка",
  clean: "Проверен",
  infected: "Заблокирован",
  Administrator: "Администратор",
  Manager: "Менеджер",
  Employee: "Сотрудник",
};
export const permissions = [
  "accounting.view",
  "accounting.manage",
  "accounting.view_contract",
  "accounting.view_profit",
  "payments.create",
  "payments.edit",
  "expenses.create",
  "expenses.edit",
  "expense_types.manage",
  "can_view_cases",
  "can_view_all_cases",
  "can_create_cases",
  "can_edit_cases",
  "can_assign_case_staff",
  "can_upload_documents",
  "can_download_documents",
  "can_review_documents",
  "can_archive_documents",
  "can_create_tasks",
  "can_edit_tasks",
  "can_assign_tasks",
  "can_complete_tasks",
  "can_manage_partners",
  "can_manage_users",
  "can_manage_roles",
  "can_manage_settings",
  "can_view_audit_log",
] as const;
export type Permission = (typeof permissions)[number];
export const permissionLabels: Record<Permission, string> = {
  "accounting.view": "Просмотр бухгалтерии",
  "accounting.manage": "Условия оплаты и дедлайн",
  "accounting.view_contract": "Просмотр договора и остатка",
  "accounting.view_profit": "Просмотр прибыли",
  "payments.create": "Добавление платежей",
  "payments.edit": "Изменение и удаление платежей",
  "expenses.create": "Добавление расходов",
  "expenses.edit": "Изменение и удаление расходов",
  "expense_types.manage": "Управление типами расходов",
  can_view_cases: "Просмотр дел",
  can_view_all_cases: "Доступ ко всем делам",
  can_create_cases: "Создание дел",
  can_edit_cases: "Изменение дел",
  can_assign_case_staff: "Назначение сотрудников дела",
  can_upload_documents: "Загрузка документов",
  can_download_documents: "Скачивание документов",
  can_review_documents: "Проверка документов",
  can_archive_documents: "Архивирование документов",
  can_create_tasks: "Создание задач",
  can_edit_tasks: "Изменение задач",
  can_assign_tasks: "Назначение задач",
  can_complete_tasks: "Завершение задач",
  can_manage_partners: "Управление партнёрами",
  can_manage_users: "Управление сотрудниками",
  can_manage_roles: "Управление ролями",
  can_manage_settings: "Настройки системы",
  can_view_audit_log: "Журнал действий",
};
export function overdue(
  status: string,
  deadline: string | Date | null,
  now = new Date(),
) {
  return Boolean(
    deadline && !isClosedStatus(status) && new Date(deadline) < now,
  );
}
export function parseDeadline(
  value: string | null | undefined,
  zone = "Asia/Tashkent",
  defaultTime = "18:00",
) {
  if (!value) return null;
  const d = fromZonedTime(
    value.length === 10 ? value + "T" + defaultTime + ":00" : value,
    zone,
  );
  if (Number.isNaN(d.getTime())) throw new Error("Неверный срок");
  return d;
}
export function reminderTimes(
  deadline: Date,
  zone: string,
  days: number[] = [3, 1],
) {
  const local = formatInTimeZone(deadline, zone, "yyyy-MM-dd");
  return [
    ...days.map((d) => ({
      kind: `before_${d}`,
      at: new Date(deadline.getTime() - d * 86400000),
    })),
    { kind: "today", at: fromZonedTime(local + "T09:00:00", zone) },
    { kind: "overdue", at: deadline },
  ];
}
export function deadlineRemaining(
  deadline: string | Date | null,
  status: string,
  now = Date.now(),
) {
  if (!deadline || isClosedStatus(status)) return "—";
  const difference = new Date(deadline).getTime() - now;
  if (!Number.isFinite(difference)) return "—";
  const hours = Math.floor(Math.abs(difference) / 3600000);
  if (hours < 1)
    return difference <= 0 ? "Просрочено менее часа" : "Меньше часа";
  const count = hours >= 24 ? Math.floor(hours / 24) : hours;
  const forms =
    hours >= 24 ? ["день", "дня", "дней"] : ["час", "часа", "часов"];
  const mod100 = count % 100,
    mod10 = count % 10;
  const word =
    mod100 >= 11 && mod100 <= 14
      ? forms[2]
      : mod10 === 1
        ? forms[0]
        : mod10 >= 2 && mod10 <= 4
          ? forms[1]
          : forms[2];
  return (difference <= 0 ? "Просрочено: " : "") + count + " " + word;
}

export function isClosedStatus(status: string) {
  return ["Completed", "Cancelled", "Visa approved", "Visa refused"].includes(
    status,
  );
}
export function caseFollowupActive(status: string) {
  return [
    "Under review",
    "Ready for submission",
    "Waiting for decision",
    "Additional request",
  ].includes(status);
}

"use client";
import { isClosedStatus } from "@/lib/domain";
import { useState, useEffect, type FormEvent } from "react";
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { labels, taskStatuses } from "@/lib/domain";
import { useT } from "./language";
type Any = Record<string, any>;
export default function TaskPage({
  value,
  actor,
  timezone,
  onRefresh,
}: {
  value: Any;
  actor: Any;
  timezone: string;
  onRefresh: () => Promise<void>;
}) {
  const tr = useT(),
    task = value.task;
  const can = (p: string) => actor.permissions.includes(p);
  const assign =
    ["Administrator", "Manager"].includes(actor.role) &&
    can("can_assign_tasks");
  const closed = isClosedStatus(task.case_status);
  const editable = can("can_edit_tasks") && !closed;
  const [form, setForm] = useState<Any>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    setForm({
      ...task,
      deadline: task.deadline
        ? formatInTimeZone(task.deadline, timezone, "yyyy-MM-dd'T'HH:mm")
        : "",
      escalation_id: task.escalation_id || "",
    });
    setError("");
  }, [task.id, task.revision, timezone]);
  useEffect(() => {
    setSaved(false);
  }, [task.id]);
  const field =
    (name: string) =>
    (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) => {
      setForm((f) => ({ ...f, [name]: e.target.value }));
      setSaved(false);
    };
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/data/mutate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "task.update",
          data: {
            id: task.id,
            case_id: task.case_id,
            revision: task.revision,
            title: form.title,
            description: form.description,
            responsible_id: form.responsible_id,
            escalation_id: form.escalation_id,
            deadline: form.deadline,
            status: form.status,
          },
        }),
      });
      const result = await r.json();
      if (!r.ok) throw Error(result.error);
      await onRefresh();
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel padded task-page">
      <Link className="text-btn" href={"/cases/" + task.case_id + "#tasks"}>
        {tr("Вернуться к задачам дела")}
      </Link>
      <h2>{tr(task.title)}</h2>
      <p>
        {task.client_name} · CASE-{task.number}
      </p>
      {task.workflow_task && (
        <p>
          <Link href={"/cases/" + task.case_id + "#all"}>
            {tr("Открыть перечень документов")}
          </Link>
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {tr(error)}
        </p>
      )}
      {saved && (
        <p role="status" className="notice">
          {tr("Задача сохранена")}
        </p>
      )}
      <form onSubmit={save}>
        <fieldset disabled={!editable || busy}>
          <label>
            {tr("Название задачи")}
            <input
              required
              maxLength={250}
              value={form.title || ""}
              onChange={field("title")}
            />
          </label>
          <label>
            {tr("Описание")}
            <textarea
              rows={4}
              maxLength={10000}
              value={form.description || ""}
              onChange={field("description")}
            />
          </label>
          <label>
            {tr(
              task.title === "Назначить дату билета в Испанию"
                ? "Дата билета в Испанию"
                : "Срок задачи",
            )}{" "}
            · {timezone}
            <input
              type="datetime-local"
              required
              value={form.deadline || ""}
              onChange={field("deadline")}
            />
          </label>
          <div className="form-row">
            <label>
              {tr("Ответственный")}
              {assign ? (
                <select
                  value={form.responsible_id || ""}
                  onChange={field("responsible_id")}
                >
                  {value.staff.map((u: Any) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              ) : (
                <strong className="readonly-value">
                  {task.responsible_name}
                </strong>
              )}
            </label>
            <label>
              {tr("Сотрудник для эскалации")}
              {assign ? (
                <select
                  value={form.escalation_id || ""}
                  onChange={field("escalation_id")}
                >
                  <option value="">{tr("Не назначен")}</option>
                  {value.staff.map((u: Any) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              ) : (
                <strong className="readonly-value">
                  {task.escalation_name || tr("Не назначен")}
                </strong>
              )}
            </label>
          </div>
          <label>
            {tr("Статус")}
            <select
              disabled={task.workflow_task}
              value={form.status || "To do"}
              onChange={field("status")}
            >
              {taskStatuses.map((s) => (
                <option
                  disabled={s === "Completed" && !can("can_complete_tasks")}
                  key={s}
                  value={s}
                >
                  {tr(labels[s])}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        {editable && (
          <button className="primary" disabled={busy}>
            {tr(busy ? "Сохранение…" : "Сохранить задачу")}
          </button>
        )}
      </form>
    </section>
  );
}

"use client";
import { isClosedStatus, caseFollowupActive } from "@/lib/domain";
import { useEffect, useRef, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { CalendarDays, Download, Clock3 } from "lucide-react";
import { useT } from "./language";
type Any = Record<string, any>;

export function StatusCheckDialog({
  timezone,
  initialDate,
  busy,
  error,
  onClose,
  onSubmit,
  submitting = false,
}: {
  timezone: string;
  submitting?: boolean;
  initialDate?: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (date: string) => void;
}) {
  const tr = useT(),
    dialog = useRef<HTMLDialogElement>(null);
  const today = formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");
  const [date, setDate] = useState(
    initialDate && initialDate >= today ? initialDate : "",
  );
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      className="status-check-dialog"
      ref={dialog}
      aria-labelledby="status-check-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) onSubmit(date);
        }}
      >
        <h2 id="status-check-title">{tr("Когда проверить статус?")}</h2>
        <p>
          {tr(
            submitting
              ? "После сохранения документы поступят администратору на проверку, а дело перейдёт в «Проверка документов». ZIP и напоминание сохранятся."
              : "Изменение даты проверки не меняет этап дела.",
          )}
        </p>
        <label>
          {tr("Дата проверки статуса")}
          <input
            type="date"
            required
            min={today}
            value={date}
            disabled={busy}
            autoFocus
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <p className="muted">
          {tr("Бот напомнит ответственному в выбранный день в 09:00.")}{" "}
          {timezone}.{" "}
          {tr(
            "Если выбрано сегодня и 09:00 уже прошло, напоминание придёт после сохранения.",
          )}
        </p>
        {error && (
          <p className="error" role="alert">
            {tr(error)}
          </p>
        )}
        <div className="row-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            {tr("Отмена")}
          </button>
          <button className="primary" disabled={busy || !date}>
            {tr(
              busy
                ? "Сохранение…"
                : submitting
                  ? "Отправить на проверку"
                  : "Сохранить",
            )}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export default function CaseFollowup({
  caseId,
  value,
  timezone,
  canEdit,
  canDownload,
  caseStatus,
  responsibleName,
  workflowState,
  onRefresh,
  onDocuments,
}: {
  caseId: string;
  value: Any | null;
  timezone: string;
  canEdit: boolean;
  canDownload: boolean;
  caseStatus: string;
  responsibleName: string;
  workflowState?: string;
  onRefresh: () => Promise<void>;
  onDocuments: () => void;
}) {
  const tr = useT();
  const [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const closed = isClosedStatus(caseStatus);
  async function save(date: string) {
    if (busy || !value) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "workflow.reschedule",
          data: { case_id: caseId, check_date: date, revision: value.revision },
        }),
      });
      const result = await r.json();
      if (!r.ok)
        throw Error(result.error || "Не удалось сохранить дату проверки");
      await onRefresh();
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!value)
    return (
      <section className="panel padded case-followup">
        <h2>{tr("Дозапрос")}</h2>
        <p>
          {tr(
            "Завершите перечень документов кнопкой «Готово» и выберите дату проверки статуса. Здесь появятся дедлайн и ZIP. Статус «Дозапрос» выбирается вручную.",
          )}
        </p>
        <button onClick={onDocuments}>{tr("Открыть документы")}</button>
      </section>
    );
  return (
    <section className="panel padded case-followup">
      <header>
        <h2>{tr("Дозапрос")}</h2>
        {canEdit && !closed && (
          <button
            onClick={() => {
              setError("");
              setEditing(true);
            }}
          >
            {tr("Изменить дату проверки")}
          </button>
        )}
      </header>
      <div className="followup-summary">
        <div>
          <CalendarDays size={20} />
          <span>{tr("Дедлайн проверки")}</span>
          <strong>
            {formatInTimeZone(value.check_at, timezone, "dd.MM.yyyy")}
          </strong>
          <small>09:00 · {timezone}</small>
        </div>
        <div>
          <Clock3 size={20} />
          <span>{tr("Ответственный")}</span>
          <strong>{responsibleName}</strong>
          <small>
            {tr(
              !caseFollowupActive(caseStatus)
                ? "Напоминание приостановлено: дело находится на другом этапе."
                : value.telegram_sent_at
                  ? "Напоминание отправлено в Telegram"
                  : value.notified_at
                    ? "Напоминание создано"
                    : "Напоминание запланировано",
            )}
          </small>
        </div>
      </div>
      <div className="workflow-archive">
        <div>
          <strong>{tr("ZIP всех документов")}</strong>
          <p translate="no">{value.filename}</p>
          <small>
            {tr("Файлов:")} {value.file_count} ·{" "}
            {(Number(value.size) / 1024 / 1024).toFixed(1)} {tr("МБ")}
          </small>
        </div>
        {canDownload && (
          <a
            className="button primary"
            href={"/api/workflow/archives/" + value.archive_id}
          >
            <Download size={17} />
            {tr("Скачать ZIP")}
          </a>
        )}
      </div>
      {!["submitted", "approved"].includes(workflowState || "") && (
        <p className="muted">
          {tr(
            "Документы изменены после создания ZIP. Нажмите «Готово» в документах, чтобы обновить пакет.",
          )}
        </p>
      )}
      <button className="text-btn" onClick={onDocuments}>
        {tr("Открыть документы")}
      </button>
      {editing && (
        <StatusCheckDialog
          timezone={timezone}
          initialDate={formatInTimeZone(value.check_at, timezone, "yyyy-MM-dd")}
          busy={busy}
          error={error}
          onClose={() => setEditing(false)}
          onSubmit={(date) => void save(date)}
        />
      )}
    </section>
  );
}

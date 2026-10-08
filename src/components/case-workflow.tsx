"use client";
import { useT } from "./language";
import { useState, useRef, useEffect, type FormEvent } from "react";
import {
  Plus,
  Upload,
  Download,
  RefreshCw,
  FileStack,
  Pencil,
  CheckCircle2,
} from "lucide-react";
import { DocumentIssueDialog } from "./case-chat";
import { StatusCheckDialog } from "./case-followup";
import { formatInTimeZone } from "date-fns-tz";
import FilePreview, { documentStatus } from "./file-preview";
import {
  workflowIssues,
  workflowGroupProgress,
  type WorkflowIssue,
} from "@/lib/workflow-validation";
type Any = Record<string, any>;
export default function CaseWorkflow({
  value,
  caseId,
  canEdit,
  canDownload,
  isAdmin,
  onRefresh,
  responsibleId,
  onOpenChat,
  onForward,
  timezone,
  followup,
  onSubmitted,
}: {
  timezone: string;
  followup: Any | null;
  onSubmitted: () => void;
  value: Any;
  caseId: string;
  canEdit: boolean;
  canDownload: boolean;
  isAdmin: boolean;
  onRefresh: () => Promise<void>;
  responsibleId: string;
  onOpenChat: (target: { thread?: string; document?: string }) => void;
  onForward: (file: Any) => void;
}) {
  const tr = useT();
  const [issueFile, setIssueFile] = useState<Any | null>(null);

  const [showIssues, setShowIssues] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const issues = showIssues ? workflowIssues(value) : [];
  const issueFor = (id: string) => issues.find((i) => i.id === id)?.message;
  function pointToIssues(list: WorkflowIssue[]) {
    setShowIssues(true);
    requestAnimationFrame(() => {
      const node = document.getElementById("workflow-field-" + list[0]?.id);
      const group = node?.closest<HTMLDetailsElement>("details.workflow-group");
      if (group) group.open = true;
      node?.scrollIntoView({ behavior: "smooth", block: "center" });
      node?.focus({ preventScroll: true });
    });
  }
  function finish() {
    const list = workflowIssues(value);
    if (list.length) {
      setError("Заполните выделенные поля и завершите проверку документов.");
      pointToIssues(list);
      return;
    }
    setShowIssues(false);
    setError("");
    setFinishOpen(true);
  }
  const [preview, setPreview] = useState<Any | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [editor, setEditor] = useState<Any | null>(null),
    [reviewNote, setReviewNote] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const locked = ["submitted", "approved"].includes(value.state),
    editable = canEdit;
  useEffect(() => {
    if (editor) {
      form.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      form.current?.querySelector<HTMLInputElement>("input")?.focus();
    }
  }, [!!editor]);
  useEffect(() => {
    if (busy || editor) return;
    const pending =
      (value.archive?.telegram_status &&
        ["pending", "processing"].includes(value.archive.telegram_status)) ||
      value.groups.some((g: Any) =>
        [...g.fields, g.output].some(
          (f: Any) => f?.latest?.scan_status === "pending",
        ),
      );
    if (!pending) return;
    const timer = setInterval(() => {
      if (
        !["INPUT", "TEXTAREA", "SELECT"].includes(
          document.activeElement?.tagName || "",
        )
      )
        void onRefresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [value, busy, editor, onRefresh]);
  async function act(action: string, data: Any = {}) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, data: { ...data, case_id: caseId } }),
      });
      const result = await r.json();
      if (!r.ok) {
        if (result.issues?.length) {
          setFinishOpen(false);
          await onRefresh();
          pointToIssues(result.issues);
        }
        throw new Error(result.error);
      }
      setEditor(null);
      await onRefresh();
      if (action === "workflow.submit") {
        setFinishOpen(false);
        onSubmitted();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(field: Any, file?: File) {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.set("case_id", caseId);
      body.set("document_id", field.id);
      body.set("type", "Other");
      body.set("file", file);
      const r = await fetch("/api/documents", { method: "POST", body });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function groupEditor(group?: Any) {
    setError("");
    setEditor(
      group
        ? {
            ...group,
            fields: group.fields.map((f: Any) => ({
              id: f.id,
              name: f.name,
              required: f.required,
              merge_order: f.merge_order,
            })),
          }
        : {
            name: "",
            notes: "",
            fields: [{ name: "", required: true, merge_order: null }],
          },
    );
  }
  function changeField(index: number, key: string, v: any) {
    setEditor({
      ...editor,
      fields: editor!.fields.map((f: Any, i: number) =>
        i === index ? { ...f, [key]: v } : f,
      ),
    });
  }
  function fresh(g: Any) {
    const ids = g.fields
      .filter((f: Any) => f.merge_order)
      .sort((a: Any, b: Any) => a.merge_order - b.merge_order)
      .map((f: Any) => f.latest?.id);
    return (
      ids.every(Boolean) &&
      JSON.stringify(ids) ===
        JSON.stringify(g.output?.latest?.source_version_ids)
    );
  }
  const reviewDocuments = (g: Any) =>
    [
      ...g.fields,
      ...(g.fields.some((f: Any) => f.merge_order) ? [g.output] : []),
    ].filter(Boolean);
  const allReviewDocuments = value.groups.flatMap(reviewDocuments);
  const approvedCount = allReviewDocuments.filter(
    (f: Any) => f.latest?.review_status === "Approved",
  ).length;
  const completedGroups = value.groups.filter(
    (g: Any) => workflowGroupProgress(g).complete,
  ).length;
  const groupCount = value.groups.length;
  const percent = groupCount
    ? Math.round((completedGroups / groupCount) * 100)
    : 0;
  function commentActions(doc: Any) {
    if (!doc?.latest) return null;
    return (
      <div className="workflow-actions">
        {doc.open_issues > 0 && (
          <button
            type="button"
            className="text-btn chat-issue-count"
            onClick={() => onOpenChat({ document: doc.id })}
          >
            {tr("Замечания")}: {doc.open_issues}
          </button>
        )}
        {canDownload && (
          <button
            type="button"
            className="text-btn"
            onClick={() => onForward(doc.latest)}
          >
            {tr("В чат")}
          </button>
        )}
        {isAdmin && canDownload && (
          <button
            type="button"
            className="text-btn"
            onClick={() => setIssueFile(doc.latest)}
          >
            {tr("Указать ошибку")}
          </button>
        )}
      </div>
    );
  }
  function fileInfo(file: Any) {
    if (!file) return <small>{tr("Файл не загружен")}</small>;
    return (
      <div className="workflow-file-meta">
        {canDownload && file.scan_status === "clean" ? (
          <button
            type="button"
            className="workflow-filename"
            title={"Посмотреть " + file.filename}
            onClick={() => setPreview(file)}
          >
            <span translate="no">{file.filename}</span>
          </button>
        ) : (
          <small>
            <span translate="no">{file.filename}</span>
          </small>
        )}
        <span
          className={
            "document-status status-" + file.review_status.replaceAll(" ", "-")
          }
        >
          {tr(documentStatus[file.review_status] || file.review_status)}
        </span>
      </div>
    );
  }
  const stateLabel: Any = {
    draft: "Подготовка документов",
    submitted: "Ожидает проверки администратора",
    approved: "Одобрено — задача завершена",
    rejected: "Возвращено на доработку",
  };
  return (
    <section className="workflow-section">
      {finishOpen && (
        <StatusCheckDialog
          submitting
          timezone={timezone}
          initialDate={
            followup?.check_at
              ? formatInTimeZone(followup.check_at, timezone, "yyyy-MM-dd")
              : undefined
          }
          busy={busy}
          error={error}
          onClose={() => setFinishOpen(false)}
          onSubmit={(date) => void act("workflow.submit", { check_date: date })}
        />
      )}
      {issueFile && (
        <DocumentIssueDialog
          caseId={caseId}
          file={{ ...issueFile, responsible_id: responsibleId }}
          onClose={() => setIssueFile(null)}
          onSaved={(thread) => {
            setIssueFile(null);
            void onRefresh();
            onOpenChat({ thread });
          }}
        />
      )}
      {preview && (
        <FilePreview
          key={preview.id}
          file={
            preview as { id: string; filename: string; review_status: string }
          }
          isAdmin={isAdmin}
          onClose={() => setPreview(null)}
          onChanged={onRefresh}
          onIssue={
            isAdmin
              ? () => {
                  setIssueFile(preview);
                  setPreview(null);
                }
              : undefined
          }
        />
      )}
      <div className="panel padded workflow-summary">
        <div className="workflow-heading">
          <div>
            <h2>{tr("Перечень документов · ВНЖ Испания")}</h2>
            <p className="muted">
              {tr("Подтверждено документов:")} {approvedCount}/
              {allReviewDocuments.length}
            </p>
            <div className="workflow-progress">
              <div>
                <span>
                  {tr("Готовые группы:")} {completedGroups} {tr("из")}{" "}
                  {groupCount}
                </span>
                <strong>{tr(percent)}%</strong>
              </div>
              <progress
                max={Math.max(groupCount, 1)}
                value={completedGroups}
                aria-label={tr("Готовность групп документов")}
                aria-valuetext={percent + "%"}
              />
            </div>
            <p>{tr(stateLabel[value.state])}</p>
          </div>
          <button disabled={busy} onClick={() => onRefresh()}>
            <RefreshCw size={16} />
            {tr(" Обновить ")}
          </button>
        </div>
        <p className="muted">
          {tr(
            " PDF, JPG или PNG, до 20 МБ на файл. Скачивание и объединение доступны после проверки антивирусом. Обязательные поля отмечены звёздочкой. ",
          )}
        </p>
        {value.review_note && (
          <p className="workflow-review-note">
            {tr(" Комментарий администратора: ")}
            {tr(value.review_note)}
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {tr(error)}
          </p>
        )}
        {editable && (
          <div className="workflow-actions">
            <button disabled={busy} onClick={() => groupEditor()}>
              <Plus size={16} />
              {tr(" Добавить группу ")}
            </button>
          </div>
        )}
      </div>
      {editor && (
        <form
          ref={form}
          className="panel padded workflow-editor"
          onSubmit={(e) => {
            e.preventDefault();
            void act("workflow.group", editor);
          }}
        >
          <h3>{tr(editor.id ? "Изменить группу" : "Добавить группу")}</h3>
          <fieldset disabled={busy}>
            <label>
              {tr(" Название группы ")}
              <input
                required
                maxLength={250}
                value={editor.name}
                onChange={(e) => setEditor({ ...editor, name: e.target.value })}
              />
            </label>
            <label>
              {tr(" Заметки ")}
              <textarea
                maxLength={10000}
                value={editor.notes || ""}
                onChange={(e) =>
                  setEditor({ ...editor, notes: e.target.value })
                }
              />
            </label>
            <p className="muted">
              {tr(
                " Порядок объединения: 1, 2, 3… Оставьте пустым для файлов, которые не нужно включать в итоговый PDF. ",
              )}
            </p>
            {editor.fields.map((f: Any, i: number) => (
              <div className="workflow-edit-field" key={f.id || i}>
                <label>
                  {tr(" Название поля ")}
                  <input
                    required
                    maxLength={250}
                    value={f.name}
                    onChange={(e) => changeField(i, "name", e.target.value)}
                  />
                </label>
                <label>
                  {tr(" Порядок в PDF ")}
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={f.merge_order ?? ""}
                    onChange={(e) =>
                      changeField(
                        i,
                        "merge_order",
                        e.target.value ? Number(e.target.value) : null,
                      )
                    }
                  />
                </label>
                <label className="workflow-checkbox">
                  <input
                    type="checkbox"
                    checked={f.required}
                    onChange={(e) =>
                      changeField(i, "required", e.target.checked)
                    }
                  />
                  {tr(" Обязательное ")}
                </label>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setEditor({
                  ...editor,
                  fields: [
                    ...editor.fields,
                    { name: "", required: true, merge_order: null },
                  ],
                })
              }
            >
              <Plus size={15} />
              {tr(" Добавить поле ")}
            </button>
          </fieldset>
          <div className="workflow-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditor(null)}
            >
              {tr(" Отмена ")}
            </button>
            <button disabled={busy} className="primary">
              {tr(" Сохранить группу ")}
            </button>
          </div>
        </form>
      )}
      <div className="workflow-groups">
        {value.groups.map((g: Any) => {
          const sources = g.fields
            .filter((f: Any) => f.merge_order)
            .sort((a: Any, b: Any) => a.merge_order - b.merge_order);
          const progress = workflowGroupProgress(g);
          const documents = reviewDocuments(g);
          const approved = documents.filter(
            (f: Any) => f.latest?.review_status === "Approved",
          ).length;
          const versions = documents
            .filter((f: Any) => f.latest)
            .map((f: Any) => f.latest);
          return (
            <details className="panel padded workflow-group" key={g.id}>
              <summary className="workflow-group-summary">
                <span className="workflow-group-name">
                  <span translate="no">{g.name}</span>
                </span>
                <span className="workflow-group-count">
                  {tr("Документов готово:")} {progress.done}/{progress.total}{" "}
                  {progress.complete ? " · " + tr("Готово") : ""}
                </span>
                <span className="workflow-group-count">
                  {tr("Подтверждено:")} {approved}/{documents.length}
                </span>
                {isAdmin && (
                  <button
                    type="button"
                    disabled={
                      busy ||
                      !versions.length ||
                      versions.every(
                        (v: Any) => v.review_status === "Approved",
                      ) ||
                      versions.some((v: Any) => v.scan_status !== "clean")
                    }
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void act("workflow.approveGroup", {
                        group_id: g.id,
                        version_ids: versions.map((v: Any) => v.id),
                      });
                    }}
                  >
                    {tr("Подтвердить всё")}
                  </button>
                )}
              </summary>
              <div className="workflow-group-content">
                {editable && (
                  <div className="workflow-actions">
                    <button disabled={busy} onClick={() => groupEditor(g)}>
                      <Pencil size={15} />
                      {tr("Изменить группу")}
                    </button>
                  </div>
                )}
                {g.kind === "business" && (
                  <div className="workflow-stamp">
                    <span>Штамп / печать (необязательно)</span>
                    <button
                      disabled={!editable || busy}
                      aria-pressed={g.stamp === true}
                      onClick={() =>
                        act("workflow.stamp", { group_id: g.id, stamp: true })
                      }
                    >
                      {tr(" Готово ")}
                      {tr(g.stamp === true ? "✓" : "")}
                    </button>
                    <button
                      disabled={!editable || busy}
                      aria-pressed={g.stamp === false}
                      onClick={() =>
                        act("workflow.stamp", { group_id: g.id, stamp: false })
                      }
                    >
                      {tr(" Неготово ")}
                      {tr(g.stamp === false ? "✓" : "")}
                    </button>
                  </div>
                )}
                {(g.kind === "company" || g.notes) && (
                  <form
                    className="workflow-group-note"
                    key={g.id + ":" + g.notes}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void act("workflow.notes", {
                        group_id: g.id,
                        notes: String(f.get("notes") || ""),
                      });
                    }}
                  >
                    <label>
                      {tr(" Заметки ")}
                      <textarea
                        name="notes"
                        aria-label={"Заметки: " + g.name}
                        rows={3}
                        maxLength={10000}
                        defaultValue={g.notes}
                        readOnly={!editable}
                        disabled={busy}
                      />
                    </label>
                    {editable && (
                      <button disabled={busy}>{tr("Сохранить заметки")}</button>
                    )}
                  </form>
                )}
                <div className="workflow-fields">
                  {g.fields.map((f: Any) => (
                    <div
                      className={
                        "workflow-file" +
                        (issueFor(f.id) ? " workflow-invalid" : "")
                      }
                      key={f.id}
                      id={"workflow-field-" + f.id}
                      tabIndex={-1}
                      aria-invalid={!!issueFor(f.id)}
                      aria-describedby={
                        issueFor(f.id) ? "workflow-error-" + f.id : undefined
                      }
                    >
                      <div>
                        <strong>
                          <span translate="no">{f.name}</span>
                          {tr(f.required ? " *" : "")}
                        </strong>
                        {tr(fileInfo(f.latest))}
                        {commentActions(f)}
                        {issueFor(f.id) && (
                          <p
                            className="workflow-field-error"
                            id={"workflow-error-" + f.id}
                          >
                            {tr(issueFor(f.id))}
                          </p>
                        )}
                        {f.latest && (
                          <span
                            className={
                              "workflow-scan scan-" + f.latest.scan_status
                            }
                          >
                            {{
                              pending: "Проверяется антивирусом",
                              clean: "Проверен",
                              infected: "Заблокирован антивирусом",
                              failed: "Ошибка проверки",
                            }[f.latest.scan_status as string] ||
                              f.latest.scan_status}
                          </span>
                        )}
                      </div>
                      <div className="workflow-actions">
                        {f.latest?.scan_status === "clean" && canDownload && (
                          <a
                            href={"/api/documents/" + f.latest.id}
                            className="text-btn"
                          >
                            <Download size={15} />
                            {tr(" Скачать ")}
                          </a>
                        )}
                        {editable && (
                          <label className="workflow-upload">
                            <Upload size={15} />
                            {tr(f.latest ? "Заменить" : "Загрузить")}
                            <input
                              disabled={busy}
                              type="file"
                              accept=".pdf,.jpg,.jpeg,.png"
                              aria-label={
                                "Загрузить " + g.name + " — " + f.name
                              }
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                e.target.value = "";
                                void upload(f, file);
                              }}
                            />
                          </label>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {sources.length > 0 && (
                  <div
                    className={
                      "workflow-result" +
                      (issueFor(g.output?.id || g.id)
                        ? " workflow-invalid"
                        : "")
                    }
                    id={"workflow-field-" + (g.output?.id || g.id)}
                    tabIndex={-1}
                  >
                    <div>
                      <b>{tr("Объединённый файл")}</b>
                      {issueFor(g.output?.id || g.id) && (
                        <p className="workflow-field-error">
                          {tr(issueFor(g.output?.id || g.id))}
                        </p>
                      )}
                      <details className="workflow-merge-order">
                        <summary>{tr("Порядок объединения")}</summary>
                        <p>{sources.map((f: Any) => f.name).join(" → ")}</p>
                      </details>
                      {g.output?.latest ? (
                        fileInfo(g.output.latest)
                      ) : (
                        <p>{tr("Результат ещё не создан")}</p>
                      )}
                      {commentActions(g.output)}
                      {g.output?.latest && !fresh(g) && (
                        <p className="error">
                          {tr(
                            " Исходные файлы изменились — объедините их заново. ",
                          )}
                        </p>
                      )}
                      {g.output?.latest?.scan_status !== "clean" &&
                        g.output?.latest && (
                          <p className="muted">
                            {tr(" Результат:")}
                            {tr(" ")}
                            {{
                              pending: "проверяется",
                              infected: "заблокирован",
                              failed: "ошибка проверки",
                            }[g.output.latest.scan_status as string] ||
                              g.output.latest.scan_status}
                          </p>
                        )}
                    </div>
                    <div className="workflow-actions">
                      {editable && (
                        <button
                          className="primary"
                          disabled={busy || !canDownload}
                          onClick={() =>
                            act("workflow.merge", { group_id: g.id })
                          }
                        >
                          <FileStack size={16} />
                          {tr(" Объединить документы ")}
                        </button>
                      )}
                      {g.output?.latest?.scan_status === "clean" &&
                        canDownload && (
                          <a
                            className="text-btn"
                            href={"/api/documents/" + g.output.latest.id}
                          >
                            <Download size={16} />
                            {tr(" Скачать результат ")}
                          </a>
                        )}
                    </div>
                  </div>
                )}
                {g.kind === "criminal" && editable && (
                  <button
                    disabled={busy}
                    onClick={() => act("workflow.criminal")}
                  >
                    <Plus size={16} />
                    {tr(" Добавить ещё справку о несудимости ")}
                  </button>
                )}
              </div>
            </details>
          );
        })}
      </div>
      <section className="panel padded workflow-finish">
        <h3>{tr("Завершение сбора документов")}</h3>
        <p>
          {tr(
            "«Готово» создаст ZIP и переведёт дело в «Проверка документов». После одобрения администратором — в «Готова к подаче». Выбранная дата сохраняется для напоминания.",
          )}
        </p>
        {editable && (
          <button className="primary" disabled={busy} onClick={finish}>
            <CheckCircle2 size={17} />
            {tr(" Готово ")}
          </button>
        )}
        {busy && <p role="status">{tr("Подождите, операция выполняется…")}</p>}
        {error && (
          <p className="error" role="alert">
            {tr(error)}
          </p>
        )}
        {value.archive && (
          <p className="muted">
            {tr(
              value.archive.telegram_sent_at
                ? "ZIP отправлен в Telegram"
                : value.archive.telegram_status === "failed"
                  ? "Не удалось отправить ZIP в Telegram"
                  : value.archive.telegram_status
                    ? "ZIP в очереди отправки в Telegram"
                    : "",
            )}
          </p>
        )}
        {value.archive && (
          <div className="workflow-archive">
            <div>
              <strong>{tr("ZIP всех документов")}</strong>
              <p>
                <span translate="no">{value.archive.filename}</span>
                {tr(" · Файлов: ")}
                {tr(value.archive.file_count)} ·{tr(" ")}
                {tr((Number(value.archive.size) / 1024 / 1024).toFixed(1))}
                {tr(" МБ ")}
              </p>
              {!locked && (
                <small>
                  {tr(
                    " Архив предыдущей отправки. После доработки нажмите «Готово», чтобы создать новый. ",
                  )}
                </small>
              )}
            </div>
            {canDownload && (
              <a
                className="text-btn"
                href={"/api/workflow/archives/" + value.archive.id}
              >
                <Download size={17} />
                {tr(" Скачать ZIP ")}
              </a>
            )}
          </div>
        )}
        {locked && <p>{tr(stateLabel[value.state])}</p>}
        {isAdmin && locked && (
          <div className="workflow-review">
            <label>
              {tr(" Комментарий проверки ")}
              <textarea
                maxLength={10000}
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder={tr(
                  "При возврате укажите, что необходимо исправить",
                )}
              />
            </label>
            <div className="workflow-actions">
              {value.state === "submitted" && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    act("workflow.review", {
                      decision: "approve",
                      revision: value.revision,
                      note: reviewNote,
                    })
                  }
                >
                  {tr(" Одобрить — готова к подаче ")}
                </button>
              )}
              <button
                disabled={busy || !reviewNote.trim()}
                onClick={() =>
                  act("workflow.review", {
                    decision: "reject",
                    revision: value.revision,
                    note: reviewNote,
                  })
                }
              >
                {tr(" Вернуть на доработку ")}
              </button>
            </div>
          </div>
        )}
      </section>
    </section>
  );
}

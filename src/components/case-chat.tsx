"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "./language";
import {
  useClipboardPhoto,
  PhotoDraft,
  ChatPhoto,
  submitChatOnEnter,
} from "./chat-photo";
import FilePreview from "./file-preview";
type Any = Record<string, any>;
export const chatStatus: Record<string, string> = {
  open: "Требует исправления",
  review: "На проверке",
  closed: "Закрыто",
};
export async function chatWrite(action: string, data: Any) {
  const r = await fetch("/api/data/mutate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, data }),
  });
  const result = await r.json();
  if (!r.ok) throw Error(result.error || "Не удалось сохранить сообщение");
  return result;
}
export function DocumentIssueDialog({
  caseId,
  file,
  onClose,
  onSaved,
}: {
  caseId: string;
  file: Any;
  onClose: () => void;
  onSaved: (threadId: string) => void;
}) {
  const tr = useT(),
    dialog = useRef<HTMLDialogElement>(null);
  const [members, setMembers] = useState<Any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  useEffect(() => {
    dialog.current?.showModal();
    let alive = true;
    fetch("/api/data/chat?members=1&case_id=" + caseId)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        if (alive) setMembers(d.members);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [caseId]);
  return (
    <dialog
      ref={dialog}
      className="chat-issue-dialog"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const f = new FormData(e.currentTarget);
          try {
            const result = await chatWrite("chat.issue", {
              case_id: caseId,
              version_id: file.id,
              request_id: requestId.current,
              body: f.get("body"),
              assignee_id: f.get("assignee_id"),
              deadline: f.get("deadline"),
            });
            onSaved(result.thread_id);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2>{tr("Указать ошибку")}</h2>
        <p translate="no">
          {file.filename} · {tr("Версия")} {file.version}
        </p>
        <label>
          {tr("Что нужно исправить")}
          <textarea name="body" rows={4} maxLength={10000} required autoFocus />
        </label>
        <label>
          {tr("Кому исправить")}
          <select
            name="assignee_id"
            key={members.length}
            defaultValue={file.responsible_id}
            required
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {tr("Срок исправления (необязательно)")}
          <input name="deadline" type="date" />
        </label>
        {error && (
          <p className="error" role="alert">
            {tr(error)}
          </p>
        )}
        <div className="row-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            {tr("Отмена")}
          </button>
          <button className="primary" disabled={busy || !members.length}>
            {tr("Отправить замечание")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
export default function CaseChat({
  caseId,
  actor,
  initialThread,
  initialDocument,
  focusMessage,
  attachment,
  onAttachmentClear,
  onDocuments,
  onCount,
}: {
  caseId: string;
  actor: Any;
  initialThread?: string;
  initialDocument?: string;
  focusMessage?: string;
  attachment?: Any | null;
  onAttachmentClear: () => void;
  onDocuments: (documentId: string) => void;
  onCount: (n: number) => void;
}) {
  const tr = useT();
  const [anchor, setAnchor] = useState(focusMessage || "");
  const [data, setData] = useState<Any | null>(null),
    [status, setStatus] = useState("all"),
    [threadId, setThreadId] = useState(initialThread || ""),
    [documentId, setDocumentId] = useState(initialDocument || "");
  const [body, setBody] = useState(""),
    [mentions, setMentions] = useState<string[]>([]),
    [reply, setReply] = useState<Any | null>(null),
    [file, setFile] = useState<Any | null>(attachment || null),
    [preview, setPreview] = useState<Any | null>(null),
    [inspected, setInspected] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const photo = useClipboardPhoto(setError, busy);
  const sending = useRef(false);
  const list = useRef<HTMLDivElement>(null),
    history = useRef(false),
    request = useRef(crypto.randomUUID()),
    currentQuery = useRef("");
  const canDownload = actor.permissions.includes("can_download_documents"),
    canUpload = actor.permissions.includes("can_upload_documents");
  const isAdmin =
    actor.role === "Administrator" &&
    actor.permissions.includes("can_review_documents");
  const query =
    "/api/data/chat?case_id=" +
    caseId +
    "&status=" +
    status +
    (threadId ? "&thread=" + threadId : "") +
    (documentId ? "&document=" + documentId : "") +
    (anchor ? "&focus=" + anchor : "");
  currentQuery.current = query;
  const onCountRef = useRef(onCount);
  onCountRef.current = onCount;
  const load = useCallback(
    async (before?: string) => {
      const r = await fetch(query + (before ? "&before=" + before : ""), {
          cache: "no-store",
        }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      if (currentQuery.current !== query) return;
      setData((prev: Any) =>
        before && prev
          ? { ...d, messages: [...d.messages, ...prev.messages] }
          : d,
      );
      onCountRef.current(d.unread);
    },
    [query],
  );
  useEffect(() => {
    setAnchor(focusMessage || "");
    setThreadId(initialThread || "");
    setDocumentId(initialDocument || "");
    setStatus("all");
    setReply(null);
  }, [initialThread, initialDocument, focusMessage]);
  useEffect(() => {
    if (attachment) {
      setFile(attachment);
      setThreadId("");
      setDocumentId("");
      setReply(null);
    }
  }, [attachment]);
  useEffect(() => {
    history.current = false;
    setData(null);
    setError("");
    void load().catch((e) => setError(e.message));
    const timer = setInterval(() => {
      if (!document.hidden && !history.current)
        void load().catch((e) => setError(e.message));
    }, 5000);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => {
    if (!data || document.hidden) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const ids = entries
          .filter((e) => e.isIntersecting)
          .map((e) => (e.target as HTMLElement).dataset.message!)
          .filter(Boolean);
        if (!ids.length) return;
        for (const e of entries.filter((e) => e.isIntersecting))
          observer.unobserve(e.target);
        void chatWrite("chat.read", { case_id: caseId, ids })
          .then(() => {
            setData((old: Any) =>
              old
                ? {
                    ...old,
                    messages: old.messages.map((m: Any) =>
                      ids.includes(m.id) ? { ...m, is_read: true } : m,
                    ),
                  }
                : old,
            );
          })
          .catch(() => {});
      },
      { threshold: 0.3 },
    );
    list.current
      ?.querySelectorAll('[data-unread="true"]')
      .forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [data, caseId]);
  useEffect(() => {
    if (
      focusMessage &&
      data?.messages.some((m: Any) => m.id === focusMessage)
    ) {
      document
        .getElementById("chat-message-" + focusMessage)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [focusMessage, !!data]);
  const thread = data?.threads.find((t: Any) => t.id === threadId);
  async function send(action = "chat.send") {
    if (sending.current || busy || (!body.trim() && !file && !photo.image))
      return;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const imageId =
        action === "chat.send"
          ? await photo.upload({ case_id: caseId })
          : undefined;
      await chatWrite(action, {
        case_id: caseId,
        request_id: request.current,
        image_id: imageId,
        body,
        thread_id: threadId || undefined,
        version_id:
          action === "chat.resolve" ? thread?.latest_version_id : file?.id,
        reply_to: reply?.id,
        mention_ids: mentions,
        ...(action === "chat.resolve" ? { decision: "reopen" } : {}),
      });
      request.current = crypto.randomUUID();
      setBody("");
      if (action === "chat.send") photo.clear();
      setFile(null);
      setReply(null);
      setMentions([]);
      onAttachmentClear();
      history.current = false;
      await load();
      requestAnimationFrame(() =>
        list.current?.scrollTo({
          top: list.current.scrollHeight,
          behavior: "smooth",
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  function changeThread(id: string) {
    setAnchor("");
    setThreadId(id);
    setReply(null);
    setInspected("");
  }
  function fileButton(v: Any) {
    return (
      <button
        type="button"
        className="chat-file"
        disabled={!canDownload || v.scan_status !== "clean"}
        onClick={() => setPreview(v)}
      >
        <span translate="no">📄 {v.filename}</span> · {tr("Версия")} {v.version}
        {v.scan_status !== "clean" && (
          <small>
            {tr(
              v.scan_status === "pending"
                ? "Проверяется антивирусом"
                : "Файл недоступен",
            )}
          </small>
        )}
      </button>
    );
  }
  return (
    <section className="panel padded case-chat">
      <div className="chat-details">
        <header className="chat-heading">
          <div>
            <h2>{tr("Чат дела")}</h2>
            <p className="muted">
              {tr("Участники")}:{" "}
              {data?.members.map((m: Any) => m.name).join(", ")}
            </p>
          </div>
          <button
            disabled={busy}
            onClick={() => {
              history.current = false;
              setAnchor("");
              void load().catch((e) => setError(e.message));
            }}
          >
            {tr("Обновить")}
          </button>
        </header>
        <div className="chat-filters">
          {[
            ["all", "Все сообщения"],
            ["open", "Требует исправления"],
            ["review", "На проверке"],
            ["closed", "Закрытые"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={status === value ? "selected" : ""}
              onClick={() => {
                setStatus(value);
                changeThread("");
              }}
            >
              {tr(label)}
            </button>
          ))}
          {(threadId || documentId) && (
            <button
              onClick={() => {
                changeThread("");
                setDocumentId("");
              }}
            >
              {tr("Весь чат")}
            </button>
          )}
        </div>
        {data && (
          <div className="chat-thread-list">
            {data.threads
              .filter(
                (t: Any) =>
                  (status === "all" || t.status === status) &&
                  (!documentId || t.document_id === documentId),
              )
              .map((t: Any) => (
                <button
                  className={
                    "chat-thread " + (threadId === t.id ? "selected" : "")
                  }
                  key={t.id}
                  onClick={() => changeThread(t.id)}
                >
                  <span translate="no">
                    {t.group_name} → {t.document_name}
                  </span>
                  <span className={"chat-state chat-state-" + t.status}>
                    {tr(chatStatus[t.status])}
                  </span>
                  <small>{t.assignee_name}</small>
                </button>
              ))}
          </div>
        )}
        {thread && (
          <div className="chat-issue-card">
            <strong translate="no">
              {thread.group_name} → {thread.document_name}
            </strong>
            <p>
              <span className={"chat-state chat-state-" + thread.status}>
                {tr(chatStatus[thread.status])}
              </span>{" "}
              · {thread.assignee_name}
              {thread.deadline && (
                <>
                  {" "}
                  · {tr("Срок")}:{" "}
                  {new Date(thread.deadline).toLocaleDateString()}
                </>
              )}
            </p>
            {fileButton({
              id: thread.version_id,
              filename: thread.filename,
              version: thread.version,
              scan_status: thread.scan_status,
              review_status: thread.review_status,
            })}
            {thread.latest_version_id &&
              fileButton({
                id: thread.latest_version_id,
                filename: thread.latest_filename,
                version: thread.latest_version,
                scan_status: thread.latest_scan_status,
                review_status: thread.latest_review_status,
              })}
            <button
              className="text-btn"
              onClick={() => onDocuments(thread.document_id)}
            >
              {tr("Перейти к полю загрузки")}
            </button>
            {isAdmin && thread.status === "review" && (
              <button
                className="primary"
                disabled={
                  busy ||
                  inspected !== thread.latest_version_id ||
                  thread.latest_scan_status !== "clean"
                }
                title={tr("Сначала откройте исправленный файл")}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await chatWrite("chat.resolve", {
                      case_id: caseId,
                      thread_id: thread.id,
                      version_id: thread.latest_version_id,
                      decision: "close",
                      request_id: crypto.randomUUID(),
                    });
                    await load();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {tr("Принять исправление")}
              </button>
            )}
          </div>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {tr(error)}
        </p>
      )}
      {!data ? (
        <p>{tr("Загрузка…")}</p>
      ) : (
        <div ref={list} className="chat-messages">
          {data.hasMore && (
            <button
              onClick={() => {
                history.current = true;
                void load(data.messages[0]?.id).catch((e) =>
                  setError(e.message),
                );
              }}
            >
              {tr("Показать предыдущие сообщения")}
            </button>
          )}
          {!data.messages.length && (
            <p className="muted">{tr("Сообщений пока нет")}</p>
          )}
          {data.messages.map((m: Any) => (
            <article
              id={"chat-message-" + m.id}
              data-message={m.id}
              data-unread={!m.is_read}
              key={m.id}
              className={
                "chat-message " +
                (m.author_id === actor.id ? "chat-own " : "") +
                (m.id === focusMessage ? "chat-focused" : "")
              }
            >
              <header>
                <strong>{m.author}</strong>
                <time>{new Date(m.created_at).toLocaleString()}</time>
                {!m.is_read && (
                  <span className="chat-unread">{tr("Новое")}</span>
                )}
              </header>
              {m.reply_to && (
                <blockquote>
                  <strong>{m.reply_author}</strong>
                  <p>{m.reply_body || (m.reply_image_id ? tr("Фото") : "")}</p>
                </blockquote>
              )}
              <p className="chat-body">
                {m.kind === "upload" || m.kind === "closed"
                  ? tr(m.body)
                  : m.body}
              </p>
              {m.image_id && <ChatPhoto id={m.image_id} />}
              {m.version_id &&
                fileButton({
                  id: m.version_id,
                  filename: m.filename,
                  version: m.version,
                  scan_status: m.scan_status,
                  review_status: m.review_status,
                })}
              {m.thread_id && (
                <button
                  className="text-btn"
                  onClick={() => changeThread(m.thread_id)}
                >
                  {tr("Открыть обсуждение")}
                </button>
              )}
              <button
                className="text-btn"
                onClick={() => {
                  changeThread(m.thread_id || "");
                  setReply(m);
                }}
              >
                {tr("Ответить")}
              </button>
            </article>
          ))}
        </div>
      )}
      <form
        className="chat-compose"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <PhotoDraft
          image={photo.image}
          onRemove={() => {
            photo.clear();
            request.current = crypto.randomUUID();
          }}
          disabled={busy}
        />
        {reply && (
          <div className="chat-compose-context">
            {tr("Ответ")}: {reply.author} — {reply.body.slice(0, 150)}{" "}
            <button type="button" onClick={() => setReply(null)}>
              ×
            </button>
          </div>
        )}
        {file && (
          <div className="chat-compose-context">
            <span translate="no">{file.filename}</span>
            <button
              type="button"
              onClick={() => {
                setFile(null);
                onAttachmentClear();
              }}
            >
              ×
            </button>
          </div>
        )}
        <label>
          {tr("Сообщение")}
          <textarea
            rows={3}
            onPaste={photo.paste}
            onKeyDown={submitChatOnEnter}
            disabled={busy}
            value={body}
            maxLength={10000}
            placeholder={tr("Напишите сообщение…")}
            onChange={(e) => {
              setBody(e.target.value);
              request.current = crypto.randomUUID();
            }}
          />
        </label>
        <small className="chat-send-hint">
          {tr("Ctrl+V — фото · Enter — отправить · Shift+Enter — новая строка")}
        </small>
        <div className="chat-compose-actions">
          <select
            aria-label={tr("Упомянуть сотрудника")}
            value=""
            disabled={busy}
            onChange={(e) => {
              const m = data?.members.find((m: Any) => m.id === e.target.value);
              if (m) {
                setMentions([...new Set([...mentions, m.id])]);
                setBody(body + "@" + m.name + " ");
              }
            }}
          >
            <option value="">{tr("@ Упомянуть")}</option>
            {data?.members
              .filter((m: Any) => m.id !== actor.id)
              .map((m: Any) => (
                <option value={m.id} key={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
          {canUpload && canDownload && (
            <label className="chat-attach">
              {tr("Прикрепить файл")}
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                disabled={busy}
                onChange={async (e) => {
                  const upload = e.target.files?.[0];
                  e.target.value = "";
                  if (!upload) return;
                  setBusy(true);
                  setError("");
                  try {
                    const f = new FormData();
                    f.set("case_id", caseId);
                    f.set("type", "Other");
                    f.set("file", upload);
                    const r = await fetch("/api/documents", {
                      method: "POST",
                      body: f,
                    });
                    const d = await r.json();
                    if (!r.ok) throw Error(d.error);
                    setFile({ ...d, filename: upload.name });
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </label>
          )}
          <button
            className="primary"
            disabled={busy || (!body.trim() && !file && !photo.image)}
          >
            {tr("Отправить")}
          </button>
          {isAdmin && thread && thread.status !== "open" && (
            <button
              type="button"
              disabled={busy || !body.trim()}
              onClick={() => void send("chat.resolve")}
            >
              {tr("Вернуть на доработку")}
            </button>
          )}
        </div>
      </form>
      {preview && (
        <FilePreview
          key={preview.id}
          file={
            preview as { id: string; filename: string; review_status: string }
          }
          isAdmin={false}
          onClose={() => setPreview(null)}
          onChanged={async () => {
            setInspected(preview.id);
            await load();
          }}
        />
      )}
    </section>
  );
}

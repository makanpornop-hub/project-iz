"use client";
import { useT } from "./language";
import { useEffect, useRef, useState } from "react";
import { X, Download, CheckCircle2 } from "lucide-react";
export const documentStatus: Record<string, string> = {
  Uploaded: "Новое",
  "Under review": "Рассматривается",
  Approved: "Подтверждено",
};
export default function FilePreview({
  file,
  isAdmin,
  onClose,
  onChanged,
  onIssue,
}: {
  file: { id: string; filename: string; review_status: string };
  isAdmin: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onIssue?: () => void;
}) {
  const tr = useT();

  const dialog = useRef<HTMLDialogElement>(null),
    opened = useRef(false);
  const [url, setUrl] = useState(""),
    [mime, setMime] = useState(""),
    [error, setError] = useState(""),
    [status, setStatus] = useState(file.review_status),
    [busy, setBusy] = useState(false),
    [viewed, setViewed] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
    const abort = new AbortController();
    let objectUrl = "";
    void (async () => {
      try {
        const r = await fetch("/api/documents/" + file.id, {
          signal: abort.signal,
          cache: "no-store",
        });
        if (!r.ok) {
          const result = await r.json();
          throw new Error(result.error || "Не удалось открыть файл");
        }
        const blob = await r.blob();
        if (!["application/pdf", "image/jpeg", "image/png"].includes(blob.type))
          throw new Error("Просмотр поддерживает PDF, JPG и PNG");
        if (abort.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setMime(blob.type);
        setUrl(objectUrl);
      } catch (e) {
        if (!abort.signal.aborted) setError((e as Error).message);
      }
    })();
    return () => {
      abort.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.id]);
  async function update(action: string) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/data/mutate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          data: {
            id: file.id,
            ...(action === "document.review" ? { status: "Approved" } : {}),
          },
        }),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error || "Не удалось сохранить статус");
      setStatus(
        action === "document.review" ? "Approved" : result.review_status,
      );
      setViewed(true);
      await onChanged();
      if (action === "document.review") onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function loaded() {
    if (opened.current) return;
    opened.current = true;
    void update("document.open");
  }
  return (
    <dialog
      ref={dialog}
      className="document-viewer"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <div>
          <strong>
            <span translate="no">{file.filename}</span>
          </strong>
          <span
            className={"document-status status-" + status.replaceAll(" ", "-")}
          >
            {tr(documentStatus[status] || status)}
          </span>
        </div>
        <button aria-label={tr("Закрыть просмотр")} onClick={onClose}>
          <X size={19} />
        </button>
      </header>
      {error && (
        <p className="error" role="alert">
          {tr(error)}
        </p>
      )}
      {!url && !error && <p>{tr("Загрузка файла…")}</p>}
      <div className="document-viewer-content">
        {url &&
          (mime === "application/pdf" ? (
            <iframe
              title={"Просмотр: " + file.filename}
              src={url}
              onLoad={loaded}
            />
          ) : (
            <img src={url} alt={file.filename} onLoad={loaded} />
          ))}
      </div>
      <footer>
        <a className="text-btn" href={"/api/documents/" + file.id}>
          <Download size={16} />
          {tr(" Скачать ")}
        </a>
        {error && url && (
          <button disabled={busy} onClick={() => update("document.open")}>
            {tr(" Повторить сохранение просмотра ")}
          </button>
        )}
        {isAdmin && onIssue && (
          <button disabled={busy} onClick={onIssue}>
            {tr("Указать ошибку")}
          </button>
        )}
        {isAdmin && (
          <button
            className="primary"
            disabled={!viewed || busy || status === "Approved"}
            onClick={() => update("document.review")}
          >
            <CheckCircle2 size={16} />
            {tr(
              status === "Approved" ? "Подтверждено" : "Подтвердить документ",
            )}
          </button>
        )}
        <button disabled={busy} onClick={onClose}>
          {tr(" Закрыть ")}
        </button>
      </footer>
    </dialog>
  );
}

"use client";
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { useT } from "./language";
type Draft = {
  file: File;
  url: string;
  requestId: string;
  uploadedId?: string;
};
export function submitChatOnEnter(e: KeyboardEvent<HTMLTextAreaElement>) {
  if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
  e.preventDefault();
  if (!e.repeat) e.currentTarget.form?.requestSubmit();
}
export function useClipboardPhoto(
  onError: (message: string) => void,
  disabled: boolean,
) {
  const [image, setImage] = useState<Draft | null>(null);
  const latest = useRef<Draft | null>(null);
  useEffect(
    () => () => {
      if (image) URL.revokeObjectURL(image.url);
    },
    [image],
  );
  const clear = () => {
    latest.current = null;
    setImage(null);
  };
  function paste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const item = Array.from(e.clipboardData.items).find(
      (i) => i.kind === "file" && i.type.startsWith("image/"),
    );
    if (!item) return;
    e.preventDefault();
    if (disabled) return;
    const file = item.getAsFile();
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      onError("Вставьте фото в формате PNG или JPG");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      onError("Выберите файл до 20 МБ");
      return;
    }
    const draft = {
      file,
      url: URL.createObjectURL(file),
      requestId: crypto.randomUUID(),
    };
    latest.current = draft;
    setImage(draft);
    onError("");
  }
  async function upload(target: { case_id?: string; room_id?: string }) {
    const draft = latest.current;
    if (!draft) return undefined;
    if (draft.uploadedId) return draft.uploadedId;
    const f = new FormData();
    for (const [key, value] of Object.entries(target))
      if (value) f.set(key, value);
    f.set("request_id", draft.requestId);
    f.set(
      "file",
      draft.file,
      "screenshot-" +
        draft.requestId +
        (draft.file.type === "image/jpeg" ? ".jpg" : ".png"),
    );
    const r = await fetch("/api/chat/images", { method: "POST", body: f });
    const d = await r.json();
    if (!r.ok)
      throw Error(d.error || "Не удалось загрузить фото. Попробуйте ещё раз.");
    draft.uploadedId = d.id;
    return d.id as string;
  }
  return { image, paste, clear, upload };
}
export function PhotoDraft({
  image,
  onRemove,
  disabled,
}: {
  image: Draft | null;
  onRemove: () => void;
  disabled: boolean;
}) {
  const tr = useT();
  if (!image) return null;
  return (
    <div className="chat-photo-draft">
      <img src={image.url} alt={tr("Скриншот перед отправкой")} />
      <span>{tr("Фото готово к отправке")}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={onRemove}
        aria-label={tr("Удалить фото")}
      >
        ×
      </button>
    </div>
  );
}
export function ChatPhoto({ id }: { id: string }) {
  const tr = useT(),
    dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false),
    [failed, setFailed] = useState(false);
  const url = "/api/chat/images/" + id;
  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);
  return (
    <>
      {failed ? (
        <p className="muted">{tr("Фото недоступно")}</p>
      ) : (
        <button
          type="button"
          className="chat-photo"
          onClick={() => setOpen(true)}
          aria-label={tr("Открыть фото")}
        >
          <img
            src={url}
            loading="lazy"
            alt={tr("Фото")}
            onError={() => setFailed(true)}
          />
        </button>
      )}
      {open && (
        <dialog
          className="chat-photo-viewer"
          ref={dialog}
          onCancel={(e) => {
            e.preventDefault();
            setOpen(false);
          }}
        >
          <header>
            <strong>{tr("Фото")}</strong>
            <button
              onClick={() => setOpen(false)}
              aria-label={tr("Закрыть просмотр")}
            >
              ×
            </button>
          </header>
          <img src={url} alt={tr("Фото")} />
          <a className="text-btn" href={url + "?download=1"}>
            {tr("Скачать")}
          </a>
        </dialog>
      )}
    </>
  );
}

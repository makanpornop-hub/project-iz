"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  MessageCircle,
  Users,
  UserRound,
  BriefcaseBusiness,
  Plus,
  ArrowLeft,
} from "lucide-react";
import { useT } from "./language";
import CaseChat, { chatWrite } from "./case-chat";
import {
  useClipboardPhoto,
  PhotoDraft,
  ChatPhoto,
  submitChatOnEnter,
} from "./chat-photo";
type Any = Record<string, any>;
const kindLabel: Record<string, string> = {
  direct: "Личный чат",
  group: "Групповой чат",
  case: "Визовое дело",
};
async function read(path: string) {
  const r = await fetch("/api/data/" + path, { cache: "no-store" }),
    d = await r.json();
  if (!r.ok) throw Error(d.error);
  return d;
}
function RoomEditor({
  kind,
  room,
  members = [],
  onClose,
  onSaved,
}: {
  kind: string;
  room?: Any;
  members?: Any[];
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const tr = useT(),
    dialog = useRef<HTMLDialogElement>(null),
    request = useRef(crypto.randomUUID());
  const [directory, setDirectory] = useState<Any[]>([]),
    [selected, setSelected] = useState<string[]>(
      members
        .filter((m) => m.active && m.id !== room?.owner_id)
        .map((m) => m.id),
    ),
    [title, setTitle] = useState(room?.title || ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [q, setQ] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
    let alive = true;
    read("chat-directory")
      .then((d) => {
        if (alive) setDirectory(d);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);
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
          try {
            const d = await chatWrite(room ? "room.update" : "room.create", {
              room_id: room?.id,
              kind,
              title,
              members: selected,
              request_id: request.current,
            });
            onSaved(d.id);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2>
          {tr(
            room
              ? "Настройки группы"
              : kind === "direct"
                ? "Новый личный чат"
                : "Создать группу",
          )}
        </h2>
        {kind === "group" && (
          <label>
            {tr("Название группы")}
            <input
              required
              maxLength={150}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </label>
        )}
        <label>
          {tr("Найти сотрудника")}
          <input value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="room-member-picker">
          {directory
            .filter((m) => m.name.toLowerCase().includes(q.toLowerCase()))
            .map((m) => (
              <label key={m.id}>
                <input
                  type={kind === "direct" ? "radio" : "checkbox"}
                  name="member"
                  checked={selected.includes(m.id)}
                  onChange={(e) =>
                    setSelected(
                      kind === "direct"
                        ? [m.id]
                        : e.target.checked
                          ? [...selected, m.id]
                          : selected.filter((id) => id !== m.id),
                    )
                  }
                />
                <span>{m.name}</span>
              </label>
            ))}
        </div>
        {!directory.length && (
          <p className="muted">{tr("Нет доступных сотрудников")}</p>
        )}
        {kind === "group" && (
          <p className="muted">
            {tr("Новые участники смогут видеть историю группы.")}
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {tr(error)}
          </p>
        )}
        <div className="row-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            {tr("Отмена")}
          </button>
          <button
            className="primary"
            disabled={busy || (!room && !selected.length)}
          >
            {tr(
              room
                ? "Сохранить"
                : kind === "direct"
                  ? "Открыть чат"
                  : "Создать группу",
            )}
          </button>
        </div>
      </form>
    </dialog>
  );
}
function RoomView({
  id,
  actor,
  focusMessage,
  onBack,
  onChange,
}: {
  id: string;
  actor: Any;
  focusMessage?: string;
  onBack: () => void;
  onChange: () => void;
}) {
  const tr = useT();
  const [data, setData] = useState<Any | null>(null),
    [body, setBody] = useState(""),
    [reply, setReply] = useState<Any | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [edit, setEdit] = useState(false),
    [anchor, setAnchor] = useState(focusMessage || "");
  const request = useRef(crypto.randomUUID()),
    list = useRef<HTMLDivElement>(null),
    history = useRef(false),
    active = useRef(true);
  const photo = useClipboardPhoto(setError, busy);
  const sending = useRef(false);
  const loadSequence = useRef(0);
  const changed = useRef(onChange);
  changed.current = onChange;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const load = useCallback(
    async (before?: string) => {
      const seq = ++loadSequence.current;
      const d = await read(
        "room?id=" +
          id +
          (anchor ? "&focus=" + anchor : "") +
          (before ? "&before=" + before : ""),
      );
      if (active.current && seq === loadSequence.current) {
        setError("");
        setData((old: Any) =>
          before && old
            ? { ...d, messages: [...d.messages, ...old.messages] }
            : d,
        );
      }
    },
    [id, anchor],
  );
  useEffect(() => {
    setAnchor(focusMessage || "");
  }, [focusMessage]);
  useEffect(() => {
    history.current = false;
    void load().catch((e) => {
      if (active.current) {
        setData(null);
        setError(e.message);
      }
    });
    const t = setInterval(() => {
      if (!document.hidden && !history.current)
        void load().catch((e) => {
          if (active.current) {
            setData(null);
            setError(e.message);
          }
        });
    }, 5000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (!data || document.hidden) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const ids = entries
          .filter((e) => e.isIntersecting)
          .map((e) => (e.target as HTMLElement).dataset.message!);
        if (!ids.length) return;
        entries
          .filter((e) => e.isIntersecting)
          .forEach((e) => obs.unobserve(e.target));
        void chatWrite("room.read", { room_id: id, ids })
          .then(() => {
            if (!active.current) return;
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
            changed.current();
          })
          .catch(() => {});
      },
      { threshold: 0.3 },
    );
    list.current
      ?.querySelectorAll('[data-unread="true"]')
      .forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [data, id]);
  useEffect(() => {
    if (data && focusMessage)
      document
        .getElementById("room-message-" + focusMessage)
        ?.scrollIntoView({ block: "center" });
  }, [!!data, focusMessage]);
  useEffect(() => {
    if (data && !focusMessage && !history.current)
      list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [!!data]);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (sending.current || busy || (!body.trim() && !photo.image)) return;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const imageId = await photo.upload({ room_id: id });
      await chatWrite("room.send", {
        room_id: id,
        image_id: imageId,
        body,
        reply_to: reply?.id,
        request_id: request.current,
      });
      request.current = crypto.randomUUID();
      setBody("");
      photo.clear();
      setReply(null);
      history.current = false;
      setAnchor("");
      await load();
      requestAnimationFrame(() =>
        list.current?.scrollTo({
          top: list.current.scrollHeight,
          behavior: "smooth",
        }),
      );
      changed.current();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="panel padded room-conversation">
      <button className="text-btn room-back" onClick={onBack}>
        <ArrowLeft size={16} />
        {tr("Все чаты")}
      </button>
      {error && (
        <p className="error" role="alert">
          {tr(error)}
        </p>
      )}
      {data && (
        <>
          <header className="chat-heading">
            <div>
              <h2>{data.room.title}</h2>
              <p className="muted">
                {tr(kindLabel[data.room.kind])} ·{" "}
                {data.members
                  .map(
                    (m: Any) =>
                      m.name + (m.active ? "" : " (" + tr("Неактивен") + ")"),
                  )
                  .join(", ")}
              </p>
            </div>
            {data.room.kind === "group" && data.room.owner_id === actor.id && (
              <button onClick={() => setEdit(true)}>
                {tr("Настройки группы")}
              </button>
            )}
          </header>
          {anchor && (
            <button
              onClick={() => {
                setAnchor("");
                history.current = false;
              }}
            >
              {tr("Последние сообщения")}
            </button>
          )}
          <div className="chat-messages" ref={list}>
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
                id={"room-message-" + m.id}
                data-message={m.id}
                data-unread={!m.is_read}
                key={m.id}
                className={
                  "chat-message " +
                  (m.author_id === actor.id ? "chat-own " : "") +
                  (focusMessage === m.id ? "chat-focused" : "")
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
                    <p>
                      {m.reply_body || (m.reply_image_id ? tr("Фото") : "")}
                    </p>
                  </blockquote>
                )}
                {m.body && <p className="chat-body">{m.body}</p>}
                {m.image_id && <ChatPhoto id={m.image_id} />}
                <button className="text-btn" onClick={() => setReply(m)}>
                  {tr("Ответить")}
                </button>
              </article>
            ))}
          </div>
          <form className="chat-compose" onSubmit={send}>
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
            <label>
              {tr("Сообщение")}
              <textarea
                rows={3}
                onPaste={photo.paste}
                onKeyDown={submitChatOnEnter}
                disabled={busy}
                maxLength={10000}
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                  request.current = crypto.randomUUID();
                }}
                placeholder={tr("Напишите сообщение…")}
                required={!photo.image}
              />
            </label>
            <small className="chat-send-hint">
              {tr(
                "Ctrl+V — фото · Enter — отправить · Shift+Enter — новая строка",
              )}
            </small>
            <button
              className="primary"
              disabled={busy || (!body.trim() && !photo.image)}
            >
              {tr("Отправить")}
            </button>
          </form>
          {edit && (
            <RoomEditor
              kind="group"
              room={data.room}
              members={data.members}
              onClose={() => setEdit(false)}
              onSaved={() => {
                setEdit(false);
                void load();
                changed.current();
              }}
            />
          )}
        </>
      )}
    </section>
  );
}
export default function ChatHub({
  actor,
  initialData,
}: {
  actor: Any;
  initialData: Any;
}) {
  const tr = useT(),
    router = useRouter();
  const [data, setData] = useState<Any>(initialData),
    [q, setQ] = useState(""),
    [kind, setKind] = useState("all"),
    [loading, setLoading] = useState(false),
    [revision, setRevision] = useState(0),
    [error, setError] = useState(""),
    [creating, setCreating] = useState(""),
    [selected, setSelected] = useState<Any | null>(null);
  const items = useRef<HTMLDivElement>(null),
    sentinel = useRef<HTMLDivElement>(null),
    latest = useRef<Any>(initialData),
    session = useRef({ busy: false });
  const load = useCallback(
    async (append = false) => {
      const current = session.current;
      if (current.busy || (append && !latest.current?.nextCursor)) return;
      current.busy = true;
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ q, kind });
        if (append) params.set("after", latest.current.nextCursor);
        const d = await read("chats?" + params);
        if (current !== session.current) return;
        if (append) {
          const known = new Set(
            latest.current.chats.map((c: Any) => c.kind + c.id),
          );
          d.chats = [
            ...latest.current.chats,
            ...d.chats.filter((c: Any) => !known.has(c.kind + c.id)),
          ];
        }
        latest.current = d;
        setData(d);
      } catch (e) {
        if (current === session.current) setError((e as Error).message);
      } finally {
        if (current === session.current) {
          current.busy = false;
          setLoading(false);
        }
      }
    },
    [q, kind],
  );
  useEffect(() => {
    session.current = { busy: false };
    latest.current = { chats: [], nextCursor: null };
    setData(latest.current);
    setError("");
    setLoading(true);
    items.current?.scrollTo({ top: 0 });
    const delay = setTimeout(() => void load(), 200);
    const timer = setInterval(() => {
      // Refresh at the top; never replace the list while someone is reading further down.
      if (
        !document.hidden &&
        items.current?.clientHeight &&
        items.current.scrollTop < 24
      )
        void load();
    }, 5000);
    return () => {
      clearTimeout(delay);
      clearInterval(timer);
      session.current = { busy: false };
    };
  }, [load, revision]);
  useEffect(() => {
    if (!data?.nextCursor || loading || error || !sentinel.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void load(true);
      },
      { root: items.current, rootMargin: "0px 0px 200px 0px" },
    );
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [data?.nextCursor, loading, error, load, selected]);
  useEffect(() => {
    const follow = () => {
      const p = new URLSearchParams(location.hash.slice(1));
      const room = p.get("room"),
        caseId = p.get("case");
      if (room)
        setSelected({
          id: room,
          kind: "room",
          message: p.get("message") || undefined,
        });
      else if (caseId) setSelected({ id: caseId, kind: "case" });
      else setSelected(null);
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);
  function select(chat: Any) {
    setSelected(chat);
    window.location.hash = (chat.kind === "case" ? "case=" : "room=") + chat.id;
  }
  function back() {
    setSelected(null);
    window.location.hash = "";
  }
  return (
    <div className={"chat-hub " + (selected ? "has-conversation" : "")}>
      <aside className="panel chat-hub-list">
        <header>
          <h2>{tr("Все чаты")}</h2>
          <div className="chat-hub-new">
            <button onClick={() => setCreating("direct")}>
              <Plus size={15} />
              {tr("Личный")}
            </button>
            <button onClick={() => setCreating("group")}>
              <Users size={15} />
              {tr("Группа")}
            </button>
          </div>
        </header>
        <label className="chat-hub-search">
          {tr("Поиск чата")}
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
            }}
            placeholder={tr("Имя, группа или клиент")}
          />
        </label>
        <div className="chat-hub-filters">
          {[
            ["all", "Все"],
            ["direct", "Личные"],
            ["group", "Группы"],
            ["case", "Дела"],
          ].map(([v, l]) => (
            <button
              key={v}
              className={kind === v ? "selected" : ""}
              onClick={() => {
                setKind(v);
              }}
            >
              {tr(l)}
            </button>
          ))}
        </div>
        {error && (
          <p className="error" role="alert">
            {tr(error)}
          </p>
        )}
        <div
          className="chat-hub-items"
          ref={items}
          tabIndex={0}
          aria-label={tr("Все чаты")}
          aria-busy={loading}
        >
          {data?.chats?.map((chat: Any) => {
            const Icon =
              chat.kind === "direct"
                ? UserRound
                : chat.kind === "group"
                  ? Users
                  : BriefcaseBusiness;
            return (
              <button
                className={
                  "chat-hub-item " +
                  (selected?.id === chat.id ? "selected" : "")
                }
                key={chat.kind + chat.id}
                onClick={() => select(chat)}
              >
                <span className="chat-hub-avatar">
                  <Icon size={20} />
                </span>
                <span className="chat-hub-item-body">
                  <strong>{chat.title}</strong>
                  <small>{tr(kindLabel[chat.kind])}</small>
                  <span>
                    {chat.last_message === "Фото"
                      ? tr("Фото")
                      : chat.last_message || tr("Сообщений пока нет")}
                  </span>
                </span>
                <span className="chat-hub-item-meta">
                  <time>{new Date(chat.updated_at).toLocaleDateString()}</time>
                  {chat.unread > 0 && (
                    <b className="chat-tab-count">{chat.unread}</b>
                  )}
                </span>
              </button>
            );
          })}
          {!data?.chats?.length && !loading && !error && (
            <p className="muted chat-hub-empty">{tr("Чаты не найдены")}</p>
          )}
          <div ref={sentinel} className="chat-hub-sentinel">
            {loading && <p role="status">{tr("Загрузка…")}</p>}
            {error && (
              <button onClick={() => void load(!!data?.nextCursor)}>
                {tr("Повторить")}
              </button>
            )}
          </div>
        </div>
      </aside>
      <div className="chat-hub-content">
        {!selected ? (
          <section className="panel padded chat-hub-welcome">
            <MessageCircle size={44} />
            <h2>{tr("Выберите чат")}</h2>
            <p>{tr("Откройте переписку слева или начните новый чат.")}</p>
          </section>
        ) : selected.kind === "case" ? (
          <div className="chat-hub-case" key={selected.id}>
            <div className="chat-hub-case-links">
              <button className="text-btn" onClick={back}>
                <ArrowLeft size={16} />
                {tr("Все чаты")}
              </button>
              <Link href={"/cases/" + selected.id}>{tr("Открыть дело")}</Link>
            </div>
            <CaseChat
              caseId={selected.id}
              actor={actor}
              onAttachmentClear={() => {}}
              onCount={() => {}}
              onDocuments={(doc) =>
                router.push("/cases/" + selected.id + "#all?document=" + doc)
              }
            />
          </div>
        ) : (
          <RoomView
            key={selected.id}
            id={selected.id}
            actor={actor}
            focusMessage={selected.message}
            onBack={back}
            onChange={() => {
              if ((items.current?.scrollTop || 0) < 24) void load();
            }}
          />
        )}
      </div>
      {creating && (
        <RoomEditor
          kind={creating}
          onClose={() => setCreating("")}
          onSaved={(id) => {
            setCreating("");
            setKind("all");
            setQ("");
            select({ id, kind: "room" });
            setRevision((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}

"use client";
import { useT } from "./language";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Plus, Pencil, Users, MapPin, Phone, Mail } from "lucide-react";
type Partner = {
  id: string;
  group_id: string;
  name: string;
  phone: string;
  email: string;
  country: string;
  city: string;
  notes: string;
};
type Group = { id: string; name: string; partners: Partner[] };
type Editor =
  | { kind: "group"; id?: string; name?: string }
  | {
      kind: "partner";
      group_id: string;
      id?: string;
      name?: string;
      phone?: string;
      email?: string;
      country?: string;
      city?: string;
      notes?: string;
    };
export default function Partners({
  groups,
  canEdit,
  onRefresh,
}: {
  groups: Group[];
  canEdit: boolean;
  onRefresh: () => Promise<void>;
}) {
  const tr = useT();

  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (editor) {
      form.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      form.current?.querySelector<HTMLInputElement>("input")?.focus();
    }
  }, [editor]);
  function open(value: Editor) {
    setError("");
    setEditor(value);
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editor || busy) return;
    const values = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/data/partners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action:
            editor.kind === "group" ? "partner-group.save" : "partner.save",
          data: { ...values, ...(editor.id ? { id: editor.id } : {}) },
        }),
      });
      const result = await r.json();
      if (!r.ok)
        throw new Error(result.error || "Не удалось сохранить изменения");
      setEditor(null);
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="partners-section">
      <div className="partners-toolbar">
        <p>
          {tr(
            groups.length
              ? "Контакты и заметки, объединённые по группам."
              : "Создайте первую группу, затем добавьте в неё партнёров.",
          )}
        </p>
        {canEdit && (
          <button
            className="primary"
            disabled={busy}
            onClick={() => open({ kind: "group" })}
          >
            <Plus size={16} />
            {tr(" Новая группа ")}
          </button>
        )}
      </div>
      {editor && (
        <form
          ref={form}
          key={
            editor.kind +
            (editor.id || "new") +
            ("group_id" in editor ? editor.group_id : "")
          }
          className="panel padded partners-editor"
          onSubmit={save}
        >
          <h2>
            {tr(
              editor.kind === "group"
                ? editor.id
                  ? "Изменить группу"
                  : "Новая группа партнёров"
                : editor.id
                  ? "Изменить партнёра"
                  : "Новый партнёр",
            )}
          </h2>
          <fieldset disabled={busy}>
            <label>
              {tr(editor.kind === "group" ? "Название группы" : "Имя партнёра")}
              <input
                name="name"
                required
                maxLength={250}
                defaultValue={editor.name || ""}
              />
            </label>
            {editor.kind === "partner" && (
              <>
                <label>
                  {tr(" Группа партнёров ")}
                  <select
                    name="group_id"
                    required
                    defaultValue={editor.group_id}
                  >
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="partners-fields">
                  <label>
                    {tr(" Номер телефона ")}
                    <input
                      type="tel"
                      name="phone"
                      maxLength={60}
                      defaultValue={editor.phone || ""}
                    />
                  </label>
                  <label>
                    {tr(" Эмэйл ")}
                    <input
                      type="email"
                      name="email"
                      maxLength={254}
                      defaultValue={editor.email || ""}
                    />
                  </label>
                  <label>
                    {tr(" Страна ")}
                    <input
                      name="country"
                      maxLength={120}
                      defaultValue={editor.country || ""}
                    />
                  </label>
                  <label>
                    {tr(" Город ")}
                    <input
                      name="city"
                      maxLength={120}
                      defaultValue={editor.city || ""}
                    />
                  </label>
                </div>
                <label>
                  {tr(" Заметки ")}
                  <textarea
                    name="notes"
                    rows={4}
                    maxLength={10000}
                    defaultValue={editor.notes || ""}
                  />
                </label>
              </>
            )}
          </fieldset>
          {error && (
            <p className="error" role="alert">
              {tr(error)}
            </p>
          )}
          <div className="partners-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setEditor(null);
                setError("");
              }}
            >
              {tr(" Отмена ")}
            </button>
            <button type="submit" className="primary" disabled={busy}>
              {tr(busy ? "Сохранение…" : "Сохранить")}
            </button>
          </div>
        </form>
      )}
      {!groups.length && !editor && (
        <section className="panel empty">
          <Users size={36} />
          <h3>{tr("Групп партнёров пока нет")}</h3>
          <p>
            {tr(
              canEdit
                ? "Нажмите «Новая группа», чтобы добавить контакты."
                : "Группы появятся после добавления администратором или менеджером.",
            )}
          </p>
        </section>
      )}
      {groups.map((group) => (
        <section className="panel padded partner-group" key={group.id}>
          <header className="partner-group-header">
            <div>
              <h2>{group.name}</h2>
              <span className="muted">
                {tr("Партнёров: ")}
                {tr(group.partners.length)}
              </span>
            </div>
            {canEdit && (
              <div className="partners-actions">
                <button
                  disabled={busy}
                  aria-label={"Изменить группу " + group.name}
                  onClick={() =>
                    open({ kind: "group", id: group.id, name: group.name })
                  }
                >
                  <Pencil size={15} />
                  {tr(" Изменить группу ")}
                </button>
                <button
                  disabled={busy}
                  className="primary"
                  onClick={() => open({ kind: "partner", group_id: group.id })}
                >
                  <Plus size={16} />
                  {tr(" Добавить партнёра ")}
                </button>
              </div>
            )}
          </header>
          {!group.partners.length ? (
            <p className="partner-empty">
              {tr("В этой группе пока нет партнёров.")}
            </p>
          ) : (
            <div className="partner-grid">
              {group.partners.map((partner) => (
                <article className="partner-card" key={partner.id}>
                  <div className="partner-card-heading">
                    <h3>{partner.name}</h3>
                    {canEdit && (
                      <button
                        disabled={busy}
                        aria-label={"Редактировать партнёра " + partner.name}
                        onClick={() => open({ ...partner, kind: "partner" })}
                      >
                        <Pencil size={15} />
                        {tr(" Редактировать ")}
                      </button>
                    )}
                  </div>
                  <dl>
                    <div>
                      <dt>
                        <Phone size={14} />
                        {tr(" Телефон ")}
                      </dt>
                      <dd>{partner.phone || "Не указан"}</dd>
                    </div>
                    <div>
                      <dt>
                        <Mail size={14} />
                        {tr(" Эмэйл ")}
                      </dt>
                      <dd>{partner.email || "Не указан"}</dd>
                    </div>
                    <div>
                      <dt>
                        <MapPin size={14} />
                        {tr(" Страна и город ")}
                      </dt>
                      <dd>
                        {[partner.country, partner.city]
                          .filter(Boolean)
                          .join(", ") || "Не указаны"}
                      </dd>
                    </div>
                  </dl>
                  <div className="partner-notes">
                    <span>{tr("Заметки")}</span>
                    <p>{tr(partner.notes || "Нет заметок")}</p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

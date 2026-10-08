"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useT } from "./language";
type Any = Record<string, any>;
const destinations = [
  [
    "workflowChatId",
    "ZIP документов",
    "Архивы после кнопки «Готово» в перечне документов.",
  ],
  [
    "backupChatId",
    "Резервные копии документов",
    "Копии отдельных загруженных документов.",
  ],
  ["teamChatId", "События команды", "Краткие сообщения о задачах и сроках."],
  [
    "financeChatId",
    "Бухгалтерские уведомления",
    "Просроченная оплата и превышение расходов.",
  ],
] as const;
export default function TelegramSettings({
  value,
  onRefresh,
}: {
  value: Any;
  onRefresh: () => Promise<void>;
}) {
  const tr = useT(),
    [form, setForm] = useState<Any>({
      ...value.destinations,
      backupEnabled: value.backupEnabled,
      teamEnabled: value.teamEnabled,
    }),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [newId, setNewId] = useState(""),
    [checkingId, setCheckingId] = useState(""),
    [chatChecks, setChatChecks] = useState<
      Record<string, { title?: string; error?: string }>
    >({});
  useEffect(() => {
    setForm({
      ...value.destinations,
      backupEnabled: value.backupEnabled,
      teamEnabled: value.teamEnabled,
    });
  }, [value.destinations.revision]);
  const change = (name: string, v: string | boolean) => {
    setForm((old: Any) => ({ ...old, [name]: v }));
    setMessage("");
    setError("");
  };
  async function action(name: string, data: Any) {
    const r = await fetch("/api/data/mutate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: name, data }),
      }),
      result = await r.json();
    if (!r.ok) throw Error(result.error);
    return result;
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action("telegram-settings.save", form);
      await onRefresh();
      setMessage("Telegram-настройки сохранены");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function check(id: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    setCheckingId(id);
    setChatChecks((old) => ({ ...old, [id]: {} }));
    try {
      const result = await action("telegram-settings.check", { chat_id: id });
      await onRefresh();
      setChatChecks((old) => ({ ...old, [id]: { title: result.title || id } }));
      if (newId === id) setNewId("");
    } catch (e) {
      setChatChecks((old) => ({
        ...old,
        [id]: { error: (e as Error).message },
      }));
    } finally {
      setCheckingId("");
      setBusy(false);
    }
  }
  function checkFeedback(id: string) {
    const result = chatChecks[id];
    if (checkingId === id)
      return (
        <p className="muted telegram-check-result" role="status">
          {tr("Получаем данные из Telegram…")}
        </p>
      );
    if (result?.error)
      return (
        <p className="error telegram-check-result" role="alert">
          {tr(result.error)}
        </p>
      );
    if (result?.title)
      return (
        <p className="telegram-check-result" role="status">
          {tr("Чат доступен:")} <strong translate="no">{result.title}</strong>
        </p>
      );
    return null;
  }
  return (
    <div className="telegram-settings">
      <Link href="/settings" className="text-btn settings-back">
        {tr("Вернуться в настройки")}
      </Link>
      {error && (
        <p role="alert" className="error">
          {tr(error)}
        </p>
      )}
      {message && (
        <p role="status" className="notice">
          {tr(message)}
        </p>
      )}
      <section className="panel padded">
        <h2>{tr("Назначения Telegram-чатов")}</h2>
        <p>
          {tr(
            "Измените Chat ID групп и каналов. Настройки применяются без перезапуска сайта и бота.",
          )}
        </p>
        {!value.botConfigured && (
          <p className="notice">{tr("Telegram-бот ещё не настроен")}</p>
        )}
        <form onSubmit={save}>
          <fieldset disabled={busy} className="telegram-destinations">
            {destinations.map(([key, title, description]) => (
              <div className="telegram-destination" key={key}>
                <h3>{tr(title)}</h3>
                <p className="muted">{tr(description)}</p>
                <label>
                  {tr("Chat ID")} · {tr(title)}
                  <input
                    value={form[key] || ""}
                    onChange={(e) => change(key, e.target.value)}
                    type="text"
                    list="known-telegram-chats"
                    pattern="-[1-9][0-9]{0,15}"
                    required={
                      key === "workflowChatId" ||
                      (key === "backupChatId" && form.backupEnabled) ||
                      (key === "teamChatId" && form.teamEnabled)
                    }
                    maxLength={17}
                    placeholder="-100…"
                    autoComplete="off"
                  />
                </label>
                {(key === "backupChatId" || key === "teamChatId") && (
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={
                        key === "backupChatId"
                          ? form.backupEnabled
                          : form.teamEnabled
                      }
                      onChange={(e) =>
                        change(
                          key === "backupChatId"
                            ? "backupEnabled"
                            : "teamEnabled",
                          e.target.checked,
                        )
                      }
                    />
                    {tr(
                      key === "backupChatId"
                        ? "Отправлять резервные копии"
                        : "Отправлять события команды",
                    )}
                  </label>
                )}
                {key === "backupChatId" && (
                  <small className="muted">
                    {tr(
                      "Копии документов доступны участникам выбранного Telegram-чата.",
                    )}
                  </small>
                )}
              </div>
            ))}
          </fieldset>
          <datalist id="known-telegram-chats">
            {value.catalog.map((c: Any) => (
              <option key={c.chat_id} value={c.chat_id}>
                {c.title || tr("Название пока неизвестно")}
              </option>
            ))}
          </datalist>
          <p className="muted">
            {tr(
              "Новое назначение ZIP действует для новых архивов. Уже созданные ZIP сохраняют первоначальный чат отправки.",
            )}
          </p>
          <button className="primary" disabled={busy}>
            {tr(
              busy && !checkingId
                ? "Сохранение…"
                : "Сохранить Telegram-настройки",
            )}
          </button>
        </form>
      </section>
      <section className="panel padded telegram-catalog">
        <h2>{tr("Группы и каналы бота")}</h2>
        <p>
          {tr(
            "Здесь показаны настроенные чаты и группы или каналы, из которых бот получил события. Личные чаты сотрудников настраиваются в их профилях.",
          )}
        </p>
        <form
          className="telegram-add-chat"
          onSubmit={(e) => {
            e.preventDefault();
            void check(newId);
          }}
        >
          <label>
            {tr("Chat ID новой группы или канала")}
            <input
              required
              pattern="-[1-9][0-9]{0,15}"
              maxLength={17}
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              placeholder="-100…"
              disabled={busy}
            />
          </label>
          <button disabled={busy || !value.botConfigured}>
            {tr(
              checkingId && checkingId === newId
                ? "Проверка…"
                : "Добавить / проверить чат",
            )}
          </button>
        </form>
        {Object.keys(chatChecks)
          .filter((id) => !value.catalog.some((c: Any) => c.chat_id === id))
          .map((id) => (
            <div key={id}>{checkFeedback(id)}</div>
          ))}
        <p className="muted">
          {tr(
            "Проверка получает название чата из Telegram. Сообщения и документы при проверке не отправляются.",
          )}
        </p>
        <div className="telegram-table-wrap">
          <table>
            <thead>
              <tr>
                <th>{tr("Название")}</th>
                <th>{tr("Тип")}</th>
                <th>{tr("Chat ID")}</th>
                <th>{tr("Действия")}</th>
              </tr>
            </thead>
            <tbody>
              {value.catalog.map((c: Any) => (
                <tr key={c.chat_id}>
                  <td>
                    <strong translate="no">
                      {c.title || tr("Название пока неизвестно")}
                    </strong>
                    {c.username && <small translate="no">@{c.username}</small>}
                  </td>
                  <td>
                    {tr(
                      c.type === "channel"
                        ? "Канал"
                        : c.type === "unknown"
                          ? "Не определён"
                          : "Группа",
                    )}
                  </td>
                  <td>
                    <code translate="no">{c.chat_id}</code>
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => check(c.chat_id)}
                      disabled={busy || !value.botConfigured}
                    >
                      {tr(
                        checkingId === c.chat_id
                          ? "Проверка…"
                          : "Проверить чат",
                      )}
                    </button>
                    {checkFeedback(c.chat_id)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!value.catalog.length && (
          <p>{tr("Пока нет известных групп и каналов")}</p>
        )}
      </section>
    </div>
  );
}

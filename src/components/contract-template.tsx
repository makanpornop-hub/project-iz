"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useT } from "./language";
const tokens = [
  ["{{CLIENT_NAME}}", "ФИО клиента"],
  ["{{DATE}}", "Дата создания договора"],
  ["{{TOTAL_AMOUNT}}", "Договорённая сумма"],
  ["{{INITIAL_PAYMENT}}", "Первичный взнос"],
  ["{{CURRENCY}}", "Валюта договора"],
];
export default function ContractTemplate() {
  const tr = useT(),
    [template, setTemplate] = useState<Record<string, any> | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    fetch("/api/contracts", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setTemplate(d);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const body = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const r = await fetch("/api/contracts", { method: "POST", body });
      const result = await r.json();
      if (!r.ok) throw Error(result.error);
      setTemplate(result);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel padded contract-template">
      <h2>{tr("Шаблон договора DOCX")}</h2>
      <p>
        {tr(
          "Добавьте эти метки в свой договор в Word. При создании дела они заменятся данными клиента, датой и суммами.",
        )}
      </p>
      <table>
        <tbody>
          {tokens.map(([token, label]) => (
            <tr key={token}>
              <td>
                <code translate="no">{token}</code>
              </td>
              <td>{tr(label)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">
        {tr(
          "Метки можно использовать несколько раз, в том числе в колонтитулах. Форматирование документа сохраняется.",
        )}
      </p>
      {loading ? (
        <p>{tr("Загрузка…")}</p>
      ) : template ? (
        <p>
          {tr("Текущий шаблон:")}{" "}
          <span translate="no">{template.filename}</span> ·{" "}
          <a href="/api/contracts?download=template">{tr("Скачать шаблон")}</a>
        </p>
      ) : (
        <p>{tr("Шаблон ещё не загружен")}</p>
      )}
      {error && (
        <p className="error" role="alert">
          {tr(error)}
        </p>
      )}
      {saved && (
        <p className="notice" role="status">
          {tr("Шаблон импортирован")}
        </p>
      )}
      <form onSubmit={upload}>
        <label>
          {tr("Импорт шаблона")}
          <input
            type="file"
            name="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            required
            disabled={busy}
          />
        </label>
        <small>{tr("DOCX до 5 МБ. Обязательны все пять меток.")}</small>
        <button disabled={busy} className="primary">
          {tr(busy ? "Проверка шаблона…" : "Импортировать шаблон")}
        </button>
      </form>
    </section>
  );
}

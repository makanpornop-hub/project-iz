"use client";
import { useState, useEffect } from "react";
import { useT } from "./language";
import { cents } from "@/lib/accounting-domain";
import { paymentMethods } from "@/lib/accounting-domain";
type Any = Record<string, any>;
export default function NewCaseFinance({
  clientName,
  canPay,
  canDownload,
  requiredFields,
  onReady,
  onBusy,
}: {
  clientName: string;
  timezone: string;
  canPay: boolean;
  canDownload: boolean;
  requiredFields: string[];
  onReady: (v: boolean) => void;
  onBusy: (v: boolean) => void;
}) {
  const tr = useT();
  const [f, setF] = useState({
    currency: "UZS",
    contract_amount: "",
    initial_payment: "",
    payment_deadline: "",
    method: "CASH",
  });
  const [template, setTemplate] = useState<Any | null>(null),
    [templateLoading, setTemplateLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/contracts", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setTemplate(d);
      })
      .catch((e) => setError(e.message))
      .finally(() => setTemplateLoading(false));
  }, []);
  useEffect(() => {
    onReady(!!template);
  }, [template, onReady]);
  const [previewCreated, setPreviewCreated] = useState(false);
  useEffect(() => setPreviewCreated(false), [clientName]);
  const field =
    (key: keyof typeof f) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setF((previous) => ({ ...previous, [key]: e.target.value }));
      setPreviewCreated(false);
      setError("");
    };
  let full = false,
    over = false;
  try {
    full =
      !!f.contract_amount &&
      cents(f.initial_payment || "0") >= cents(f.contract_amount);
    over =
      !!f.contract_amount &&
      cents(f.initial_payment || "0") > cents(f.contract_amount);
  } catch {}
  async function generate(e: React.MouseEvent<HTMLButtonElement>) {
    if (busy) return;
    const form = e.currentTarget.closest("form");
    const data = new FormData(form || undefined);
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      const r = await fetch("/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: clientName,
          client_id: String(data.get("client_id") || ""),
          finance: { ...f, payment_deadline: full ? "" : f.payment_deadline },
        }),
      });
      if (!r.ok) {
        const result = await r.json();
        throw Error(result.error);
      }
      const blob = await r.blob(),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = "Договор — " + clientName + ".docx";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setPreviewCreated(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <fieldset className="new-case-finance">
      <legend>{tr("Бухгалтерия и договор")}</legend>
      <p className="notice">
        {tr(
          "Договор создастся автоматически при сохранении дела. Начальный статус: «Подписывается договор».",
        )}
      </p>
      <label>
        {tr("Валюта договора")}
        <select
          name="contract_currency"
          value={f.currency}
          onChange={field("currency")}
        >
          <option value="UZS">UZS · {tr("Сум")}</option>
          <option value="USD">USD · {tr("Доллар")}</option>
          <option value="EUR">EUR · {tr("Евро")}</option>
        </select>
      </label>
      <label>
        {tr("Договорённая сумма")}
        <input
          name="contract_amount"
          type="number"
          min="0.01"
          step="0.01"
          inputMode="decimal"
          required
          value={f.contract_amount}
          onChange={field("contract_amount")}
        />
      </label>
      <label>
        {tr("Первичный взнос")}
        <input
          name="initial_payment"
          type="number"
          min={requiredFields.includes("initial_payment") ? "0.01" : "0"}
          max={f.contract_amount || undefined}
          step="0.01"
          inputMode="decimal"
          disabled={!canPay}
          required={requiredFields.includes("initial_payment")}
          value={f.initial_payment}
          onChange={field("initial_payment")}
        />
      </label>
      {!!f.initial_payment && canPay && (
        <label>
          {tr("Способ оплаты")}
          <select
            name="initial_method"
            value={f.method}
            onChange={field("method")}
          >
            {Object.entries(paymentMethods).map(([v, l]) => (
              <option key={v} value={v}>
                {tr(l)}
              </option>
            ))}
          </select>
        </label>
      )}
      {!full && (
        <label>
          {tr("Дедлайн оплаты остатка")}
          <input
            name="payment_deadline"
            type="date"
            required={requiredFields.includes("payment_deadline")}
            value={f.payment_deadline}
            onChange={field("payment_deadline")}
          />
        </label>
      )}
      {full && !over && (
        <p className="notice">
          {tr("Полная оплата: дедлайн остатка не требуется")}
        </p>
      )}
      {over && (
        <p className="error">
          {tr("Первичный взнос не может превышать договорённую сумму")}
        </p>
      )}
      <p className="muted">
        {tr(
          "Условия оплаты сохранятся вместе с делом. Срок визового дела указан отдельно выше.",
        )}
      </p>
      {templateLoading ? (
        <p>{tr("Загрузка шаблона…")}</p>
      ) : !template ? (
        <p className="muted">
          {tr(
            "Для создания договора администратор должен импортировать DOCX в настройках.",
          )}
        </p>
      ) : (
        <p>
          {tr("Шаблон:")} <span translate="no">{template.filename}</span>
        </p>
      )}
      <button
        type="button"
        disabled={
          busy ||
          !canDownload ||
          !template ||
          !clientName.trim() ||
          !f.contract_amount ||
          over
        }
        onClick={generate}
      >
        {tr(busy ? "Создание договора…" : "Скачать предварительный договор")}
      </button>
      {previewCreated && (
        <p className="notice" role="status">
          {tr(
            "Предварительный договор скачан. Актуальный договор создастся при сохранении дела.",
          )}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {tr(error)}
        </p>
      )}
    </fieldset>
  );
}

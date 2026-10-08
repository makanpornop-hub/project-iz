"use client";
import { useState } from "react";
import { useT } from "./language";
import {
  optionalCaseFields,
  type CaseFormPolicy,
  type CaseField,
} from "@/lib/case-form-domain";
export default function CaseRequiredFields({
  policy,
  onSave,
  onBusy,
}: {
  policy: CaseFormPolicy;
  onSave: (p: CaseFormPolicy) => void;
  onBusy: (v: boolean) => void;
}) {
  const tr = useT(),
    [selected, setSelected] = useState(policy.required),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  async function save() {
    setBusy(true);
    onBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch("/api/data/mutate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "case-form.save",
          data: { revision: policy.revision, required: selected },
        }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      onSave(d);
      setMessage("Обязательные поля сохранены");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <details className="case-required-fields">
      <summary>{tr("Обязательные поля нового дела")}</summary>
      <p>{tr("Выберите поля, обязательные для всех следующих новых дел.")}</p>
      <p className="muted">
        {tr(
          "ФИО клиента, ответственный, валюта и договорённая сумма обязательны для создания дела и договора.",
        )}
      </p>
      <div className="required-fields-grid">
        {Object.entries(optionalCaseFields).map(([key, label]) => (
          <label key={key} className="check">
            <input
              type="checkbox"
              disabled={busy}
              checked={selected.includes(key as CaseField)}
              onChange={(e) => {
                setSelected(
                  e.target.checked
                    ? [...selected, key as CaseField]
                    : selected.filter((v) => v !== key),
                );
                setMessage("");
              }}
            />
            {tr(label)}
          </label>
        ))}
      </div>
      <p className="muted">
        {tr("Дедлайн оплаты остатка не требуется при полной оплате.")}
      </p>
      <button type="button" disabled={busy} onClick={save}>
        {tr(busy ? "Сохранение…" : "Сохранить обязательные поля")}
      </button>
      {message && (
        <p className="notice" role="status">
          {tr(message)}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {tr(error)}
        </p>
      )}
    </details>
  );
}

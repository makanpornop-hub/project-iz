"use client";
import { useT } from "./language";
import { financialLabels, money } from "@/lib/accounting-domain";
export default function FinanceWarnings({
  value,
  formatMoney = money,
}: {
  value: any;
  formatMoney?: typeof money;
}) {
  const tr = useT();

  const low = value?.balance_status === "LOW_BALANCE";
  if (value?.financial_status === "PAYMENT_DUE_SOON")
    return (
      <div>
        {low && (
          <p className="badge finance-status-LOW_BALANCE">
            {tr("Баланс минимален")}
          </p>
        )}
        <p className="badge finance-status-PAYMENT_DUE_SOON">
          {tr(" Приближается срок оплаты ")}
        </p>
      </div>
    );
  if (!value?.warnings?.length && !low) return null;
  return (
    <div className="finance-warnings">
      {low && (
        <p className="badge finance-status-LOW_BALANCE">
          {tr("Баланс минимален")}
        </p>
      )}
      {(value.warnings || []).map((warning: string) => (
        <div className="finance-warning" key={warning}>
          <strong>
            {tr(warning === "PAYMENT_OVERDUE" ? "⚠️" : "🚨")}
            {tr(" ")}
            {tr(financialLabels[warning])}
          </strong>
          {warning === "PAYMENT_OVERDUE" && value.remaining !== undefined && (
            <small>
              {tr(" Задолженность: ")}
              {tr(formatMoney(value.remaining))}
              {tr(" · до")}
              {tr(" ")}
              {tr(value.payment_deadline)}
              {tr(" · просрочка ")}
              {tr(value.overdue_days)}
              {tr(" дн. ")}
            </small>
          )}
          {warning === "EXPENSES_EXCEED_PAYMENTS" &&
            value.expense_deficit !== undefined && (
              <small>
                {tr("Превышение: ")}
                {tr(formatMoney(value.expense_deficit))}
              </small>
            )}
        </div>
      ))}
    </div>
  );
}

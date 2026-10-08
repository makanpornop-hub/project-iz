import { formatInTimeZone } from "date-fns-tz";
export const financialLabels: Record<string, string> = {
  LOW_BALANCE: "Баланс минимален",
  UNSET: "Договор не задан",
  UNPAID: "Не оплачено",
  PAID: "Полностью оплачено",
  PARTIALLY_PAID: "Частично оплачено",
  PAYMENT_DUE_SOON: "Приближается срок оплаты",
  PAYMENT_OVERDUE: "Оплата просрочена",
  EXPENSES_EXCEED_PAYMENTS: "Расходы превысили оплату",
  FINANCIAL_ATTENTION: "Требуется внимание",
};
export const paymentTypes: Record<string, string> = {
  INITIAL: "Первичный взнос",
  ADDITIONAL: "Доплата",
  FULL: "Полная оплата",
  REFUND: "Возврат",
  OTHER: "Другое",
};
export const paymentMethods: Record<string, string> = {
  CASH: "Наличные",
  CARD: "Карта",
  TRANSFER: "Банковский перевод",
  OTHER: "Другое",
};
export function cents(value: string | number | bigint): bigint {
  const text = String(value);
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) throw Error("Invalid money");
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.replace("-", "").split(".");
  return (
    (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))) *
    (negative ? -1n : 1n)
  );
}
export function decimal(value: bigint) {
  return (
    (value < 0n ? "-" : "") +
    String((value < 0n ? -value : value) / 100n) +
    "." +
    String((value < 0n ? -value : value) % 100n).padStart(2, "0")
  );
}
export function money(
  value: string | number | null | undefined,
  currency = "UZS",
) {
  if (value == null) return "—";
  const n = cents(value),
    absolute = n < 0n ? -n : n;
  const whole = new Intl.NumberFormat("ru-RU").format(absolute / 100n);
  const fraction = String(absolute % 100n)
    .padStart(2, "0")
    .replace(/0+$/, "");
  return (
    (n < 0n ? "−" : "") +
    whole +
    (fraction ? "," + fraction : "") +
    " " +
    ({ UZS: "сум", USD: "$", EUR: "€" }[currency] || currency)
  );
}

export function calculateFinance(
  input: {
    contract_amount: string | null;
    paid: string;
    expenses: string;
    payment_deadline: string | null;
  },
  now = new Date(),
  zone = "Asia/Tashkent",
) {
  const paid = cents(input.paid),
    expenses = cents(input.expenses),
    contract =
      input.contract_amount === null ? null : cents(input.contract_amount);
  const remaining = contract === null ? null : contract - paid;
  const today = formatInTimeZone(now, zone, "yyyy-MM-dd");
  const days = input.payment_deadline
    ? Math.round(
        (Date.parse(input.payment_deadline + "T00:00:00Z") -
          Date.parse(today + "T00:00:00Z")) /
          86400000,
      )
    : null;
  const warnings: string[] = [];
  if (remaining !== null && remaining > 0n && days !== null && days < 0)
    warnings.push("PAYMENT_OVERDUE");
  if (expenses > paid) warnings.push("EXPENSES_EXCEED_PAYMENTS");
  const payment_status =
    contract === null
      ? "UNSET"
      : remaining! <= 0n
        ? "PAID"
        : paid > 0n
          ? "PARTIALLY_PAID"
          : "UNPAID";
  const financial_status =
    warnings.length > 1
      ? "FINANCIAL_ATTENTION"
      : warnings[0] ||
        (remaining !== null &&
        remaining > 0n &&
        days !== null &&
        days >= 0 &&
        days <= 3
          ? "PAYMENT_DUE_SOON"
          : payment_status);
  return {
    ...input,
    remaining: remaining === null ? null : decimal(remaining),
    planned_profit: contract === null ? null : decimal(contract - expenses),
    cash_result: decimal(paid - expenses),
    expense_deficit: decimal(expenses > paid ? expenses - paid : 0n),
    payment_status,
    financial_status,
    warnings,
    days_to_payment: days,
    overdue_days: days !== null ? Math.max(0, -days) : 0,
  };
}

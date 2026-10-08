import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateFinance, cents, decimal } from "../src/lib/accounting-domain";
const now = new Date("2030-05-10T10:00:00Z");
const calc = (overrides: Record<string, any> = {}) =>
  calculateFinance(
    {
      contract_amount: "10000000.00",
      paid: "4000000.00",
      expenses: "0.00",
      payment_deadline: "2030-05-09",
      ...overrides,
    },
    now,
  );
test("Accounting: overdue contract of 10m with 4m paid", () => {
  const r = calc();
  assert.equal(r.financial_status, "PAYMENT_OVERDUE");
  assert.equal(r.remaining, "6000000.00");
  assert.equal(r.overdue_days, 1);
});
test("Accounting: 6m expenses against 5m paid produces 1m deficit", () => {
  const r = calc({
    paid: "5000000",
    expenses: "6000000",
    payment_deadline: null,
  });
  assert.equal(r.financial_status, "EXPENSES_EXCEED_PAYMENTS");
  assert.equal(r.expense_deficit, "1000000.00");
});
test("Accounting: additional payment clears deficit", () => {
  const r = calc({
    paid: "8000000",
    expenses: "6000000",
    payment_deadline: null,
  });
  assert.deepEqual(r.warnings, []);
  assert.equal(r.financial_status, "PARTIALLY_PAID");
});
test("Accounting: full payment clears overdue", () => {
  const r = calc({ paid: "10000000" });
  assert.equal(r.remaining, "0.00");
  assert.equal(r.financial_status, "PAID");
  assert.deepEqual(r.warnings, []);
});
test("Accounting: both critical reasons are retained", () => {
  const r = calc({ expenses: "6000000" });
  assert.equal(r.financial_status, "FINANCIAL_ATTENTION");
  assert.deepEqual(r.warnings, ["PAYMENT_OVERDUE", "EXPENSES_EXCEED_PAYMENTS"]);
});
test("Accounting: today, timezone midnight, no deadline, unconfigured, overpayment and precision", () => {
  assert.equal(
    calc({ payment_deadline: "2030-05-10" }).financial_status,
    "PAYMENT_DUE_SOON",
  );
  assert.equal(
    calculateFinance(
      {
        contract_amount: "10",
        paid: "0",
        expenses: "0",
        payment_deadline: "2030-05-10",
      },
      new Date("2030-05-10T19:00:00Z"),
    ).financial_status,
    "PAYMENT_OVERDUE",
  );
  assert.equal(
    calc({ payment_deadline: null }).financial_status,
    "PARTIALLY_PAID",
  );
  assert.equal(
    calc({ contract_amount: null, paid: "0", payment_deadline: null })
      .financial_status,
    "UNSET",
  );
  assert.equal(calc({ paid: "11000000" }).remaining, "-1000000.00");
  assert.equal(calc({ paid: "11000000" }).financial_status, "PAID");
  assert.equal(decimal(cents("0.10") + cents("0.20")), "0.30");
  assert.equal(
    decimal(cents("9999999999999.99") - cents("0.01")),
    "9999999999999.98",
  );
});

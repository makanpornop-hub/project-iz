import type { PoolClient } from "pg";
import { z } from "zod";
import { AppError, audit, requirePermission, type Actor } from "./access";
import { cents, decimal } from "./accounting-domain";
import { quote } from "./exchange-rates";
import { formatInTimeZone } from "date-fns-tz";
import { settings } from "./service";
import { recalculateFinance } from "./accounting";
const money = z.string().regex(/^\d{1,13}(\.\d{1,2})?$/);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T00:00:00Z");
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
  });
export const creationFinanceSchema = z
  .object({
    currency: z.enum(["UZS", "USD", "EUR"]),
    contract_amount: money.refine(
      (v) => cents(v) > 0n,
      "Укажите договорённую сумму",
    ),
    initial_payment: z.union([money, z.literal("")]).default(""),
    payment_deadline: z.union([date, z.literal("")]).default(""),
    paid_on: z.union([date, z.literal("")]).default(""),
    method: z.enum(["CASH", "CARD", "TRANSFER", "OTHER"]).default("OTHER"),
  })
  .superRefine((d, ctx) => {
    if (
      d.initial_payment &&
      cents(d.initial_payment) > cents(d.contract_amount)
    )
      ctx.addIssue({
        code: "custom",
        path: ["initial_payment"],
        message: "Первичный взнос не может превышать договорённую сумму",
      });
  });
export type CreationFinance = z.infer<typeof creationFinanceSchema>;
export async function initializeCaseFinance(
  c: PoolClient,
  a: Actor,
  caseId: string,
  raw: unknown,
) {
  requirePermission(a, "accounting.view");
  requirePermission(a, "accounting.manage");
  requirePermission(a, "accounting.view_contract");
  const d = creationFinanceSchema.parse(raw);
  const today = formatInTimeZone(
    new Date(),
    (await settings(c)).timezone,
    "yyyy-MM-dd",
  );
  const contract = await quote(c, d.currency, d.contract_amount, today);
  const deposit =
    d.initial_payment && cents(d.initial_payment) > 0n
      ? await quote(c, d.currency, d.initial_payment, d.paid_on || today)
      : null;
  if (deposit) requirePermission(a, "payments.create");
  const deadline =
    d.initial_payment && cents(d.initial_payment) >= cents(d.contract_amount)
      ? null
      : d.payment_deadline || null;
  await c.query(
    "INSERT INTO case_finances(case_id,currency,original_amount,exchange_rate,rate_date,contract_amount,payment_deadline,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      caseId,
      d.currency,
      d.contract_amount,
      contract.rate,
      contract.date,
      contract.amount,
      deadline,
      a.id,
    ],
  );
  if (deposit) {
    const payment = (
      await c.query(
        "INSERT INTO client_payments(case_id,request_key,amount,original_amount,currency,exchange_rate,rate_date,paid_on,type,method,comment,created_by,updated_by) VALUES($1,gen_random_uuid(),$2,$3,$4,$5,$6,$7,'INITIAL',$8,'Первичный взнос при создании дела',$9,$9) RETURNING id",
        [
          caseId,
          deposit.amount,
          d.initial_payment,
          d.currency,
          deposit.rate,
          deposit.date,
          d.paid_on || today,
          d.method,
          a.id,
        ],
      )
    ).rows[0];
    await audit(
      c,
      a,
      "Первичный взнос сохранён",
      "client_payments",
      payment.id,
      caseId,
    );
  }
  await recalculateFinance(c, caseId);
  await audit(
    c,
    a,
    "Условия оплаты сохранены при создании дела",
    "case_finance",
    caseId,
    caseId,
    {
      currency: d.currency,
      total: decimal(cents(d.contract_amount)),
      initial: d.initial_payment || "0",
      payment_deadline: deadline,
    },
  );
  return d;
}

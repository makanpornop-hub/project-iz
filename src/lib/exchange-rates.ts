import { db } from "./db";
import type { PoolClient } from "pg";
import { formatInTimeZone } from "date-fns-tz";
import { AppError } from "./access";
import { rateUnits, convertToUzs } from "./currency-domain";
type Connection = Pick<PoolClient, "query">;
export const exchangeToday = () =>
  formatInTimeZone(new Date(), "Asia/Tashkent", "yyyy-MM-dd");
export function parseCbu(data: unknown, day: string) {
  if (!Array.isArray(data)) throw Error("Некорректный ответ ЦБ");
  return ["USD", "EUR"].map((currency) => {
    const row = data.find((r) => r.Ccy === currency);
    if (
      !row ||
      !/^\d{2}\.\d{2}\.\d{4}$/.test(row.Date) ||
      !/^\d+$/.test(String(row.Nominal))
    )
      throw Error("В ответе ЦБ отсутствует валюта или дата");
    const [d, m, y] = row.Date.split("."),
      date = y + "-" + m + "-" + d;
    if (
      date > day ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date ||
      BigInt(row.Nominal) <= 0n
    )
      throw Error("Некорректная дата или номинал ЦБ");
    const units = rateUnits(String(row.Rate)) / BigInt(row.Nominal);
    const rate =
      String(units / 100000000n) +
      "." +
      String(units % 100000000n).padStart(8, "0");
    rateUnits(rate);
    return { currency, rate, rate_date: date };
  });
}
export async function syncExchangeRates(
  day = exchangeToday(),
  c: Connection = db,
) {
  const current = day === exchangeToday();
  if (current)
    await c.query("UPDATE exchange_sync SET attempted_at=now() WHERE id=1");
  try {
    const response = await fetch(
      "https://cbu.uz/ru/arkhiv-kursov-valyut/json/all/" + day + "/",
      { signal: AbortSignal.timeout(15000), cache: "no-store" },
    );
    if (!response.ok) throw Error("ЦБ временно недоступен");
    const rates = parseCbu(await response.json(), day);
    for (const r of rates)
      await c.query(
        "INSERT INTO exchange_rates(currency,rate_date,rate) VALUES($1,$2,$3) ON CONFLICT(currency,rate_date) DO UPDATE SET rate=excluded.rate,fetched_at=now()",
        [r.currency, r.rate_date, r.rate],
      );
    if (current)
      await c.query(
        "UPDATE exchange_sync SET succeeded_at=now(),error=NULL WHERE id=1",
      );
    return rates;
  } catch {
    if (current)
      await c.query(
        "UPDATE exchange_sync SET error='Не удалось получить курсы ЦБ. Используются сохранённые данные.' WHERE id=1",
      );
    throw new AppError(
      503,
      "Не удалось получить курс ЦБ на выбранную дату. Повторите позже.",
    );
  }
}
export async function exchangeState(c: Connection = db) {
  const rates = (
    await c.query(
      "SELECT DISTINCT ON(currency) currency,rate::text,to_char(rate_date,'YYYY-MM-DD') rate_date,fetched_at FROM exchange_rates WHERE rate_date<=$1 ORDER BY currency,rate_date DESC",
      [exchangeToday()],
    )
  ).rows;
  const sync = (await c.query("SELECT * FROM exchange_sync WHERE id=1"))
    .rows[0];
  return { rates, sync, source: "ЦБ Узбекистана" };
}
export async function quote(
  c: Connection,
  currency: string,
  amount: string,
  day: string,
  old?: any,
) {
  if (currency === "UZS") return { amount, rate: "1", date: null };
  if (day > exchangeToday())
    throw new AppError(
      400,
      "Для валютной операции нельзя выбрать будущую дату",
    );
  if (old && old.currency === currency && old.operation_date === day)
    return {
      amount: convertToUzs(amount, old.exchange_rate),
      rate: old.exchange_rate,
      date: old.rate_date,
    };
  // Request the exact historical date: a cached older quote must never silently price a new operation.
  const rows = await syncExchangeRates(day, c);
  const r = rows.find((r) => r.currency === currency)!;
  return {
    amount: convertToUzs(amount, r.rate),
    rate: r.rate,
    date: r.rate_date,
  };
}

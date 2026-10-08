import { cents, decimal } from "./accounting-domain";
export const currencies = { UZS: "Сум", USD: "Доллар", EUR: "Евро" };
export function rateUnits(rate: string): bigint {
  if (!/^\d+(\.\d{1,8})?$/.test(rate)) throw Error("Некорректный курс");
  const [whole, fraction = ""] = rate.split(".");
  const n = BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, "0"));
  if (n <= 0n) throw Error("Некорректный курс");
  return n;
}
export function convertToUzs(amount: string, rate: string) {
  const n = cents(amount) * rateUnits(rate);
  const result = decimal((n + 50000000n) / 100000000n);
  if (cents(result) > 9999999999999999n)
    throw Error("Сумма после пересчёта слишком велика");
  return result;
}
export function balanceInUsd(balance: string, rate: string) {
  const n = cents(balance) * 100000000n,
    divisor = rateUnits(rate);
  return decimal(n / divisor);
}
export function isLowBalance(balance: string, rate: string) {
  return cents(balance) * 100000000n <= 5000n * rateUnits(rate);
}

export function displayAmount(
  amount: string,
  sourceRate: string,
  targetRate: string,
) {
  const n = cents(amount) * rateUnits(sourceRate),
    divisor = rateUnits(targetRate);
  const absolute = n < 0n ? -n : n;
  return decimal(((absolute + divisor / 2n) / divisor) * (n < 0n ? -1n : 1n));
}

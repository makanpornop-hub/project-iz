import { test } from "node:test";
import assert from "node:assert/strict";
import {
  displayAmount,
  convertToUzs,
  isLowBalance,
  balanceInUsd,
} from "../src/lib/currency-domain";
import { parseCbu } from "../src/lib/exchange-rates";
test("Exact currency arithmetic and inclusive $50 boundary", () => {
  assert.equal(convertToUzs("100.25", "12500.12345678"), "1253137.38");
  assert.equal(convertToUzs("0.01", "12500.5"), "125.01");
  assert.equal(balanceInUsd("625000", "12500"), "50.00");
  assert.equal(isLowBalance("625000", "12500"), true);
  assert.equal(isLowBalance("625000.01", "12500"), false);
  assert.equal(isLowBalance("-1", "12500"), true);
  assert.throws(() => convertToUzs("9999999999999", "99999"));
});
test("CBU validates dates, nominal and both currencies", () => {
  const rows = [
    { Ccy: "USD", Rate: "1250000.00", Nominal: "100", Date: "18.09.2026" },
    { Ccy: "EUR", Rate: "14000.00", Nominal: "1", Date: "18.09.2026" },
  ];
  assert.equal(parseCbu(rows, "2026-09-19")[0].rate, "12500.00000000");
  assert.throws(() => parseCbu(rows, "2026-09-17"));
  assert.throws(() => parseCbu(rows.slice(0, 1), "2026-09-19"));
  assert.throws(() =>
    parseCbu([{ ...rows[0], Rate: "0" }, rows[1]], "2026-09-19"),
  );
});

test("Display conversion rounds money and preserves negative balances", () => {
  assert.equal(displayAmount("12500", "1", "12500"), "1.00");
  assert.equal(displayAmount("100", "14000", "12500"), "112.00");
  assert.equal(displayAmount("-6250", "1", "12500"), "-0.50");
});

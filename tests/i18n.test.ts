import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { translate, languageNames } from "../src/lib/i18n";
import entries from "../src/lib/translations.json";
test("Five languages and complete translation rows", () => {
  assert.equal(Object.keys(languageNames).length, 5);
  for (const [key, row] of Object.entries(entries)) {
    assert.equal(row.length, 4, key);
    assert.ok(
      row.every((v) => v.trim().length > 0),
      key,
    );
    assert.equal(translate(key, "ru"), key);
    assert.doesNotMatch(row[2], /[а-яё]/i, key);
    assert.doesNotMatch(row[3], /[а-яё]/i, key);
  }
  assert.equal(translate("Обзор", "en"), "Overview");
  assert.equal(translate("Обзор", "es"), "Resumen");
  assert.equal(translate("Обзор", "uz-Latn"), "Umumiy ko‘rinish");
  assert.equal(translate("Обзор", "uz-Cyrl"), "Умумий кўриниш");
});
test("Whitespace, deadlines, amounts and unknown document names remain safe", () => {
  assert.equal(translate(" Обзор ", "en"), " Overview ");
  assert.equal(translate("Просрочено: 2 дня", "en"), "Overdue: 2 days");
  assert.equal(translate("12 500 сум", "en"), "12 500 UZS");
  for (const language of Object.keys(
    languageNames,
  ) as (keyof typeof languageNames)[])
    assert.equal(
      translate("Диплом клиента.pdf", language),
      "Диплом клиента.pdf",
    );
});
test("Document titles bypass translation even when matching interface keys", () => {
  for (const [file, expression] of [
    ["case-workflow.tsx", "g.name"],
    ["case-workflow.tsx", "f.name"],
    ["file-preview.tsx", "file.filename"],
    ["workspace.tsx", "d.name"],
    ["workspace.tsx", "v.filename"],
  ]) {
    const source = readFileSync("src/components/" + file, "utf8");
    assert.ok(
      source.includes('<span translate="no">{' + expression + "}</span>"),
      expression,
    );
    assert.ok(!source.includes("tr(" + expression + ")"), expression);
  }
});

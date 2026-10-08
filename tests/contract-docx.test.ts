import { test } from "node:test";
import assert from "node:assert/strict";
import { strFromU8, unzipSync, zipSync, strToU8 } from "fflate";
import {
  fillContractTemplate,
  validateContractTemplate,
  contractTokens,
} from "../src/lib/contract-docx";
import { testContractTemplate } from "./fixtures/contract-template";
test("DOCX keeps formatting and replaces split-run and repeated header placeholders", () => {
  const original = testContractTemplate();
  assert.deepEqual(
    new Set(validateContractTemplate(original)),
    new Set(contractTokens),
  );
  const result = unzipSync(
    fillContractTemplate(original, {
      CLIENT_NAME: "Тестов Иван & <Имя>",
      DATE: "06.10.2026",
      TOTAL_AMOUNT: "1234,50",
      INITIAL_PAYMENT: "200,00",
      CURRENCY: "EUR",
    }),
  );
  const xml = strFromU8(result["word/document.xml"]),
    header = strFromU8(result["word/header1.xml"]);
  assert.match(xml, /Тестов Иван &amp; &lt;Имя&gt;/);
  assert.match(header, /Тестов Иван &amp; &lt;Имя&gt;/);
  assert.match(xml, /1234,50 EUR; initial 200,00 EUR/);
  assert.match(xml, /<w:b\/>/);
  assert.match(xml, /06\.10\.2026/);
  assert.doesNotMatch(xml, /\{\{/);
  const source = unzipSync(original);
  assert.deepEqual(
    result["word/_rels/document.xml.rels"],
    source["word/_rels/document.xml.rels"],
  );
  assert.deepEqual(
    result["[Content_Types].xml"],
    source["[Content_Types].xml"],
  );
});
test("DOCX rejects missing placeholders, invalid containers, oversized expansion and macros", () => {
  assert.throws(() => validateContractTemplate(Buffer.from("not a DOCX")));
  const files = unzipSync(testContractTemplate());
  files["word/document.xml"] = strToU8(
    strFromU8(files["word/document.xml"]).replace(
      "{{INITIAL_PAYMENT}}",
      "initial",
    ),
  );
  assert.throws(
    () => validateContractTemplate(zipSync(files)),
    /INITIAL_PAYMENT/,
  );
  files["word/vbaProject.bin"] = new Uint8Array([1]);
  assert.throws(() => validateContractTemplate(zipSync(files)), /вложения/);
  delete files["word/vbaProject.bin"];
  files["huge.txt"] = new Uint8Array(21 * 1024 * 1024);
  assert.throws(() => validateContractTemplate(zipSync(files)), /вложения/);
});

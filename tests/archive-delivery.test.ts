import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, unzipSync } from "fflate";
import { archiveParts } from "../src/lib/workflow-archive-delivery";
test("Large archives split into independent ZIPs preserving every file", () => {
  const entries = {
    "a/doc.pdf": new Uint8Array(6000),
    "b/doc.pdf": new Uint8Array(6000),
    "b/other.pdf": new Uint8Array(6000),
  };
  const bytes = Buffer.from(zipSync(entries, { level: 0 }));
  assert.equal(archiveParts(bytes).length, 1);
  const parts = archiveParts(bytes, 10000);
  assert.equal(parts.length, 3);
  const restored = Object.assign(
    {},
    ...parts.map((p) => {
      assert.ok(p.length <= 10000);
      return unzipSync(p);
    }),
  );
  assert.deepEqual(restored, entries);
});

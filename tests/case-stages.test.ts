import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("Case stage migration preserves case data, records stage history and keeps task statuses", async () => {
  const pg = await PGlite.create();
  try {
    for (const name of (await readdir("migrations"))
      .sort()
      .filter((n) => n < "017_case_stages.sql"))
      await pg.exec(await readFile("migrations/" + name, "utf8"));
    await pg.exec(
      "INSERT INTO roles VALUES('Administrator','Administrator'); INSERT INTO \"user\"(id,name,email) VALUES('test','Test','test@test.invalid'); INSERT INTO staff(user_id,role_id) VALUES('test','Administrator'); INSERT INTO clients(name,email,phone) VALUES('Original client','original@test.invalid','+998000');",
    );
    const mapping = [
      ["New", "Contract signing"],
      ["Application submitted", "Waiting for decision"],
      ["Completed", "Visa approved"],
      ["Cancelled", "Visa refused"],
      ["Additional request", "Additional request"],
      ["Documents collecting", "Documents collecting"],
      ["Under review", "Under review"],
    ];
    for (const [before] of mapping) {
      await pg.query(
        "INSERT INTO case_statuses VALUES($1) ON CONFLICT DO NOTHING",
        [before],
      );
      await pg.query(
        "INSERT INTO cases(client_id,country,visa_type,responsible_id,status,deadline) SELECT id,'Spain','Shengen','test',$1,'2030-01-01' FROM clients",
        [before],
      );
    }
    const before = (await pg.query<any>("SELECT * FROM cases ORDER BY number"))
      .rows;
    await pg.query(
      "INSERT INTO tasks(case_id,title,responsible_id,creator_id,status,completed_at) VALUES($1,'Original task','test','test','Completed',now())",
      [before[0].id],
    );
    await pg.exec(await readFile("migrations/017_case_stages.sql", "utf8"));
    const after = (await pg.query<any>("SELECT * FROM cases ORDER BY number"))
      .rows;
    assert.equal(after.length, before.length);
    for (const [i, rec] of after.entries()) {
      assert.equal(rec.status, mapping[i][1]);
      assert.equal(rec.id, before[i].id);
      assert.equal(rec.client_id, before[i].client_id);
      assert.equal(rec.responsible_id, before[i].responsible_id);
      assert.equal(
        rec.deadline.toISOString(),
        before[i].deadline.toISOString(),
      );
      assert.equal(rec.revision, before[i].revision + (i < 4 ? 1 : 0));
    }
    assert.equal(
      (
        await pg.query<any>(
          "SELECT count(*)::int count FROM audit_logs WHERE source='migration'",
        )
      ).rows[0].count,
      4,
    );
    assert.equal(
      (await pg.query<any>("SELECT status FROM tasks")).rows[0].status,
      "Completed",
    );
    const statuses = (
      await pg.query<any>("SELECT id FROM case_statuses ORDER BY id")
    ).rows.map((r) => r.id);
    assert.equal(statuses.length, 9);
    assert.ok(
      !statuses.includes("New") &&
        !statuses.includes("Completed") &&
        !statuses.includes("Cancelled"),
    );
    const added = (
      await pg.query<any>(
        "INSERT INTO cases(client_id,country,visa_type,responsible_id) SELECT id,'Spain','Shengen','test' FROM clients RETURNING status",
      )
    ).rows[0];
    assert.equal(added.status, "Contract signing");
  } finally {
    await pg.close();
  }
});

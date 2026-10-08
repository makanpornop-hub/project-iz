import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

process.env.DATABASE_URL =
  "postgresql://postgres:postgres@127.0.0.1:55442/postgres";
process.env.BETTER_AUTH_SECRET =
  "isolated-case-followup-test-secret-no-production";
process.env.TELEGRAM_BOT_TOKEN = "test-only-no-network";
const pg = await PGlite.create();
const socket = new PGLiteSocketServer({
  db: pg,
  host: "127.0.0.1",
  port: 55442,
  maxConnections: 10,
});
await socket.start();
for (const file of (await readdir("migrations")).sort())
  await pg.exec(await readFile("migrations/" + file, "utf8"));
const { db, tx } = await import("../src/lib/db");
const { actorFor } = await import("../src/lib/access");
const { permissions, caseStatuses } = await import("../src/lib/domain");
const {
  parseCaseCheckDate,
  scheduleCaseFollowup,
  notifyCaseFollowup,
  deliverCaseFollowupNotification,
} = await import("../src/lib/case-followup");
const { formatInTimeZone } = await import("date-fns-tz");
const { tick } = await import("../src/lib/worker");
await test("Case follow-up integration", async (t) => {
  const originalFetch = globalThis.fetch;
  const telegramCalls: any[] = [];
  let failTelegram = false;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    assert.equal(
      url,
      "https://api.telegram.org/bottest-only-no-network/sendMessage",
      "No external network is allowed in this suite",
    );
    telegramCalls.push(JSON.parse(String(init?.body)));
    if (failTelegram) throw new Error("simulated delivery failure");
    return new Response(
      JSON.stringify({ ok: true, result: { message_id: 1 } }),
      {
        status: 200,
      },
    );
  };
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await db.end();
    await socket.stop();
    await pg.close();
  });
  for (const permission of permissions)
    await db.query(
      "INSERT INTO permissions VALUES($1) ON CONFLICT DO NOTHING",
      [permission],
    );
  for (const status of caseStatuses)
    await db.query(
      "INSERT INTO case_statuses VALUES($1) ON CONFLICT DO NOTHING",
      [status],
    );
  await db.query(
    "INSERT INTO roles VALUES('Administrator','Administrator'),('Employee','Employee')",
  );
  for (const permission of permissions)
    await db.query("INSERT INTO role_permissions VALUES('Administrator',$1)", [
      permission,
    ]);
  for (const permission of ["can_view_cases", "can_upload_documents"])
    await db.query("INSERT INTO role_permissions VALUES('Employee',$1)", [
      permission,
    ]);
  for (const [id, role] of [
    ["admin", "Administrator"],
    ["anna", "Employee"],
    ["bob", "Employee"],
  ]) {
    await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$1,$2)', [
      id,
      id + "@test.invalid",
    ]);
    await db.query("INSERT INTO staff(user_id,role_id) VALUES($1,$2)", [
      id,
      role,
    ]);
    await db.query(
      "INSERT INTO telegram_links(user_id,telegram_id) VALUES($1,$2)",
      [id, "test-" + id],
    );
  }
  const admin = await actorFor("admin"),
    anna = await actorFor("anna"),
    bob = await actorFor("bob");
  const today = () =>
    formatInTimeZone(new Date(), "Asia/Tashkent", "yyyy-MM-dd");
  const tomorrow = () =>
    formatInTimeZone(
      new Date(Date.now() + 86400000),
      "Asia/Tashkent",
      "yyyy-MM-dd",
    );
  async function fixture() {
    const client = (
      await db.query(
        "INSERT INTO clients(name) VALUES('Test client private name') RETURNING id",
      )
    ).rows[0];
    const record = (
      await db.query(
        "INSERT INTO cases(client_id,country,visa_type,responsible_id,deadline,status) VALUES($1,'Spain','ВНЖ испания','anna',now()+interval '30 days','Under review') RETURNING *",
        [client.id],
      )
    ).rows[0];
    const archive = (
      await db.query(
        "INSERT INTO workflow_archives(case_id,filename,storage_key,size,file_count,version_ids) VALUES($1,'test.zip',$2,12,1,'{}') RETURNING *",
        [record.id, randomUUID()],
      )
    ).rows[0];
    return { record, archive };
  }
  async function planFor(id: string) {
    return (
      await db.query("SELECT * FROM case_followups WHERE case_id=$1", [id])
    ).rows[0];
  }
  async function makeDue(caseId: string) {
    await db.query(
      "UPDATE case_followups SET check_at=now()-interval '1 minute' WHERE case_id=$1",
      [caseId],
    );
  }

  await t.test(
    "Case follow-up date validation respects the company calendar",
    () => {
      const now = new Date("2026-09-27T23:00:00Z");
      assert.equal(
        parseCaseCheckDate("2026-09-28", "Asia/Tashkent", now).toISOString(),
        "2026-09-28T04:00:00.000Z",
      );
      assert.equal(
        parseCaseCheckDate("2026-09-27", "UTC", now).toISOString(),
        "2026-09-27T09:00:00.000Z",
      );
      assert.throws(
        () => parseCaseCheckDate("2026-09-27", "Asia/Tashkent", now),
        /прошлом/,
      );
      for (const value of [
        "2027-02-29",
        "2026-13-01",
        "2026-09-31",
        "2026-9-28",
        "invalid",
        "",
      ])
        assert.throws(() => parseCaseCheckDate(value, "Asia/Tashkent", now));
      assert.equal(
        parseCaseCheckDate("2028-02-29", "Asia/Tashkent", now).toISOString(),
        "2028-02-29T04:00:00.000Z",
      );
    },
  );

  await t.test(
    "Scheduling is scoped, idempotent, keeps the case deadline and replaces stale jobs",
    async () => {
      const { record, archive } = await fixture();
      await assert.rejects(
        tx((c) =>
          scheduleCaseFollowup(c, bob, record.id, archive.id, tomorrow()),
        ),
        /недоступно/,
      );
      await assert.rejects(
        tx((c) =>
          scheduleCaseFollowup(
            c,
            { ...anna, permissions: ["can_view_cases"] },
            record.id,
            archive.id,
            tomorrow(),
          ),
        ),
        /прав/,
      );
      const foreign = await fixture();
      await assert.rejects(
        tx((c) =>
          scheduleCaseFollowup(
            c,
            anna,
            record.id,
            foreign.archive.id,
            tomorrow(),
          ),
        ),
        /Архив/,
      );
      const first = await tx((c) =>
        scheduleCaseFollowup(c, anna, record.id, archive.id, today()),
      );
      const updated = (
        await db.query("SELECT * FROM cases WHERE id=$1", [record.id])
      ).rows[0];
      assert.equal(updated.status, "Under review");
      assert.equal(updated.revision, record.revision);
      assert.equal(
        updated.deadline.toISOString(),
        record.deadline.toISOString(),
      );
      const scheduled = (
        await db.query(
          "SELECT * FROM jobs WHERE kind='case_followup' AND payload->>'caseId'=$1",
          [record.id],
        )
      ).rows;
      assert.equal(scheduled.length, 1);
      assert.ok(scheduled[0].run_at >= first.check_at);
      const repeated = await tx((c) =>
        scheduleCaseFollowup(c, anna, record.id, archive.id, today()),
      );
      assert.equal(repeated.revision, first.revision);
      assert.equal(
        (await db.query("SELECT revision FROM cases WHERE id=$1", [record.id]))
          .rows[0].revision,
        updated.revision,
      );
      const changed = await tx((c) =>
        scheduleCaseFollowup(c, anna, record.id, archive.id, tomorrow()),
      );
      assert.equal(changed.revision, first.revision + 1);
      assert.equal(
        (
          await db.query("SELECT status FROM jobs WHERE id=$1", [
            scheduled[0].id,
          ])
        ).rows[0].status,
        "cancelled",
      );
      const reminders = (
        await db.query(
          "SELECT payload FROM jobs WHERE kind='reminder' AND status='pending' AND payload->>'id'=$1",
          [record.id],
        )
      ).rows;
      assert.equal(
        reminders.length,
        0,
        "Check date does not rewrite the case deadline",
      );
      await db.query("UPDATE cases SET status='Visa approved' WHERE id=$1", [
        record.id,
      ]);
      await assert.rejects(
        tx((c) =>
          scheduleCaseFollowup(c, admin, record.id, archive.id, tomorrow()),
        ),
        /Закрытое/,
      );
    },
  );

  await t.test(
    "The due job notifies the current responsible employee once and cancelled plans cannot deliver",
    async () => {
      const { record, archive } = await fixture();
      const plan = await tx((c) =>
        scheduleCaseFollowup(c, anna, record.id, archive.id, tomorrow()),
      );
      await notifyCaseFollowup(record.id, plan.revision);
      assert.equal(
        (
          await db.query("SELECT * FROM notifications WHERE case_id=$1", [
            record.id,
          ])
        ).rowCount,
        0,
      );
      await db.query("UPDATE cases SET responsible_id='bob' WHERE id=$1", [
        record.id,
      ]);
      await makeDue(record.id);
      await notifyCaseFollowup(record.id, plan.revision - 1);
      await notifyCaseFollowup(record.id, plan.revision);
      await notifyCaseFollowup(record.id, plan.revision);
      const notes = (
        await db.query("SELECT * FROM notifications WHERE case_id=$1", [
          record.id,
        ])
      ).rows;
      assert.equal(notes.length, 1);
      assert.equal(notes[0].user_id, "bob");
      assert.ok((await planFor(record.id)).notified_at);
      const delivery = (
        await db.query(
          "SELECT * FROM jobs WHERE kind='notification' AND payload->>'notificationId'=$1",
          [notes[0].id],
        )
      ).rows[0];
      assert.equal(delivery.payload.origin.revision, plan.revision);
      await tx((c) =>
        scheduleCaseFollowup(c, admin, record.id, archive.id, tomorrow()),
      );
      assert.equal(
        (await db.query("SELECT status FROM jobs WHERE id=$1", [delivery.id]))
          .rows[0].status,
        "cancelled",
      );
      let sends = 0;
      assert.equal(
        await deliverCaseFollowupNotification(
          record.id,
          plan.revision,
          "bob",
          async () => {
            sends++;
          },
        ),
        false,
      );
      assert.equal(sends, 0);
    },
  );

  await t.test(
    "Telegram delivery survives failure, avoids repeated sends and checks the current case state",
    async () => {
      const { record, archive } = await fixture();
      const plan = await tx((c) =>
        scheduleCaseFollowup(c, anna, record.id, archive.id, today()),
      );
      await makeDue(record.id);
      await notifyCaseFollowup(record.id, plan.revision);
      await assert.rejects(
        deliverCaseFollowupNotification(
          record.id,
          plan.revision,
          "anna",
          async () => {
            throw new Error("retry");
          },
        ),
        /retry/,
      );
      assert.equal((await planFor(record.id)).telegram_sent_at, null);
      let sends = 0;
      const send = async () => {
        sends++;
      };
      assert.equal(
        await deliverCaseFollowupNotification(
          record.id,
          plan.revision,
          "bob",
          send,
        ),
        false,
      );
      assert.equal(
        await deliverCaseFollowupNotification(
          record.id,
          plan.revision,
          "anna",
          send,
        ),
        true,
      );
      assert.equal(
        await deliverCaseFollowupNotification(
          record.id,
          plan.revision,
          "anna",
          send,
        ),
        true,
      );
      assert.equal(sends, 1);
      assert.ok((await planFor(record.id)).telegram_sent_at);
      await db.query("UPDATE cases SET status='Visa refused' WHERE id=$1", [
        record.id,
      ]);
      assert.equal(
        await deliverCaseFollowupNotification(
          record.id,
          plan.revision,
          "anna",
          send,
        ),
        false,
      );
      const closed = await fixture();
      const closedPlan = await tx((c) =>
        scheduleCaseFollowup(
          c,
          anna,
          closed.record.id,
          closed.archive.id,
          today(),
        ),
      );
      await makeDue(closed.record.id);
      await db.query("UPDATE cases SET status='Visa approved' WHERE id=$1", [
        closed.record.id,
      ]);
      await notifyCaseFollowup(closed.record.id, closedPlan.revision);
      assert.equal(
        (
          await db.query("SELECT * FROM notifications WHERE case_id=$1", [
            closed.record.id,
          ])
        ).rowCount,
        0,
      );
    },
  );

  await t.test(
    "Blocking the responsible employee or removing access cancels a queued delivery",
    async () => {
      const { record, archive } = await fixture();
      const plan = await tx((c) =>
        scheduleCaseFollowup(c, anna, record.id, archive.id, today()),
      );
      await makeDue(record.id);
      await notifyCaseFollowup(record.id, plan.revision);
      let sends = 0;
      const send = async () => {
        sends++;
      };
      await db.query("UPDATE staff SET active=false WHERE user_id='anna'");
      try {
        assert.equal(
          await deliverCaseFollowupNotification(
            record.id,
            plan.revision,
            "anna",
            send,
          ),
          false,
        );
        assert.equal((await planFor(record.id)).telegram_sent_at, null);
      } finally {
        await db.query("UPDATE staff SET active=true WHERE user_id='anna'");
      }
      await db.query(
        "DELETE FROM role_permissions WHERE role_id='Employee' AND permission_id='can_view_cases'",
      );
      try {
        assert.equal(
          await deliverCaseFollowupNotification(
            record.id,
            plan.revision,
            "anna",
            send,
          ),
          false,
        );
      } finally {
        await db.query(
          "INSERT INTO role_permissions VALUES('Employee','can_view_cases')",
        );
      }
      assert.equal(sends, 0);
    },
  );
  await t.test(
    "Worker processes scheduled follow-ups and sends only the generic Telegram reminder",
    async () => {
      await db.query("UPDATE jobs SET status='cancelled'");
      const { record, archive } = await fixture();
      const plan = await tx((c) =>
        scheduleCaseFollowup(c, anna, record.id, archive.id, today()),
      );
      await makeDue(record.id);
      await db.query(
        "UPDATE jobs SET run_at=now()-interval '1 minute' WHERE kind='case_followup' AND payload->>'caseId'=$1",
        [record.id],
      );
      assert.equal(await tick(), true);
      assert.ok((await planFor(record.id)).notified_at);
      assert.equal(telegramCalls.length, 0);
      failTelegram = true;
      await tick();
      assert.equal((await planFor(record.id)).telegram_sent_at, null);
      failTelegram = false;
      await db.query(
        "UPDATE jobs SET run_at=now()-interval '1 minute' WHERE kind='notification' AND payload->'origin'->>'id'=$1",
        [record.id],
      );
      await tick();
      assert.ok((await planFor(record.id)).telegram_sent_at);
      assert.equal(telegramCalls.length, 2);
      assert.deepEqual(telegramCalls[1], {
        chat_id: "test-anna",
        text: "Пора проверить статус дела. Подробности доступны в разделе уведомлений CRM.",
      });
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int n FROM notifications WHERE case_id=$1",
            [record.id],
          )
        ).rows[0].n,
        1,
      );
      await db.query(
        "UPDATE jobs SET status='pending',run_at=now()-interval '1 minute' WHERE kind='notification' AND payload->'origin'->>'id'=$1",
        [record.id],
      );
      await tick();
      assert.equal(telegramCalls.length, 2);
      const stale = await tx((c) =>
        scheduleCaseFollowup(c, anna, record.id, archive.id, tomorrow()),
      );
      assert.ok(stale.revision > plan.revision);
      await db.query(
        "UPDATE jobs SET status='pending',run_at=now()-interval '1 minute' WHERE kind='notification' AND payload->'origin'->>'id'=$1",
        [record.id],
      );
      await tick();
      assert.equal(telegramCalls.length, 2);
      assert.equal(
        (
          await db.query(
            "SELECT status FROM jobs WHERE kind='notification' AND payload->'origin'->>'id'=$1",
            [record.id],
          )
        ).rows[0].status,
        "cancelled",
      );
    },
  );
});

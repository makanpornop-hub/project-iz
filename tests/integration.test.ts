import { test, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
process.env.DATABASE_URL =
  "postgresql://postgres:postgres@127.0.0.1:55432/postgres";
process.env.BETTER_AUTH_SECRET =
  "test-only-secret-for-isolated-integration-suite-2026";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.S3_BUCKET = "test";
process.env.S3_ENDPOINT = "http://127.0.0.1:55433";
process.env.S3_ACCESS_KEY_ID = "test";
process.env.S3_SECRET_ACCESS_KEY = "test";
const pg = await PGlite.create();
const socket = new PGLiteSocketServer({
  db: pg,
  host: "127.0.0.1",
  port: 55432,
  maxConnections: 10,
});
await socket.start();
for (const file of (await readdir("migrations")).sort())
  await pg.exec(await readFile("migrations/" + file, "utf8"));
const objects = new Map<string, Buffer>();
const storage = createServer(async (req, res) => {
  const key = new URL(req.url!, "http://localhost").pathname;
  if (req.method === "PUT") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    objects.set(key, Buffer.concat(chunks));
    res.writeHead(200, { ETag: '"test"' });
    res.end();
  } else if (req.method === "GET") {
    res.end(objects.get(key));
  } else if (req.method === "DELETE") {
    objects.delete(key);
    res.end();
  } else res.end();
});
await new Promise<void>((r) => storage.listen(55433, "127.0.0.1", r));
const { db } = await import("../src/lib/db");
const { permissions, caseStatuses } = await import("../src/lib/domain");
const { actorFor, requireCase, AppError } = await import("../src/lib/access");
const { mutate, getData } = await import("../src/lib/service");
const { saveFile, validateFile } = await import("../src/lib/storage");
for (const p of permissions)
  await db.query("INSERT INTO permissions VALUES($1) ON CONFLICT DO NOTHING", [
    p,
  ]);
for (const s of caseStatuses)
  await db.query(
    "INSERT INTO case_statuses VALUES($1) ON CONFLICT DO NOTHING",
    [s],
  );
for (const r of ["Administrator", "Employee"])
  await db.query("INSERT INTO roles VALUES($1,$1)", [r]);
for (const p of permissions)
  await db.query("INSERT INTO role_permissions VALUES('Administrator',$1)", [
    p,
  ]);
for (const p of [
  "can_view_cases",
  "can_upload_documents",
  "can_download_documents",
  "can_create_tasks",
  "can_edit_tasks",
  "can_complete_tasks",
])
  await db.query("INSERT INTO role_permissions VALUES('Employee',$1)", [p]);
for (const [uid, role] of [
  ["admin", "Administrator"],
  ["anna", "Employee"],
  ["bob", "Employee"],
]) {
  await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$1,$2)', [
    uid,
    uid + "@test.invalid",
  ]);
  await db.query("INSERT INTO staff(user_id,role_id) VALUES($1,$2)", [
    uid,
    role,
  ]);
}
const admin = await actorFor("admin"),
  anna = await actorFor("anna"),
  bob = await actorFor("bob");

const { testContractTemplate: initialTemplate } =
  await import("./fixtures/contract-template");
objects.set("/test/initial-template", Buffer.from(initialTemplate()));
await db.query(
  "INSERT INTO contract_templates(filename,storage_key,size,created_by) VALUES('initial.docx','initial-template',$1,'admin')",
  [initialTemplate().length],
);
let case1: any, case2: any, task: any, doc: any;
await test("Database integration", async (t) => {
  t.after(async () => {
    await db.end();
    await socket.stop();
    await pg.close();
    await new Promise<void>((r) => storage.close(() => r()));
  });
  await t.test(
    "Partner groups preserve contacts and restrict editing",
    async () => {
      const group1 = await mutate(admin, {
        action: "partner-group.save",
        data: { name: "Европа" },
      });
      const group2 = await mutate(admin, {
        action: "partner-group.save",
        data: { name: "Азия" },
      });
      const details = {
        group_id: group1.id,
        name: "Партнёр тест",
        phone: "+998 90 123 45 67",
        email: "partner@test.invalid",
        country: "Франция",
        city: "Париж",
        notes: "Первая строка\nВторая строка",
      };
      const partner = await mutate(admin, {
        action: "partner.save",
        data: details,
      });
      await mutate(admin, {
        action: "partner.save",
        data: { group_id: group2.id, name: "Второй партнёр" },
      });
      let groups = (await getData(
        anna,
        "partners",
        new URLSearchParams(),
      )) as any[];
      assert.equal(
        groups.find((g) => g.id === group1.id).partners[0].notes,
        details.notes,
      );
      assert.equal(
        groups.find((g) => g.id === group1.id).partners[0].phone,
        details.phone,
      );
      assert.equal(groups.find((g) => g.id === group2.id).partners.length, 1);
      await assert.rejects(
        mutate(anna, { action: "partner.save", data: details }),
      );
      await assert.rejects(
        mutate(anna, {
          action: "partner-group.save",
          data: { name: "Запрет" },
        }),
      );
      await assert.rejects(
        mutate(admin, {
          action: "partner.save",
          data: { ...details, email: "invalid" },
        }),
      );
      await assert.rejects(
        mutate(admin, {
          action: "partner.save",
          data: { ...details, group_id: randomUUID() },
        }),
      );
      await assert.rejects(
        mutate(admin, { action: "partner-group.save", data: { name: "   " } }),
      );
      await mutate(admin, {
        action: "partner-group.save",
        data: { id: group1.id, name: "Европейские партнёры" },
      });
      await mutate(admin, {
        action: "partner.save",
        data: {
          ...details,
          id: partner.id,
          group_id: group2.id,
          city: "Лион",
          notes: "Новая заметка",
        },
      });
      groups = (await getData(
        admin,
        "partners",
        new URLSearchParams(),
      )) as any[];
      assert.equal(
        groups.find((g) => g.id === group1.id).name,
        "Европейские партнёры",
      );
      assert.equal(groups.find((g) => g.id === group1.id).partners.length, 0);
      assert.equal(groups.find((g) => g.id === group2.id).partners.length, 2);
      const updated = groups
        .find((g) => g.id === group2.id)
        .partners.find((p: any) => p.id === partner.id);
      assert.equal(updated.city, "Лион");
      assert.equal(updated.notes, "Новая заметка");
      assert.equal(updated.email, details.email);
      assert.equal(
        (
          await db.query(
            "SELECT count(*) FROM audit_logs WHERE entity='partner' AND entity_id=$1",
            [partner.id],
          )
        ).rows[0].count,
        "2",
      );
    },
  );
  await t.test(
    "Administrator can create and replace staff passwords securely",
    async () => {
      const { getAuth } = await import("../src/lib/auth");
      const password = "Initial-test-password-2026!";
      const replacement = "Replacement-test-password-2026!";
      const data = {
        name: "Password test",
        email: "password-test@test.invalid",
        role_id: "Employee",
        password,
      };
      await assert.rejects(mutate(anna, { action: "user.create", data }));
      await assert.rejects(
        mutate(admin, {
          action: "user.create",
          data: { ...data, password: "short" },
        }),
      );
      const created = await mutate(admin, { action: "user.create", data });
      const login = await getAuth().api.signInEmail({
        body: { email: data.email, password },
      });
      assert.equal(login.user.id, created.id);
      assert.equal(
        (
          await db.query(
            "SELECT count(*) FROM jobs WHERE kind='invite' AND payload->>'email'=$1",
            [data.email],
          )
        ).rows[0].count,
        "0",
      );
      const stored = (
        await db.query('SELECT password FROM account WHERE "userId"=$1', [
          created.id,
        ])
      ).rows[0].password;
      assert.notEqual(stored, password);
      await db.query(
        "INSERT INTO verification(id,identifier,value,\"expiresAt\") VALUES($1,$2,$3,now()+interval '1 hour')",
        [randomUUID(), "reset-password:old-test-link", created.id],
      );
      await assert.rejects(
        mutate(anna, {
          action: "user.password",
          data: { id: created.id, password: replacement },
        }),
      );
      await assert.rejects(
        mutate(admin, {
          action: "user.password",
          data: { id: created.id, password: "short" },
        }),
      );
      await assert.rejects(
        mutate(admin, {
          action: "user.password",
          data: { id: admin.id, password: replacement },
        }),
      );
      await mutate(admin, {
        action: "user.password",
        data: { id: created.id, password: replacement },
      });
      assert.equal(
        (
          await db.query('SELECT count(*) FROM session WHERE "userId"=$1', [
            created.id,
          ])
        ).rows[0].count,
        "0",
      );
      assert.equal(
        (
          await db.query("SELECT count(*) FROM verification WHERE value=$1", [
            created.id,
          ])
        ).rows[0].count,
        "0",
      );
      await assert.rejects(
        getAuth().api.signInEmail({ body: { email: data.email, password } }),
      );
      assert.equal(
        (
          await getAuth().api.signInEmail({
            body: { email: data.email, password: replacement },
          })
        ).user.id,
        created.id,
      );
      const audit = JSON.stringify(
        (
          await db.query("SELECT * FROM audit_logs WHERE entity_id=$1", [
            created.id,
          ])
        ).rows,
      );
      assert.equal(audit.includes(password), false);
      assert.equal(audit.includes(replacement), false);
    },
  );
  await t.test(
    "Creating two cases for one client preserves one person",
    async () => {
      case1 = await mutate(admin, {
        action: "case.create",
        data: {
          finance: { currency: "UZS", contract_amount: "100000" },
          name: "Test Person",
          country: "France",
          visa_type: "Schengen",
          responsible_id: "anna",
          deadline: "2030-09-12T18:00",
        },
      });
      case2 = await mutate(admin, {
        action: "case.create",
        data: {
          finance: { currency: "UZS", contract_amount: "100000" },
          client_id: case1.client_id,
          name: "Test Person",
          country: "UK",
          visa_type: "Visitor",
          responsible_id: "bob",
        },
      });
      assert.equal(case1.client_id, case2.client_id);
      assert.notEqual(case1.id, case2.id);
      assert.equal(
        (await db.query("SELECT count(*) FROM clients")).rows[0].count,
        "1",
      );
    },
  );
  await t.test(
    "Permissions protect case, list, detail and aggregate data",
    async () => {
      await assert.rejects(
        requireCase(anna, case2.id),
        (e: any) => e instanceof AppError && e.status === 404,
      );
      const list = await getData(anna, "cases", new URLSearchParams());
      assert.equal(list.length, 1);
      assert.equal(list[0].id, case1.id);
      await assert.rejects(
        getData(anna, "case", new URLSearchParams({ id: case2.id })),
      );
      await assert.rejects(getData(anna, "users", new URLSearchParams()));
    },
  );
  await t.test(
    "Task assignment grants access and completion revokes derived access",
    async () => {
      task = await mutate(admin, {
        action: "task.create",
        data: {
          case_id: case1.id,
          title: "Check passport",
          responsible_id: "bob",
          deadline: "2030-09-11T18:00",
          escalation_id: "admin",
        },
      });
      await requireCase(bob, case1.id);
      await mutate(bob, {
        action: "task.status",
        data: { id: task.id, status: "Completed" },
      });
      await assert.rejects(requireCase(bob, case1.id));
      assert.equal(
        (
          await db.query(
            "SELECT count(*) FROM jobs WHERE kind='reminder' AND payload->>'id'=$1 AND status='pending'",
            [task.id],
          )
        ).rows[0].count,
        "0",
      );
    },
  );
  await t.test(
    "Reopening and moving deadline cancel stale reminders",
    async () => {
      await mutate(admin, {
        action: "task.status",
        data: { id: task.id, status: "To do" },
      });
      await mutate(admin, {
        action: "task.update",
        data: {
          id: task.id,
          case_id: case1.id,
          title: "Check passport",
          responsible_id: "anna",
          escalation_id: "admin",
          deadline: "2030-09-15T18:00",
          status: "In progress",
        },
      });
      const active = (
        await db.query(
          "SELECT payload FROM jobs WHERE kind='reminder' AND payload->>'id'=$1 AND status='pending'",
          [task.id],
        )
      ).rows;
      assert.ok(active.length > 0);
      assert.ok(active.every((r) => r.payload.revision === 4));
    },
  );
  await t.test("Closing a case with open tasks is rejected", async () => {
    await assert.rejects(
      mutate(admin, {
        action: "case.update",
        data: {
          id: case1.id,
          status: "Visa approved",
          name: "Test Person",
          email: "",
          phone: "",
          country: "France",
          visa_type: "Schengen",
          responsible_id: "anna",
          escalation_id: "",
          deadline: "",
        },
      }),
      (e: any) => e.status === 409,
    );
  });
  await t.test(
    "File type spoofing and oversize uploads are rejected",
    async () => {
      await assert.rejects(validateFile(Buffer.from("hello"), "passport.pdf"));
      await assert.rejects(
        validateFile(Buffer.alloc(21 * 1024 * 1024), "passport.pdf"),
      );
    },
  );
  await t.test(
    "Uploading a new version keeps the previous file and approval separate",
    async () => {
      const objectCount = objects.size;
      const bytes = Buffer.from(
        "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF",
      );
      const v1 = await saveFile(anna, {
        caseId: case1.id,
        name: "Passport",
        type: "Passport",
        filename: "passport.pdf",
        bytes,
        source: "website",
      });
      doc = v1.document_id;
      await db.query(
        "UPDATE document_versions SET review_status='Approved',scan_status='clean' WHERE id=$1",
        [v1.id],
      );
      const v2 = await saveFile(anna, {
        caseId: case1.id,
        documentId: doc,
        name: "Passport",
        type: "Passport",
        filename: "passport-new.pdf",
        bytes,
        source: "website",
      });
      assert.equal(v2.version, 2);
      assert.equal(v2.review_status, "Uploaded");
      assert.notEqual(v1.storage_key, v2.storage_key);
      assert.equal(
        (
          await db.query(
            "SELECT count(*) FROM document_versions WHERE document_id=$1",
            [doc],
          )
        ).rows[0].count,
        "2",
      );
      assert.equal(objects.size, objectCount + 2);
      assert.ok(objects.has("/test/" + v1.storage_key));
      assert.ok(objects.has("/test/" + v2.storage_key));
      await assert.rejects(
        saveFile(bob, {
          caseId: case2.id,
          documentId: doc,
          name: "Passport",
          type: "Passport",
          filename: "p.pdf",
          bytes,
          source: "website",
        }),
      );
      assert.equal(objects.size, objectCount + 2);
      assert.ok(objects.has("/test/" + v1.storage_key));
      assert.ok(objects.has("/test/" + v2.storage_key));
    },
  );
  await t.test("Version uniqueness is enforced by the database", async () => {
    await assert.rejects(
      db.query(
        "INSERT INTO document_versions(document_id,version,filename,storage_key,mime,size,checksum,uploaded_by,source) VALUES($1,1,'p.pdf',$2,'application/pdf',1,'test','anna','website')",
        [doc, randomUUID()],
      ),
    );
  });
  await t.test("Audit log is append-only", async () => {
    const count = (await db.query("SELECT count(*) FROM audit_logs")).rows[0]
      .count;
    assert.ok(Number(count) > 0);
    await assert.rejects(db.query("UPDATE audit_logs SET action='tampered'"));
    await assert.rejects(db.query("DELETE FROM audit_logs"));
  });
  await t.test("Telegram updates are deduplicated", async () => {
    await db.query(
      "INSERT INTO telegram_updates(id,body) VALUES(123,'{}') ON CONFLICT DO NOTHING",
    );
    await db.query(
      "INSERT INTO telegram_updates(id,body) VALUES(123,'{}') ON CONFLICT DO NOTHING",
    );
    assert.equal(
      (await db.query("SELECT count(*) FROM telegram_updates")).rows[0].count,
      "1",
    );
  });
  await t.test(
    "Queued stale reminders are cancelled before Telegram delivery",
    async () => {
      await db.query(
        "UPDATE jobs SET status='cancelled' WHERE status='pending'",
      );
      const { notify, tick } = await import("../src/lib/worker");
      await notify(
        "anna",
        case1.id,
        "Old reminder",
        "Test message",
        "stale-test",
        { entity: "task", id: task.id, revision: 0 },
      );
      await tick();
      const job = (
        await db.query(
          "SELECT status FROM jobs WHERE kind='notification' ORDER BY created_at DESC LIMIT 1",
        )
      ).rows[0];
      assert.equal(job.status, "cancelled");
    },
  );
  await t.test(
    "Unavailable Telegram leaves the internal notification and schedules a retry",
    async () => {
      const { notify, tick } = await import("../src/lib/worker");
      await notify(
        "anna",
        case1.id,
        "Test reminder",
        "Test message",
        "unavailable-test",
      );
      await tick();
      const job = (
        await db.query(
          "SELECT status,attempts FROM jobs WHERE kind='notification' ORDER BY created_at DESC LIMIT 1",
        )
      ).rows[0];
      assert.equal(job.status, "pending");
      assert.equal(job.attempts, 1);
      assert.equal(
        (
          await db.query(
            "SELECT count(*) FROM notifications WHERE dedupe_key='unavailable-test'",
          )
        ).rows[0].count,
        "1",
      );
    },
  );
  await t.test(
    "Blocking staff removes sessions and denies actor resolution",
    async () => {
      await db.query(
        "INSERT INTO session(id,\"expiresAt\",token,\"userId\") VALUES('session',now()+interval '1 day','test-token','bob')",
      );
      await mutate(admin, {
        action: "user.update",
        data: { id: "bob", active: false, role_id: "Employee" },
      });
      await assert.rejects(actorFor("bob"));
      assert.equal(
        (await db.query("SELECT count(*) FROM session WHERE \"userId\"='bob'"))
          .rows[0].count,
        "0",
      );
    },
  );
  await t.test(
    "Authentication accepts active staff and rejects public registration",
    async () => {
      const { hashPassword } = await import("better-auth/crypto");
      const { getAuth } = await import("../src/lib/auth");
      await db.query(
        'INSERT INTO account(id,"accountId","providerId","userId",password) VALUES($1,$2,$3,$2,$4)',
        [
          randomUUID(),
          "admin",
          "credential",
          await hashPassword("Test-only-auth-password-2026!"),
        ],
      );
      const session = await getAuth().api.signInEmail({
        body: {
          email: "admin@test.invalid",
          password: "Test-only-auth-password-2026!",
        },
      });
      assert.ok(session.token);
      assert.equal(session.user.id, "admin");
      await db.query(
        'UPDATE "user" SET username=$1,"displayUsername"=$2 WHERE id=$3',
        ["admin", "Admin", "admin"],
      );
      const byUsername = await getAuth().api.signInUsername({
        body: { username: "Admin", password: "Test-only-auth-password-2026!" },
      });
      assert.equal(byUsername.user.id, "admin");
      await assert.rejects(
        getAuth().api.signInUsername({
          body: { username: "Admin", password: "wrong-password" },
        }),
      );
      await db.query("UPDATE staff SET active=false WHERE user_id='admin'");
      try {
        await assert.rejects(
          getAuth().api.signInUsername({
            body: {
              username: "Admin",
              password: "Test-only-auth-password-2026!",
            },
          }),
        );
      } finally {
        await db.query("UPDATE staff SET active=true WHERE user_id='admin'");
      }
      await assert.rejects(
        getAuth().api.signUpEmail({
          body: {
            name: "Unauthorized",
            email: "stranger@test.invalid",
            password: "Test-only-auth-password-2026!",
          },
        }),
      );
    },
  );
  await t.test(
    "Case creation saves finance, deposit and contract atomically and restricts task assignment",
    async () => {
      const { testContractTemplate } =
        await import("./fixtures/contract-template");
      const { writeObject } = await import("../src/lib/storage");
      const { unzipSync, strFromU8 } = await import("fflate");
      const { formatInTimeZone } = await import("date-fns-tz");
      await writeObject(
        "test-contract-template",
        testContractTemplate(),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
      const template = (
        await db.query(
          "INSERT INTO contract_templates(filename,storage_key,size,created_by) VALUES('test.docx','test-contract-template',$1,'admin') RETURNING *",
          [testContractTemplate().length],
        )
      ).rows[0];
      const finance = {
        currency: "UZS",
        contract_amount: "100000",
        initial_payment: "25000",
        payment_deadline: "2031-07-01",
        method: "CASH",
      };
      const rec = await mutate(admin, {
        action: "case.create",
        data: {
          name: "Тест договора & имя",
          country: "Spain",
          visa_type: "ВНЖ испания",
          responsible_id: "anna",
          deadline: "2031-06-15",
          finance,
          create_contract: true,
        },
      });
      assert.equal(rec.deadline.toISOString(), "2031-06-15T03:05:00.000Z");
      const stored = (
        await db.query("SELECT * FROM case_finances WHERE case_id=$1", [rec.id])
      ).rows[0];
      assert.equal(Number(stored.contract_amount), 100000);
      assert.equal(
        formatInTimeZone(
          stored.payment_deadline,
          "Asia/Tashkent",
          "yyyy-MM-dd",
        ),
        "2031-07-01",
      );
      const payment = (
        await db.query("SELECT * FROM client_payments WHERE case_id=$1", [
          rec.id,
        ])
      ).rows;
      assert.equal(payment.length, 1);
      assert.equal(Number(payment[0].amount), 25000);
      assert.equal(payment[0].type, "INITIAL");
      const generated = (
        await db.query("SELECT * FROM generated_contracts WHERE case_id=$1", [
          rec.id,
        ])
      ).rows[0];
      assert.equal(generated.template_id, template.id);
      assert.equal(generated.values.CLIENT_NAME, "Тест договора & имя");
      assert.equal(
        generated.values.DATE,
        formatInTimeZone(new Date(), "Asia/Tashkent", "dd.MM.yyyy"),
      );
      const { downloadContract } = await import("../src/lib/contracts");
      const download = await downloadContract(admin, rec.id);
      assert.match(
        strFromU8(unzipSync(download.bytes)["word/document.xml"]),
        /Тест договора &amp; имя/,
      );
      await assert.rejects(downloadContract(anna, rec.id));
      const full = await mutate(admin, {
        action: "case.create",
        data: {
          name: "Полная оплата тест",
          country: "Spain",
          visa_type: "Shengen",
          responsible_id: "anna",
          finance: { ...finance, initial_payment: "100000" },
        },
      });
      assert.equal(
        (
          await db.query(
            "SELECT payment_deadline FROM case_finances WHERE case_id=$1",
            [full.id],
          )
        ).rows[0].payment_deadline,
        null,
      );
      const before = Number(
        (await db.query("SELECT count(*) FROM cases")).rows[0].count,
      );
      await assert.rejects(
        mutate(admin, {
          action: "case.create",
          data: {
            name: "Не создаётся",
            country: "Spain",
            visa_type: "Shengen",
            responsible_id: "anna",
            finance: { ...finance, initial_payment: "100001" },
          },
        }),
      );
      assert.equal(
        Number((await db.query("SELECT count(*) FROM cases")).rows[0].count),
        before,
      );
      const ticket = (
        await db.query(
          "SELECT * FROM tasks WHERE case_id=$1 AND title='Назначить дату билета в Испанию'",
          [rec.id],
        )
      ).rows[0];
      const employeeWithAssign = {
        ...anna,
        permissions: [...anna.permissions, "can_assign_tasks"],
      } as any;
      await assert.rejects(
        mutate(employeeWithAssign, {
          action: "task.update",
          data: {
            ...ticket,
            responsible_id: "bob",
            deadline: "2031-06-15T08:05",
            escalation_id: "",
          },
        }),
        /только администратор или менеджер/,
      );
      const taskPage = await getData(
        anna,
        "task",
        new URLSearchParams({ id: ticket.id }),
      );
      assert.equal(taskPage.task.id, ticket.id);
      assert.equal(taskPage.staff.length, 0);
      const changed = await mutate(
        { ...admin, role: "Manager" },
        {
          action: "task.update",
          data: {
            ...ticket,
            responsible_id: "admin",
            escalation_id: "anna",
            deadline: "2031-06-15T08:05",
          },
        },
      );
      assert.equal(changed.responsible_id, "admin");
      await assert.rejects(
        mutate(admin, {
          action: "task.update",
          data: {
            ...ticket,
            revision: ticket.revision,
            escalation_id: "",
            deadline: "2031-06-15T09:05",
          },
        }),
        /изменилась/,
      );
    },
  );
  await t.test(
    "Spain document workflow creates tasks, merges in order, and requires administrator approval",
    async () => {
      const { PDFDocument } = await import("pdf-lib");
      const { workflowData, workflowAction, mergeFresh, checkComplete } =
        await import("../src/lib/workflow");
      const { mergeGroup } = await import("../src/lib/merge-documents");
      const { readObject } = await import("../src/lib/storage");
      const args = {
        finance: { currency: "UZS", contract_amount: "100000" },
        name: "Spain workflow test",
        country: "Spain",
        visa_type: "ВНЖ испания",
        responsible_id: "anna",
      };

      const rec = await mutate(admin, {
        action: "case.create",
        data: args,
      });
      let wf = await workflowData(rec.id);
      assert.equal(wf.groups.length, 15);
      const { workflowIssues } = await import("../src/lib/workflow-validation");
      const missing = workflowIssues(wf);
      assert.equal(missing[0].id, wf.groups[0].fields[0].id);
      assert.ok(missing.some((i) => i.id === wf.groups.at(-1).fields[0].id));
      assert.equal(wf.archive, null);
      assert.deepEqual(
        wf.groups[0].fields.map((f: any) => f.name),
        [
          "Диплом",
          "Апостель",
          "Легализация через посольства",
          "Jurado перевод",
          "Пояснительное письмо",
        ],
      );
      const tasks = (
        await db.query("SELECT * FROM tasks WHERE case_id=$1", [rec.id])
      ).rows;
      assert.equal(tasks.length, 2);
      const ticket = tasks.find(
        (t) => t.title === "Назначить дату билета в Испанию",
      );
      assert.equal(ticket.deadline, null);
      const scheduledTicket = await mutate(anna, {
        action: "task.update",
        data: {
          id: ticket.id,
          case_id: rec.id,
          title: ticket.title,
          responsible_id: ticket.responsible_id,
          deadline: "2031-06-15T16:00",
        },
      });
      assert.ok(scheduledTicket.deadline);
      assert.ok(
        (
          await db.query(
            "SELECT 1 FROM jobs WHERE kind='reminder' AND payload->>'id'=$1 AND status='pending'",
            [ticket.id],
          )
        ).rowCount,
      );
      assert.equal(tasks.find((t) => t.id === wf.task_id).deadline, null);
      assert.equal(await workflowData(case1.id), null);
      await assert.rejects(
        workflowAction(anna, {
          action: "workflow.submit",
          data: { case_id: rec.id, check_date: "2031-07-01" },
        }),
      );
      await assert.rejects(
        workflowAction(bob, {
          action: "workflow.criminal",
          data: { case_id: rec.id },
        }),
      );
      await workflowAction(anna, {
        action: "workflow.criminal",
        data: { case_id: rec.id },
      });
      wf = await workflowData(rec.id);
      assert.ok(
        wf.groups.some((g: any) => g.name === "Справка о несудимости2"),
      );
      const business = wf.groups.find((g: any) => g.kind === "business");
      await workflowAction(anna, {
        action: "workflow.stamp",
        data: { case_id: rec.id, group_id: business.id, stamp: false },
      });
      const diploma = wf.groups.find((g: any) => g.name === "диплом");
      await assert.rejects(
        mutate(admin, {
          action: "document.archive",
          data: { id: diploma.fields[0].id, archived: true },
        }),
      );
      const pdfBytes = async (width: number) => {
        const pdf = await PDFDocument.create();
        pdf.addPage([width, 500]);
        return Buffer.from(await pdf.save());
      };
      const clean = async (id: string) =>
        db.query(
          "UPDATE document_versions SET scan_status='clean' WHERE id=$1",
          [id],
        );
      for (const g of wf.groups) {
        for (const f of g.fields) {
          if (!f.required) continue;
          const v = await saveFile(anna, {
            caseId: rec.id,
            documentId: f.id,
            name: f.name,
            type: "Other",
            filename: "test.pdf",
            bytes: await pdfBytes(f.merge_order ? 300 + f.merge_order : 500),
            source: "website",
          });
          if (g.id === diploma.id && f.merge_order === 1)
            await assert.rejects(
              mergeGroup(anna, { case_id: rec.id, group_id: g.id }),
            );
          await clean(v.id);
        }
        if (g.fields.some((f: any) => f.merge_order)) {
          const merged = await mergeGroup(anna, {
            case_id: rec.id,
            group_id: g.id,
          });
          const version = (
            await db.query("SELECT * FROM document_versions WHERE id=$1", [
              merged.id,
            ])
          ).rows[0];
          assert.equal(version.scan_status, "pending");
          const result = await PDFDocument.load(
            await readObject(version.storage_key),
          );
          assert.deepEqual(
            result.getPages().map((p) => p.getWidth()),
            [301, 302, 303, 304],
          );
          await clean(merged.id);
        }
      }
      wf = await workflowData(rec.id);
      checkComplete(wf);
      const source = diploma.fields.find((f: any) => f.merge_order === 2);
      await assert.rejects(
        saveFile(anna, {
          caseId: rec.id,
          documentId: diploma.output.id,
          name: "manual result",
          type: "Other",
          filename: "test.pdf",
          bytes: await pdfBytes(450),
          source: "website",
        }),
      );
      const newer = await saveFile(anna, {
        caseId: rec.id,
        documentId: source.id,
        name: source.name,
        type: "Other",
        filename: "new.pdf",
        bytes: await pdfBytes(450),
        source: "website",
      });
      await clean(newer.id);
      wf = await workflowData(rec.id);
      assert.equal(
        mergeFresh(wf.groups.find((g: any) => g.id === diploma.id)),
        false,
      );
      await assert.rejects(
        workflowAction(anna, {
          action: "workflow.submit",
          data: { case_id: rec.id, check_date: "2031-07-01" },
        }),
      );
      const merged = await mergeGroup(anna, {
        case_id: rec.id,
        group_id: diploma.id,
      });
      await clean(merged.id);
      const destination = await (
        await import("../src/lib/telegram-settings")
      ).telegramChatSettings();
      await db.query(
        "INSERT INTO system_settings(id,value) VALUES('telegram',$1)",
        [
          JSON.stringify({
            ...destination,
            workflowChatId: "-100991100001",
            revision: 1,
          }),
        ],
      );
      try {
        await workflowAction(anna, {
          action: "workflow.submit",
          data: { case_id: rec.id, check_date: "2031-07-01" },
        });
        assert.equal(
          (
            await db.query(
              "SELECT telegram_chat_id FROM workflow_archives WHERE case_id=$1",
              [rec.id],
            )
          ).rows[0].telegram_chat_id,
          "-100991100001",
        );
      } finally {
        await db.query("DELETE FROM system_settings WHERE id='telegram'");
      }
      wf = await workflowData(rec.id);
      assert.equal(wf.state, "submitted");
      assert.ok(wf.archive?.id);
      const archiveId = wf.archive.id;
      const followup = (
        await getData(anna, "case", new URLSearchParams({ id: rec.id }))
      ).followup;
      assert.equal(
        (await db.query("SELECT status FROM cases WHERE id=$1", [rec.id]))
          .rows[0].status,
        "Under review",
      );
      assert.equal(followup.archive_id, archiveId);
      assert.equal(
        new Date(followup.check_at).toISOString(),
        "2031-07-01T04:00:00.000Z",
      );
      await assert.rejects(
        workflowAction(anna, {
          action: "workflow.submit",
          data: { case_id: rec.id },
        }),
      );
      await assert.rejects(
        workflowAction(anna, {
          action: "workflow.submit",
          data: { case_id: rec.id, check_date: "2020-01-01" },
        }),
      );
      assert.equal((await workflowData(rec.id)).archive.id, archiveId);
      await workflowAction(anna, {
        action: "workflow.reschedule",
        data: {
          case_id: rec.id,
          check_date: "2031-07-02",
          revision: followup.revision,
        },
      });
      const moved = (
        await getData(anna, "case", new URLSearchParams({ id: rec.id }))
      ).followup;
      assert.equal(
        new Date(moved.check_at).toISOString(),
        "2031-07-02T04:00:00.000Z",
      );
      assert.equal((await workflowData(rec.id)).state, "submitted");
      await assert.rejects(
        workflowAction(anna, {
          action: "workflow.reschedule",
          data: {
            case_id: rec.id,
            check_date: "2031-07-03",
            revision: followup.revision,
          },
        }),
        /изменилась/,
      );

      const { downloadWorkflowArchive } =
        await import("../src/lib/workflow-archive");
      const { unzipSync } = await import("fflate");
      const archiveDownload = await downloadWorkflowArchive(anna, archiveId);
      const unpacked = unzipSync(archiveDownload.bytes);
      const packageFields = wf.groups
        .flatMap((g: any) => [...g.fields, g.output])
        .filter((f: any) => f?.latest);
      assert.equal(Object.keys(unpacked).length, packageFields.length);
      assert.equal(wf.archive.file_count, packageFields.length);
      assert.ok(
        Object.keys(unpacked).some((name) => name.includes(diploma.name + "/")),
      );
      for (const f of packageFields) {
        const original = await db.query(
          "SELECT storage_key FROM document_versions WHERE id=$1",
          [f.latest.id],
        );
        const originalBytes = await readObject(original.rows[0].storage_key);
        assert.ok(
          Object.values(unpacked).some((bytes) =>
            Buffer.from(bytes).equals(originalBytes),
          ),
        );
      }
      await assert.rejects(downloadWorkflowArchive(bob, archiveId));
      const unscannedId = packageFields[0].latest.id;
      await db.query(
        "UPDATE document_versions SET scan_status='infected' WHERE id=$1",
        [unscannedId],
      );
      await assert.rejects(
        downloadWorkflowArchive(anna, archiveId),
        /заблокирован/,
      );
      await clean(unscannedId);
      assert.equal(
        (await db.query("SELECT status FROM tasks WHERE id=$1", [wf.task_id]))
          .rows[0].status,
        "In progress",
      );
      assert.equal(
        (
          await db.query(
            "SELECT count(*) FROM notifications WHERE case_id=$1 AND user_id='admin'",
            [rec.id],
          )
        ).rows[0].count,
        "1",
      );
      await workflowAction(anna, {
        action: "workflow.submit",
        data: { case_id: rec.id, check_date: "2031-07-01" },
      });
      assert.equal((await workflowData(rec.id)).archive.id, archiveId);
      const { deliverWorkflowArchive } =
        await import("../src/lib/workflow-archive-delivery");
      const originalFetch = globalThis.fetch,
        oldToken = process.env.TELEGRAM_BOT_TOKEN;
      let deliveries = 0;
      process.env.TELEGRAM_BOT_TOKEN = "test-token";
      globalThis.fetch = async (input: any, init: any) => {
        if (String(input).startsWith("https://api.telegram.org/")) {
          deliveries++;
          assert.equal(init.body.get("chat_id"), "-100991100001");
          assert.ok(init.body.get("document") instanceof Blob);
          return Response.json({ ok: true, result: { message_id: 456 } });
        }
        return originalFetch(input, init);
      };
      try {
        await deliverWorkflowArchive(archiveId);
        await deliverWorkflowArchive(archiveId);
        assert.equal(deliveries, 1);
      } finally {
        globalThis.fetch = originalFetch;
        if (oldToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
        else process.env.TELEGRAM_BOT_TOKEN = oldToken;
      }
      const replacement = await saveFile(anna, {
        caseId: rec.id,
        documentId: source.id,
        name: source.name,
        type: "Other",
        filename: "updated.pdf",
        bytes: await pdfBytes(500),
        source: "website",
      });
      await clean(replacement.id);
      assert.equal((await workflowData(rec.id)).state, "draft");
      const updatedMerge = await mergeGroup(anna, {
        case_id: rec.id,
        group_id: diploma.id,
      });
      await clean(updatedMerge.id);
      await workflowAction(anna, {
        action: "workflow.submit",
        data: { case_id: rec.id, check_date: "2031-07-01" },
      });
      wf = await workflowData(rec.id);
      assert.notEqual(wf.archive.id, archiveId);
      await assert.rejects(
        mutate(admin, {
          action: "task.status",
          data: { id: wf.task_id, status: "Completed" },
        }),
      );
      await assert.rejects(
        workflowAction(anna, {
          action: "workflow.review",
          data: { case_id: rec.id, decision: "approve", revision: wf.revision },
        }),
      );
      await assert.rejects(
        workflowAction(admin, {
          action: "workflow.review",
          data: {
            case_id: rec.id,
            decision: "approve",
            revision: wf.revision - 1,
          },
        }),
      );
      await assert.rejects(
        workflowAction(admin, {
          action: "workflow.review",
          data: { case_id: rec.id, decision: "approve", revision: wf.revision },
        }),
      );
      const uploaded = wf.groups
        .flatMap((g: any) => [...g.fields, g.output])
        .filter((f: any) => f?.latest);
      const sample = uploaded[0].latest;
      assert.equal(
        (
          await mutate(anna, {
            action: "document.open",
            data: { id: sample.id },
          })
        ).review_status,
        "Uploaded",
      );
      await assert.rejects(
        mutate(anna, {
          action: "document.review",
          data: { id: sample.id, status: "Approved" },
        }),
      );
      await assert.rejects(
        mutate(admin, {
          action: "document.review",
          data: { id: sample.id, status: "Approved" },
        }),
      );
      for (const field of uploaded) {
        assert.equal(
          (
            await mutate(admin, {
              action: "document.open",
              data: { id: field.latest.id },
            })
          ).review_status,
          "Under review",
        );
        await mutate(admin, {
          action: "document.review",
          data: { id: field.latest.id, status: "Approved" },
        });
        assert.equal(
          (
            await mutate(admin, {
              action: "document.open",
              data: { id: field.latest.id },
            })
          ).review_status,
          "Approved",
        );
      }
      const bulkGroup = (await workflowData(rec.id)).groups[0];
      const bulkIds = [...bulkGroup.fields, bulkGroup.output]
        .filter(Boolean)
        .map((f: any) => f.latest?.id)
        .filter(Boolean);
      const bulk = {
        action: "workflow.approveGroup",
        data: { case_id: rec.id, group_id: bulkGroup.id, version_ids: bulkIds },
      };
      await assert.rejects(workflowAction(anna, bulk));
      await assert.rejects(
        workflowAction(admin, {
          ...bulk,
          data: { ...bulk.data, version_ids: [randomUUID()] },
        }),
      );
      await db.query(
        "UPDATE document_versions SET review_status='Uploaded',scan_status='pending' WHERE id=$1",
        [bulkIds[0]],
      );
      await assert.rejects(workflowAction(admin, bulk));
      await db.query(
        "UPDATE document_versions SET scan_status='clean' WHERE id=$1",
        [bulkIds[0]],
      );
      await workflowAction(admin, bulk);
      await workflowAction(admin, bulk);
      assert.equal(
        (
          await db.query(
            "SELECT review_status FROM document_versions WHERE id=$1",
            [bulkIds[0]],
          )
        ).rows[0].review_status,
        "Approved",
      );
      await workflowAction(admin, {
        action: "workflow.review",
        data: { case_id: rec.id, decision: "approve", revision: wf.revision },
      });
      assert.equal(
        (await db.query("SELECT status FROM tasks WHERE id=$1", [wf.task_id]))
          .rows[0].status,
        "Completed",
      );
      wf = await workflowData(rec.id);
      assert.equal(wf.state, "approved");
      assert.equal(
        (await db.query("SELECT status FROM cases WHERE id=$1", [rec.id]))
          .rows[0].status,
        "Ready for submission",
      );
      await workflowAction(anna, {
        action: "workflow.submit",
        data: { case_id: rec.id, check_date: "2031-07-01" },
      });
      assert.equal(
        (await db.query("SELECT status FROM cases WHERE id=$1", [rec.id]))
          .rows[0].status,
        "Ready for submission",
      );
      assert.equal((await workflowData(rec.id)).archive.id, wf.archive.id);
      await workflowAction(admin, {
        action: "workflow.review",
        data: {
          case_id: rec.id,
          decision: "reject",
          revision: wf.revision,
          note: "Уточнить перевод",
        },
      });
      wf = await workflowData(rec.id);
      assert.equal(wf.state, "rejected");
      assert.equal(
        (await db.query("SELECT status FROM cases WHERE id=$1", [rec.id]))
          .rows[0].status,
        "Documents collecting",
      );
      assert.equal(
        (await db.query("SELECT status FROM tasks WHERE id=$1", [wf.task_id]))
          .rows[0].status,
        "In progress",
      );
      await workflowAction(anna, {
        action: "workflow.submit",
        data: { case_id: rec.id, check_date: "2031-07-01" },
      });
      const resubmitted = await workflowData(rec.id);
      assert.notEqual(resubmitted.archive.id, archiveId);
      assert.equal(
        (
          await db.query(
            "SELECT count(*) FROM workflow_archives WHERE case_id=$1",
            [rec.id],
          )
        ).rows[0].count,
        "3",
      );
    },
  );
  await t.test(
    "Workflow group editing and notes keep fields scoped to the case",
    async () => {
      const { workflowData, workflowAction } =
        await import("../src/lib/workflow");
      const rec = await mutate(admin, {
        action: "case.create",
        data: {
          finance: { currency: "UZS", contract_amount: "100000" },
          name: "Editable workflow",
          country: "Spain",
          visa_type: "ВНЖ испания",
          responsible_id: "anna",
        },
      });
      let wf = await workflowData(rec.id);
      const company = wf.groups.find((g: any) => g.kind === "company");
      await workflowAction(anna, {
        action: "workflow.notes",
        data: {
          case_id: rec.id,
          group_id: company.id,
          notes: "Контактное лицо\nУсловия договора",
        },
      });
      await workflowAction(anna, {
        action: "workflow.group",
        data: {
          case_id: rec.id,
          name: "Дополнительная группа",
          fields: [
            { name: "Дополнительный файл", required: false, merge_order: null },
          ],
        },
      });
      wf = await workflowData(rec.id);
      assert.equal(wf.groups.length, 16);
      assert.equal(
        wf.groups.find((g: any) => g.id === company.id).notes,
        "Контактное лицо\nУсловия договора",
      );
      const group = wf.groups.find(
        (g: any) => g.name === "Дополнительная группа",
      );
      await workflowAction(anna, {
        action: "workflow.group",
        data: {
          case_id: rec.id,
          id: group.id,
          name: "Уточнённая группа",
          fields: group.fields.map((f: any) => ({
            id: f.id,
            name: "Уточнённое поле",
            required: true,
            merge_order: 1,
          })),
        },
      });
      wf = await workflowData(rec.id);
      assert.equal(
        wf.groups.find((g: any) => g.id === group.id).fields[0].name,
        "Уточнённое поле",
      );
      await assert.rejects(
        workflowAction(anna, {
          action: "workflow.group",
          data: {
            case_id: rec.id,
            id: company.id,
            name: "Ошибка",
            fields: [
              { id: group.fields[0].id, name: "Чужое поле", required: true },
            ],
          },
        }),
      );
      const deadlines = (await getData(
        anna,
        "deadlines",
        new URLSearchParams(),
      )) as any[];
      assert.ok(deadlines.every((d) => d.deadline));
    },
  );
  await t.test(
    "Telegram checklist selection saves automatically and isolates upload sessions",
    async () => {
      const { processUpdate, performUpload } =
        await import("../src/lib/telegram");
      const { workflowData } = await import("../src/lib/workflow");
      const { PDFDocument } = await import("pdf-lib");
      const rec = await mutate(admin, {
        action: "case.create",
        data: {
          finance: { currency: "UZS", contract_amount: "100000" },
          name: "Bot checklist test",
          phone: "+998901234567",
          email: "bot@test.invalid",
          country: "Spain",
          visa_type: "ВНЖ испания",
          responsible_id: "anna",
        },
      });
      const clients = (await getData(
        admin,
        "clients",
        new URLSearchParams(),
      )) as any[];
      assert.equal(
        clients.find((c) => c.id === rec.client_id).phone,
        "+998901234567",
      );
      const wf = await workflowData(rec.id);
      const diploma = wf.groups[0];
      const target = diploma.fields[0];
      const pdf = await PDFDocument.create();
      pdf.addPage();
      const bytes = Buffer.from(await pdf.save());
      await db.query(
        "INSERT INTO telegram_links(user_id,telegram_id) VALUES('anna','991001') ON CONFLICT(user_id) DO UPDATE SET telegram_id='991001'",
      );
      const oldFetch = globalThis.fetch,
        oldToken = process.env.TELEGRAM_BOT_TOKEN;
      const messages: any[] = [];
      process.env.TELEGRAM_BOT_TOKEN = "isolated-test";
      globalThis.fetch = async (input, init) => {
        const url = String(input);
        if (!url.startsWith("https://api.telegram.org/"))
          return oldFetch(input, init);
        if (url.includes("/file/bot")) return new Response(bytes);
        const body = JSON.parse(String(init?.body));
        if (url.endsWith("/sendMessage")) messages.push(body);
        return Response.json({
          ok: true,
          result: url.endsWith("/getFile")
            ? { file_path: "fixture.pdf" }
            : { message_id: 1 },
        });
      };
      let sequence = 92000;
      const from = { id: 991001 },
        chat = { id: 991001, type: "private" };
      const send = async () => {
        const id = ++sequence;
        await db.query(
          "INSERT INTO telegram_updates(id,body) VALUES($1,'{}')",
          [id],
        );
        await processUpdate({
          update_id: id,
          message: {
            from,
            chat,
            document: {
              file_id: "fixture",
              file_name: "fixture.pdf",
              file_size: bytes.length,
            },
          },
        });
        return (
          await db.query("SELECT * FROM telegram_uploads WHERE update_id=$1", [
            id,
          ])
        ).rows[0];
      };
      const buttons = () => messages.at(-1).reply_markup.inline_keyboard.flat();
      const pick = (label: string) => {
        const b = buttons().find(
          (b: any) => b.text === label || b.text.includes(label),
        );
        assert.ok(b, label);
        return b.callback_data;
      };
      const click = async (data: string) => {
        assert.ok(Buffer.byteLength(data) <= 64);
        await processUpdate({
          callback_query: {
            id: String(++sequence),
            from,
            message: { chat },
            data,
          },
        });
      };
      try {
        const first = await send();
        await click(pick("Bot checklist test"));
        assert.equal(
          buttons().filter((b: any) => b.callback_data.startsWith("group:"))
            .length,
          15,
        );
        await click(pick(diploma.name));
        assert.equal(
          buttons().filter((b: any) => b.callback_data.startsWith("doc:"))
            .length,
          diploma.fields.length,
        );
        const fieldButton = pick(target.name);
        await click(fieldButton);
        assert.equal(
          (
            await db.query("SELECT state FROM telegram_uploads WHERE id=$1", [
              first.id,
            ])
          ).rows[0].state,
          "queued",
        );
        await click(fieldButton);
        assert.equal(
          (
            await db.query("SELECT count(*) FROM jobs WHERE dedupe_key=$1", [
              "tg-upload:" + first.id,
            ])
          ).rows[0].count,
          "1",
        );
        const second = await send();
        const caseButton = pick("Bot checklist test");
        await click(fieldButton);
        assert.equal(
          (
            await db.query("SELECT case_id FROM telegram_uploads WHERE id=$1", [
              second.id,
            ])
          ).rows[0].case_id,
          null,
        );
        await performUpload(first.id);
        await performUpload(first.id);
        assert.equal(
          (await db.query("SELECT status FROM cases WHERE id=$1", [rec.id]))
            .rows[0].status,
          "Contract signing",
        );
        const list = (await getData(
          admin,
          "cases",
          new URLSearchParams({ q: "Bot checklist test" }),
        )) as any[];
        const item = list.find((c) => c.id === rec.id);
        assert.equal(item.documents_loaded, 1);
        assert.equal(
          item.documents_total,
          wf.groups.flatMap((g: any) => g.fields).filter((f: any) => f.required)
            .length,
        );
        const versions = (
          await db.query(
            "SELECT * FROM document_versions WHERE document_id=$1",
            [target.id],
          )
        ).rows;
        assert.equal(versions.length, 1);
        assert.equal(versions[0].review_status, "Uploaded");
        assert.equal(versions[0].scan_status, "pending");
        await click(caseButton);
        await click(pick("Новый документ вне перечня"));
        await click(pick("Паспорт"));
        await performUpload(second.id);
        assert.equal(
          (
            await db.query(
              "SELECT count(*) FROM documents WHERE case_id=$1 AND group_id IS NULL",
              [rec.id],
            )
          ).rows[0].count,
          "1",
        );
        const third = await send();
        await click(pick("Bot checklist test"));
        await click(pick(diploma.name));
        const thirdField = pick(target.name);
        const outputCallback =
          thirdField.split(":").slice(0, 2).join(":") +
          ":" +
          Buffer.from(diploma.output.id.replaceAll("-", ""), "hex").toString(
            "base64url",
          );
        await assert.rejects(click(outputCallback), /Документ недоступен/);
        await db.query(
          "UPDATE case_workflows SET state='submitted' WHERE case_id=$1",
          [rec.id],
        );
        await click(thirdField);
        await performUpload(third.id);
        assert.equal(
          (
            await db.query(
              "SELECT state FROM case_workflows WHERE case_id=$1",
              [rec.id],
            )
          ).rows[0].state,
          "draft",
        );
        const fourth = await send();
        await processUpdate({ message: { from, chat, text: "/cancel" } });
        await click(thirdField);
        assert.equal(
          (
            await db.query("SELECT state FROM telegram_uploads WHERE id=$1", [
              fourth.id,
            ])
          ).rows[0].state,
          "cancelled",
        );
        assert.ok(
          messages.every(
            (m) =>
              !m.text.includes("Откройте дело на сайте") &&
              !JSON.stringify(m).includes("Подтвердить загрузку"),
          ),
        );
      } finally {
        globalThis.fetch = oldFetch;
        if (oldToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
        else process.env.TELEGRAM_BOT_TOKEN = oldToken;
      }
    },
  );
  await t.test(
    "Accounting transactions, permissions, events and reports",
    async (at) => {
      const {
        accountingData,
        checkFinanceDeadlines,
        deliverFinancialEvent,
        financeRows,
      } = await import("../src/lib/accounting");
      const { PDFDocument } = await import("pdf-lib");
      const rec = await mutate(admin, {
        action: "case.create",
        data: {
          finance: { currency: "UZS", contract_amount: "100000" },
          name: "Accounting client",
          phone: "+998900000001",
          country: "Spain",
          visa_type: "Shengen",
          responsible_id: "anna",
        },
      });
      const other = await mutate(admin, {
        action: "case.create",
        data: {
          finance: { currency: "UZS", contract_amount: "100000" },
          client_id: rec.client_id,
          name: "Accounting client",
          country: "France",
          visa_type: "Shengen",
          responsible_id: "anna",
        },
      });
      const get = () =>
        accountingData(admin, new URLSearchParams({ case_id: rec.id }));
      const summary = async () => (await get()).cases[0];
      const action = (name: string, data: any) =>
        mutate(admin, {
          action: "accounting." + name,
          data: { case_id: rec.id, ...data },
        });
      const contract = async (value: string, deadline: string) =>
        action("contract.save", {
          contract_amount: value,
          payment_deadline: deadline,
          revision: (await summary()).revision,
        });
      const payment = async (
        amount: string,
        type = "ADDITIONAL",
        extra: any = {},
      ) =>
        action("payment.save", {
          amount,
          type,
          date: "2030-05-10",
          method: "CASH",
          request_key: randomUUID(),
          ...extra,
        });
      const type = (await get()).types[0];
      const expense = async (amount: string, extra: any = {}) =>
        action("expense.save", {
          amount,
          expense_type_id: type.id,
          date: "2030-05-10",
          method: "TRANSFER",
          request_key: randomUUID(),
          ...extra,
        });
      await at.test(
        "Currencies, fixed operation rates, inline editing and client expense scope",
        async () => {
          const originalFetch = globalThis.fetch;
          let usdRate = "12000";
          globalThis.fetch = async () =>
            Response.json([
              { Ccy: "USD", Rate: usdRate, Nominal: "1", Date: "01.01.2020" },
              { Ccy: "EUR", Rate: "14000", Nominal: "1", Date: "01.01.2020" },
            ]);
          try {
            const key = randomUUID();
            await payment("100", "ADDITIONAL", {
              currency: "USD",
              date: "2020-01-01",
              request_key: key,
            });
            let op = (await get()).payments.find(
              (p: any) => p.request_key === key,
            );
            assert.equal(op.original_amount, "100.00");
            assert.equal(op.amount, "1200000.00");
            usdRate = "13000";
            await action("payment.save", {
              ...op,
              amount: "101",
              date: "2020-01-01",
              comment: "edit",
            });
            op = (await get()).payments.find((p: any) => p.request_key === key);
            assert.equal(op.amount, "1212000.00");
            assert.equal(op.exchange_rate, "12000.00000000");
            await assert.rejects(
              payment("102", "ADDITIONAL", {
                currency: "USD",
                date: "2020-01-01",
                request_key: key,
              }),
            );
            const correction = {
              amount: "600000",
              expected: (await summary()).paid,
              request_key: randomUUID(),
            };
            await action("received.save", correction);
            await action("received.save", correction);
            assert.equal((await summary()).paid, "600000.00");
            assert.equal((await summary()).balance_status, "LOW_BALANCE");
            await assert.rejects(
              action("received.save", {
                ...correction,
                request_key: randomUUID(),
              }),
            );
            await action("contract.save", {
              contract_amount: "1000",
              currency: "EUR",
              payment_deadline: "2030-01-01",
              revision: (await summary()).revision,
              responsible_id: "admin",
              case_revision: (await summary()).case_revision,
            });
            const row = await summary();
            assert.equal(row.contract_amount, "14000000.00");
            assert.equal(row.responsible_id, "admin");
            const scoped = await accountingData(
              admin,
              new URLSearchParams({ client_id: rec.client_id }),
            );
            assert.equal(scoped.cases.length, 2);
            assert.ok(
              scoped.cases.every((r: any) => r.client_id === rec.client_id),
            );
            for (const p of (await get()).payments)
              await action("payment.delete", {
                id: p.id,
                revision: p.revision,
              });
            await action("contract.save", {
              contract_amount: "",
              currency: "UZS",
              payment_deadline: "",
              revision: (await summary()).revision,
              responsible_id: "anna",
              case_revision: (await summary()).case_revision,
            });
          } finally {
            globalThis.fetch = originalFetch;
          }
        },
      );
      await at.test(
        "Contract deposit is atomic, full payment removes deadline, partial payment keeps it",
        async () => {
          await action("contract.save", {
            contract_amount: "1000",
            currency: "UZS",
            initial_payment: "1000",
            payment_deadline: "2030-01-01",
            revision: (await summary()).revision,
          });
          let row = await summary();
          assert.equal(row.paid, "1000.00");
          assert.equal(row.initial_payment, "1000.00");
          assert.equal(row.payment_deadline, null);
          await assert.rejects(
            action("contract.save", {
              contract_amount: "1000",
              currency: "UZS",
              initial_payment: "1000",
              payment_deadline: "2030-01-01",
              revision: row.revision,
            }),
          );
          for (const p of (await get()).payments.filter(
            (p: any) => !p.deleted_at,
          ))
            await action("payment.delete", { id: p.id, revision: p.revision });
          await action("contract.save", {
            contract_amount: "1000",
            currency: "UZS",
            initial_payment: "500",
            payment_deadline: "2030-01-01",
            revision: (await summary()).revision,
          });
          row = await summary();
          assert.equal(row.paid, "500.00");
          assert.equal(row.payment_deadline, "2030-01-01");
          for (const p of (await get()).payments.filter(
            (p: any) => !p.deleted_at,
          ))
            await action("payment.delete", { id: p.id, revision: p.revision });
        },
      );
      await at.test(
        "Payments and expenses are isolated per case; refunds and corrections recalculate",
        async () => {
          await contract("10000000", "2000-01-01");
          await payment("5000000", "INITIAL");
          await expense("6000000");
          let r = await summary();
          assert.equal(r.financial_status, "FINANCIAL_ATTENTION");
          assert.equal(r.remaining, "5000000.00");
          assert.equal(r.expense_deficit, "1000000.00");
          assert.equal(r.initial_payment, "5000000.00");
          assert.equal(r.initial_date, "2030-05-10");
          assert.equal(
            (
              await accountingData(
                admin,
                new URLSearchParams({ case_id: other.id }),
              )
            ).cases[0].paid,
            "0",
          );
          await payment("3000000");
          r = await summary();
          assert.equal(r.financial_status, "PAYMENT_OVERDUE");
          assert.ok(!r.warnings.includes("EXPENSES_EXCEED_PAYMENTS"));
          await payment("2000000", "FULL");
          r = await summary();
          assert.equal(r.financial_status, "PAID");
          assert.equal(r.remaining, "0.00");
          await payment("1000000", "REFUND");
          assert.equal((await summary()).paid, "9000000.00");
          const refund = (await get()).payments.find(
            (p: any) => p.type === "REFUND",
          );
          await action("payment.delete", {
            id: refund.id,
            revision: refund.revision,
          });
          assert.equal((await summary()).financial_status, "PAID");
          assert.ok(
            (await get()).payments.find((p: any) => p.id === refund.id)
              .deleted_at,
          );
          await payment("500000");
          assert.equal((await summary()).remaining, "-500000.00");
          const e = (await get()).expenses[0];
          await expense("12000000", { id: e.id, revision: e.revision });
          assert.equal(
            (await summary()).financial_status,
            "EXPENSES_EXCEED_PAYMENTS",
          );
          const latest = (await get()).expenses[0];
          await action("expense.delete", {
            id: latest.id,
            revision: latest.revision,
          });
          assert.equal((await summary()).financial_status, "PAID");
          assert.equal(
            (await db.query("SELECT status FROM cases WHERE id=$1", [rec.id]))
              .rows[0].status,
            "Contract signing",
          );
          assert.ok(
            (
              await db.query(
                "SELECT 1 FROM audit_logs WHERE case_id=$1 AND entity='client_payments' AND detail->'before' IS NOT NULL",
                [rec.id],
              )
            ).rowCount,
          );
        },
      );
      await at.test(
        "Repeated scheduler checks do not create duplicate events; recurrence creates a new event",
        async () => {
          await contract("20000000", "2000-01-01");
          const count = async () =>
            Number(
              (
                await db.query(
                  "SELECT count(*) FROM financial_events WHERE case_id=$1 AND kind='PAYMENT_OVERDUE'",
                  [rec.id],
                )
              ).rows[0].count,
            );
          const before = await count();
          await checkFinanceDeadlines();
          await checkFinanceDeadlines();
          assert.equal(await count(), before);
          await contract("10000000", "");
          await contract("20000000", "2000-01-01");
          assert.equal(await count(), before + 1);
          const event = (
            await db.query(
              "SELECT * FROM financial_events WHERE case_id=$1 AND kind='PAYMENT_OVERDUE' AND resolved_at IS NULL",
              [rec.id],
            )
          ).rows[0];
          const fetchBefore = globalThis.fetch,
            token = process.env.TELEGRAM_BOT_TOKEN,
            chat = process.env.TELEGRAM_FINANCE_CHAT_ID;
          let calls = 0;
          process.env.TELEGRAM_BOT_TOKEN = "test-only";
          process.env.TELEGRAM_FINANCE_CHAT_ID = "-5519700066";
          const liveDestination = await (
            await import("../src/lib/telegram-settings")
          ).telegramChatSettings();
          await db.query(
            "INSERT INTO system_settings(id,value) VALUES('telegram',$1)",
            [
              JSON.stringify({
                ...liveDestination,
                financeChatId: "-100991100002",
                revision: 1,
              }),
            ],
          );
          globalThis.fetch = async (input, init) => {
            if (!String(input).startsWith("https://api.telegram.org/"))
              return fetchBefore(input, init);
            calls++;
            const body = JSON.parse(String(init?.body));
            assert.equal(body.chat_id, "-100991100002");
            assert.match(body.text, /ПРОСРОЧЕНА ОПЛАТА/);
            return Response.json({ ok: true, result: { message_id: 777 } });
          };
          try {
            await deliverFinancialEvent(event.id);
            await deliverFinancialEvent(event.id);
            assert.equal(calls, 1);
            await contract("30000000", "2000-01-01");
            await checkFinanceDeadlines();
            assert.equal(await count(), before + 1);
          } finally {
            await db.query("DELETE FROM system_settings WHERE id='telegram'");
            globalThis.fetch = fetchBefore;
            if (token === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
            else process.env.TELEGRAM_BOT_TOKEN = token;
            if (chat === undefined) delete process.env.TELEGRAM_FINANCE_CHAT_ID;
            else process.env.TELEGRAM_FINANCE_CHAT_ID = chat;
          }
        },
      );
      await at.test(
        "Telegram failure does not roll back payment and retry uses existing event",
        async () => {
          await contract("10000000", "");
          await contract("40000000", "2000-01-01");
          await payment("1.25");
          const paid = (await summary()).paid;
          const event = (
            await db.query(
              "SELECT id FROM financial_events WHERE case_id=$1 AND kind='PAYMENT_OVERDUE' AND resolved_at IS NULL",
              [rec.id],
            )
          ).rows[0];
          const oldFetch = globalThis.fetch,
            oldToken = process.env.TELEGRAM_BOT_TOKEN,
            oldChat = process.env.TELEGRAM_FINANCE_CHAT_ID;
          process.env.TELEGRAM_BOT_TOKEN = "test";
          process.env.TELEGRAM_FINANCE_CHAT_ID = "-5519700066";
          globalThis.fetch = async (input, init) =>
            String(input).startsWith("https://api.telegram.org/")
              ? Response.json({ ok: false }, { status: 503 })
              : oldFetch(input, init);
          try {
            await assert.rejects(deliverFinancialEvent(event.id));
            assert.equal((await summary()).paid, paid);
            assert.equal(
              (
                await db.query(
                  "SELECT sent_at FROM financial_events WHERE id=$1",
                  [event.id],
                )
              ).rows[0].sent_at,
              null,
            );
          } finally {
            globalThis.fetch = oldFetch;
            if (oldToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
            else process.env.TELEGRAM_BOT_TOKEN = oldToken;
            if (oldChat === undefined)
              delete process.env.TELEGRAM_FINANCE_CHAT_ID;
            else process.env.TELEGRAM_FINANCE_CHAT_ID = oldChat;
          }
        },
      );
      await at.test(
        "Role permissions hide contracts, profit, case audit details and financial receipts",
        async () => {
          await assert.rejects(
            accountingData(anna, new URLSearchParams({ case_id: rec.id })),
            (e: any) => e.status === 403,
          );
          const ordinaryCase = await getData(
            anna,
            "case",
            new URLSearchParams({ id: rec.id }),
          );
          assert.ok(!("remaining" in ordinaryCase.details.finance));
          assert.ok(
            !ordinaryCase.logs.some((l: any) =>
              ["case_finance", "client_payments", "client_expenses"].includes(
                l.entity,
              ),
            ),
          );
          const pdf = await PDFDocument.create();
          pdf.addPage();
          const bytes = Buffer.from(await pdf.save());
          const receipt = await saveFile(admin, {
            caseId: rec.id,
            name: "Чек",
            type: "Other",
            filename: "receipt.pdf",
            bytes,
            source: "website",
            financeReceipt: true,
          });
          assert.ok(
            !(
              await getData(anna, "case", new URLSearchParams({ id: rec.id }))
            ).documents.some((d: any) => d.id === receipt.document_id),
          );
          await assert.rejects(
            mutate(anna, { action: "document.open", data: { id: receipt.id } }),
          );
          await db.query(
            "INSERT INTO role_permissions VALUES('Employee','accounting.view') ON CONFLICT DO NOTHING",
          );
          const restricted = await actorFor("anna");
          const r = (
            await accountingData(
              restricted,
              new URLSearchParams({ case_id: rec.id }),
            )
          ).cases[0];
          for (const key of [
            "contract_amount",
            "remaining",
            "planned_profit",
            "cash_result",
          ])
            assert.ok(!(key in r));
          await assert.rejects(
            mutate(restricted, {
              action: "accounting.payment.save",
              data: {
                case_id: rec.id,
                amount: "1",
                date: "2030-05-10",
                type: "OTHER",
                method: "CASH",
                request_key: randomUUID(),
              },
            }),
          );
          await assert.rejects(
            mutate(admin, {
              action: "accounting.expense.save",
              data: {
                case_id: other.id,
                amount: "1",
                date: "2030-05-10",
                method: "CASH",
                expense_type_id: type.id,
                request_key: randomUUID(),
                receipt_version_id: receipt.id,
              },
            }),
          );
          await expense("12.50", { receipt_version_id: receipt.id });
        },
      );
      await at.test(
        "Expense type changes preserve old names; inactive types reject new expenses",
        async () => {
          const old = (await get()).types.find((t: any) => t.id === type.id);
          await mutate(admin, {
            action: "accounting.type.save",
            data: { ...old, name: "Проверенный тип", active: false },
          });
          assert.ok(
            (await get()).expenses.some((e: any) => e.type_name === type.name),
          );
          await assert.rejects(expense("1"), /активный тип/);
          const latest = (await get()).types.find((t: any) => t.id === type.id);
          await mutate(admin, {
            action: "accounting.type.save",
            data: { ...latest, active: true },
          });
        },
      );
      await at.test(
        "Reports filter by period and case; duplicate submissions and stale edits are safe",
        async () => {
          const key = randomUUID();
          await payment("123.45", "OTHER", { request_key: key });
          await payment("123.45", "OTHER", { request_key: key });
          assert.equal(
            (
              await db.query(
                "SELECT count(*) FROM client_payments WHERE request_key=$1",
                [key],
              )
            ).rows[0].count,
            "1",
          );
          const p = (await get()).payments.find(
            (p: any) => p.request_key === key,
          );
          const results = await Promise.allSettled([
            payment("124", "OTHER", { id: p.id, revision: p.revision }),
            payment("125", "OTHER", { id: p.id, revision: p.revision }),
          ]);
          assert.equal(
            results.filter((r) => r.status === "fulfilled").length,
            1,
          );
          await payment("100", "OTHER", { date: "2031-01-01" });
          const report = await accountingData(
            admin,
            new URLSearchParams({
              case_id: rec.id,
              from: "2031-01-01",
              to: "2031-01-01",
            }),
          );
          assert.equal(report.payments.length, 1);
          assert.equal(report.cases[0].period_paid, "100.00");
          const scoped = await accountingData(
            admin,
            new URLSearchParams({ country: "France" }),
          );
          assert.ok(scoped.cases.every((r: any) => r.country === "France"));
          assert.ok(!scoped.payments.some((p: any) => p.case_id === rec.id));
          await assert.rejects(payment("0"));
          await assert.rejects(payment("-1"));
          await assert.rejects(payment("1", "OTHER", { date: "2030-02-31" }));
        },
      );
    },
  );

  await t.test(
    "Case chat keeps versioned remarks private, tracks corrections and notifies participants",
    async () => {
      const { workflowData } = await import("../src/lib/workflow");
      const { chatData, chatUnread } = await import("../src/lib/case-chat");
      const { PDFDocument } = await import("pdf-lib");
      const rec = await mutate(admin, {
        action: "case.create",
        data: {
          finance: { currency: "UZS", contract_amount: "100000" },
          name: "Chat test",
          country: "Spain",
          visa_type: "ВНЖ испания",
          responsible_id: "anna",
        },
      });
      const other = await mutate(admin, {
        action: "case.create",
        data: {
          finance: { currency: "UZS", contract_amount: "100000" },
          name: "Other chat",
          country: "Spain",
          visa_type: "Shengen",
          responsible_id: "admin",
        },
      });
      const wf = await workflowData(rec.id),
        doc = wf.groups.find((g: any) => g.name === "CV").fields[0];
      const pdf = await PDFDocument.create();
      pdf.addPage([100, 100]);
      const bytes = Buffer.from(await pdf.save());
      const upload = () =>
        saveFile(anna, {
          caseId: rec.id,
          documentId: doc.id,
          name: "CV",
          type: "Other",
          filename: "CV.pdf",
          bytes,
          source: "website",
        });
      const first = await upload();
      await db.query(
        "UPDATE document_versions SET scan_status='clean' WHERE id=$1",
        [first.id],
      );
      const send = (actor: any, action: string, extra: any = {}) =>
        mutate(actor, {
          action,
          data: { case_id: rec.id, request_id: randomUUID(), ...extra },
        });
      await assert.rejects(
        chatData(bob, new URLSearchParams({ case_id: rec.id })),
        /недоступно/,
      );
      await assert.rejects(
        send(bob, "chat.send", { body: "No access" }),
        /недоступно/,
      );
      await assert.rejects(
        send(anna, "chat.issue", { body: "Fix", version_id: first.id }),
        /администратор/,
      );
      await assert.rejects(
        send(admin, "chat.issue", {
          body: "Fix",
          version_id: first.id,
          assignee_id: "bob",
        }),
        /участника/,
      );
      const key = randomUUID();
      const issue = await send(admin, "chat.issue", {
        body: "Исправьте фамилию на второй странице",
        version_id: first.id,
        request_id: key,
      });
      const repeat = await send(admin, "chat.issue", {
        body: "Исправьте фамилию на второй странице",
        version_id: first.id,
        request_id: key,
      });
      assert.equal(issue.id, repeat.id);
      assert.equal(
        (await workflowData(rec.id)).groups.find((g: any) => g.name === "CV")
          .fields[0].open_issues,
        1,
      );
      assert.equal(await chatUnread(anna, rec.id), 1);
      assert.equal(
        (await getData(anna, "notifications", new URLSearchParams())).find(
          (n: any) => n.chat_message_id === issue.id,
        ).chat_thread_id,
        issue.thread_id,
      );
      await send(anna, "chat.read", { ids: [issue.id] });
      assert.equal(await chatUnread(anna, rec.id), 0);
      const reply = await send(anna, "chat.send", {
        thread_id: issue.thread_id,
        reply_to: issue.id,
        body: "Исправлю",
        mention_ids: ["admin"],
      });
      const data = await chatData(
        anna,
        new URLSearchParams({ case_id: rec.id, thread: issue.thread_id }),
      );
      assert.equal(
        data.messages.find((m: any) => m.id === reply.id).reply_body,
        "Исправьте фамилию на второй странице",
      );
      await assert.rejects(
        send(admin, "chat.send", { mention_ids: ["bob"], body: "Hello" }),
        /участника/,
      );
      await assert.rejects(
        send(admin, "chat.send", { reply_to: issue.id, body: "Wrong thread" }),
        /том же/,
      );
      await assert.rejects(
        mutate(admin, {
          action: "chat.send",
          data: {
            case_id: other.id,
            body: "Wrong file",
            version_id: first.id,
            request_id: randomUUID(),
          },
        }),
        /недоступен/,
      );
      await assert.rejects(
        mutate(admin, {
          action: "chat.send",
          data: {
            case_id: other.id,
            body: "Wrong thread",
            thread_id: issue.thread_id,
            request_id: randomUUID(),
          },
        }),
        /не найдено/,
      );
      await assert.rejects(
        send(admin, "chat.resolve", {
          thread_id: issue.thread_id,
          decision: "close",
          version_id: first.id,
        }),
        /исправленная/,
      );
      const second = await upload();
      const afterUpload = await chatData(
        admin,
        new URLSearchParams({ case_id: rec.id }),
      );
      assert.equal(afterUpload.threads[0].status, "review");
      assert.equal(afterUpload.threads[0].version_id, first.id);
      assert.equal(afterUpload.threads[0].latest_version_id, second.id);
      assert.ok(
        afterUpload.messages.some(
          (m: any) => m.kind === "upload" && m.version_id === second.id,
        ),
      );
      await assert.rejects(
        send(admin, "chat.resolve", {
          thread_id: issue.thread_id,
          decision: "close",
          version_id: second.id,
        }),
        /проверки файла/,
      );
      await db.query(
        "UPDATE document_versions SET scan_status='clean' WHERE id=$1",
        [second.id],
      );
      await assert.rejects(
        send(anna, "chat.resolve", {
          thread_id: issue.thread_id,
          decision: "close",
          version_id: second.id,
        }),
        /администратор/,
      );
      await assert.rejects(
        send(admin, "chat.resolve", {
          thread_id: issue.thread_id,
          decision: "close",
          version_id: first.id,
        }),
        /Версия изменилась/,
      );
      await send(admin, "chat.resolve", {
        thread_id: issue.thread_id,
        decision: "close",
        version_id: second.id,
      });
      assert.equal(
        (
          await db.query(
            "SELECT review_status FROM document_versions WHERE id=$1",
            [second.id],
          )
        ).rows[0].review_status,
        "Approved",
      );
      assert.equal(
        (await workflowData(rec.id)).groups.find((g: any) => g.name === "CV")
          .fields[0].open_issues,
        0,
      );
      await send(admin, "chat.resolve", {
        thread_id: issue.thread_id,
        decision: "reopen",
        body: "Уточните дату",
      });
      assert.equal(
        (
          await chatData(
            admin,
            new URLSearchParams({ case_id: rec.id, status: "open" }),
          )
        ).threads[0].status,
        "open",
      );
      const third = await upload();
      assert.equal(
        (
          await chatData(
            admin,
            new URLSearchParams({ case_id: rec.id, thread: issue.thread_id }),
          )
        ).threads[0].latest_version_id,
        third.id,
      );
      assert.equal(
        (
          await db.query(
            "SELECT count(*) FROM notifications WHERE case_id=$1 AND user_id='bob'",
            [rec.id],
          )
        ).rows[0].count,
        "0",
      );
      const focused = await chatData(
        admin,
        new URLSearchParams({ case_id: rec.id, focus: issue.id }),
      );
      assert.equal(focused.messages.at(-1).id, issue.id);
      const noDownload = {
        ...anna,
        permissions: anna.permissions.filter(
          (p: string) => p !== "can_download_documents",
        ),
      };
      await assert.rejects(
        send(noDownload, "chat.send", {
          version_id: first.id,
          body: "Forward",
        }),
        /прав/,
      );
    },
  );

  await t.test(
    "Private and group chats enforce membership, deduplicate and join the case chat hub",
    async () => {
      const { chatHub, roomData } = await import("../src/lib/chat-rooms");
      async function staff(name: string) {
        const u = await mutate(admin, {
          action: "user.create",
          data: {
            name,
            email: name + "@chat.test.invalid",
            role_id: "Employee",
            password: "Isolated-test-password-2026!",
          },
        });
        return actorFor(u.id);
      }
      const peer = await staff("chat-peer"),
        third = await staff("chat-third");
      const action = (a: any, name: string, data: any) =>
        mutate(a, {
          action: name,
          data: { request_id: randomUUID(), ...data },
        });
      const direct = await action(anna, "room.create", {
        kind: "direct",
        members: [peer.id],
      });
      assert.equal(
        (
          await action(peer, "room.create", {
            kind: "direct",
            members: [anna.id],
          })
        ).id,
        direct.id,
      );
      await assert.rejects(
        roomData(admin, new URLSearchParams({ id: direct.id })),
        /недоступен/,
      );
      await assert.rejects(
        action(third, "room.send", { room_id: direct.id, body: "No access" }),
        /недоступен/,
      );
      await assert.rejects(
        action(anna, "room.create", { kind: "direct", members: [anna.id] }),
        /одного/,
      );
      const key = randomUUID();
      const first = await action(anna, "room.send", {
        room_id: direct.id,
        body: "Личное сообщение",
        request_id: key,
      });
      assert.equal(
        (
          await action(anna, "room.send", {
            room_id: direct.id,
            body: "Личное сообщение",
            request_id: key,
          })
        ).id,
        first.id,
      );
      const hub = await chatHub(peer, new URLSearchParams({ kind: "direct" }));
      assert.equal(hub.chats.find((c: any) => c.id === direct.id).unread, 1);
      assert.ok(
        !(await chatHub(admin, new URLSearchParams())).chats.some(
          (c: any) => c.id === direct.id,
        ),
      );
      await action(peer, "room.read", { room_id: direct.id, ids: [first.id] });
      assert.equal(
        (await chatHub(peer, new URLSearchParams({ kind: "direct" }))).chats[0]
          .unread,
        0,
      );
      const reply = await action(peer, "room.send", {
        room_id: direct.id,
        reply_to: first.id,
        body: "Ответ",
      });
      assert.equal(
        (
          await roomData(anna, new URLSearchParams({ id: direct.id }))
        ).messages.find((m: any) => m.id === reply.id).reply_body,
        "Личное сообщение",
      );
      const note = (
        await getData(anna, "notifications", new URLSearchParams())
      ).find((n: any) => n.room_message_id === reply.id);
      assert.equal(note.room_id, direct.id);
      const groupKey = randomUUID();
      const group = await action(anna, "room.create", {
        kind: "group",
        title: "Рабочая группа",
        members: [peer.id, third.id],
        request_id: groupKey,
      });
      assert.equal(
        (
          await action(anna, "room.create", {
            kind: "group",
            title: "Рабочая группа",
            members: [peer.id, third.id],
            request_id: groupKey,
          })
        ).id,
        group.id,
      );
      const msg = await action(anna, "room.send", {
        room_id: group.id,
        body: "Встреча группы",
      });
      await assert.rejects(
        action(anna, "room.send", {
          room_id: direct.id,
          body: "Foreign reply",
          reply_to: msg.id,
        }),
        /том же чате/,
      );
      await assert.rejects(
        action(peer, "room.update", {
          room_id: group.id,
          title: "No",
          members: [peer.id],
        }),
        /создатель/,
      );
      await action(anna, "room.update", {
        room_id: group.id,
        title: "Обновлённая группа",
        members: [third.id],
      });
      await assert.rejects(
        roomData(peer, new URLSearchParams({ id: group.id })),
        /недоступен/,
      );
      await assert.rejects(
        action(peer, "room.send", { room_id: group.id, body: "Removed" }),
        /недоступен/,
      );
      await assert.rejects(
        action(peer, "room.read", { room_id: group.id, ids: [msg.id] }),
        /недоступен/,
      );
      assert.ok(
        !(await getData(peer, "notifications", new URLSearchParams())).some(
          (n: any) => n.room_id === group.id,
        ),
      );
      assert.ok(
        !(await chatHub(peer, new URLSearchParams())).chats.some(
          (c: any) => c.id === group.id,
        ),
      );
      const renamed = await chatHub(
        third,
        new URLSearchParams({ q: "Обновлённая", kind: "group" }),
      );
      assert.equal(renamed.chats[0].title, "Обновлённая группа");
      assert.equal(
        (
          await roomData(
            third,
            new URLSearchParams({ id: group.id, focus: msg.id }),
          )
        ).messages.at(-1).id,
        msg.id,
      );
      const hiddenCase = await mutate(admin, {
        action: "case.create",
        data: {
          finance: { currency: "UZS", contract_amount: "100000" },
          name: "Hub private case",
          country: "Spain",
          visa_type: "Shengen",
          responsible_id: peer.id,
        },
      });
      assert.ok(
        !(
          await chatHub(
            anna,
            new URLSearchParams({ kind: "case", q: "Hub private case" }),
          )
        ).chats.some((c: any) => c.id === hiddenCase.id),
      );
      assert.ok(
        (
          await chatHub(
            peer,
            new URLSearchParams({ kind: "case", q: "Hub private case" }),
          )
        ).chats.some((c: any) => c.id === hiddenCase.id),
      );
      await db.query("UPDATE staff SET active=false WHERE user_id=$1", [
        third.id,
      ]);
      await assert.rejects(
        action(anna, "room.create", { kind: "direct", members: [third.id] }),
        /активных/,
      );
      await assert.rejects(
        roomData(third, new URLSearchParams({ id: group.id })),
        /недоступен/,
      );
    },
  );
  await t.test(
    "Chat cursor loads every accessible conversation, including timestamp ties",
    async () => {
      await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$1,$2)', [
        "scroll-peer",
        "scroll-peer@test.invalid",
      ]);
      await db.query(
        "INSERT INTO staff(user_id,role_id) VALUES($1,'Employee')",
        ["scroll-peer"],
      );
      const bob = await actorFor("scroll-peer");
      const { chatHub } = await import("../src/lib/chat-rooms");
      const ids: string[] = [];
      for (let i = 0; i < 123; i++) {
        const id = randomUUID();
        ids.push(id);
        await db.query(
          "INSERT INTO chat_rooms(id,kind,title,owner_id,request_id,updated_at) VALUES($1,'group',$2,'anna',$3,'2026-09-24T12:00:00.123456Z'::timestamptz - ($4::int * interval '1 microsecond'))",
          [id, "Scroll fixture " + i, randomUUID(), Math.floor(i / 60)],
        );
        await db.query(
          "INSERT INTO chat_room_members(room_id,user_id) VALUES($1,'anna')",
          [id],
        );
      }
      const first = await chatHub(
        anna,
        new URLSearchParams({ q: "Scroll fixture", kind: "group" }),
      );
      assert.equal(first.chats.length, 50);
      assert.ok(first.nextCursor);
      // A newer chat arriving must not shift the next batch or repeat its boundary.
      const newer = await mutate(anna, {
        action: "room.create",
        data: {
          kind: "group",
          title: "Scroll fixture newer",
          members: [bob.id],
          request_id: randomUUID(),
        },
      });
      await db.query(
        "UPDATE chat_rooms SET updated_at='2027-01-01' WHERE id=$1",
        [newer.id],
      );
      const found = first.chats.map((c: any) => c.id);
      let after: string | null = first.nextCursor;
      while (after) {
        const next = await chatHub(
          anna,
          new URLSearchParams({ q: "Scroll fixture", kind: "group", after }),
        );
        found.push(...next.chats.map((c: any) => c.id));
        after = next.nextCursor;
        assert.ok(found.length <= 123);
      }
      assert.equal(new Set(found).size, 123);
      assert.deepEqual([...found].sort(), ids.sort());
      assert.equal(
        (await chatHub(bob, new URLSearchParams({ q: "Scroll fixture" }))).chats
          .length,
        1,
      );
      assert.equal(
        (
          await chatHub(
            anna,
            new URLSearchParams({ q: "Scroll fixture", kind: "direct" }),
          )
        ).chats.length,
        0,
      );
      await assert.rejects(
        chatHub(anna, new URLSearchParams({ after: "invalid" })),
        /загрузить чаты/,
      );
    },
  );

  await t.test(
    "Screenshot messages are scanned, retry-safe, scoped to their chat and separate from case documents",
    async () => {
      await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$1,$2)', [
        "screenshot-peer",
        "screenshot-peer@test.invalid",
      ]);
      await db.query(
        "INSERT INTO staff(user_id,role_id) VALUES($1,'Employee')",
        ["screenshot-peer"],
      );
      const bob = await actorFor("screenshot-peer");
      const { createServer: createTcpServer } = await import("node:net");
      const { saveChatImage, readChatImage } =
        await import("../src/lib/chat-images");
      const { roomData } = await import("../src/lib/chat-rooms");
      const { chatData } = await import("../src/lib/case-chat");
      const { readObject } = await import("../src/lib/storage");
      let infected = false;
      const scanner = createTcpServer((socket) => {
        let data = Buffer.alloc(0),
          started = false;
        socket.on("data", (chunk) => {
          data = Buffer.concat([data, Buffer.from(chunk)]);
          if (!started) {
            if (data.length < 10) return;
            assert.equal(data.subarray(0, 10).toString(), "zINSTREAM\0");
            data = data.subarray(10);
            started = true;
          }
          while (data.length >= 4) {
            const length = data.readUInt32BE();
            if (data.length < 4 + length) return;
            data = data.subarray(4 + length);
            if (length === 0) {
              socket.end(infected ? "stream: Test FOUND\0" : "stream: OK\0");
              return;
            }
          }
        });
      });
      await new Promise<void>((resolve) =>
        scanner.listen(0, "127.0.0.1", resolve),
      );
      const oldHost = process.env.CLAMAV_HOST,
        oldPort = process.env.CLAMAV_PORT;
      process.env.CLAMAV_HOST = "127.0.0.1";
      process.env.CLAMAV_PORT = String((scanner.address() as any).port);
      try {
        const png = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNocAAAAASUVORK5CYII=",
          "base64",
        );
        const send = (a: any, action: string, data: any) =>
          mutate(a, { action, data: { request_id: randomUUID(), ...data } });
        const room = await send(anna, "room.create", {
          kind: "group",
          title: "Screenshot fixture",
          members: [bob.id],
        });
        const other = await send(anna, "room.create", {
          kind: "group",
          title: "Other screenshot fixture",
          members: [bob.id],
        });
        const request_id = randomUUID(),
          target = { room_id: room.id, request_id };
        const image = await saveChatImage(anna, target, png, "screenshot.png");
        assert.equal(
          (await saveChatImage(anna, target, png, "screenshot.png")).id,
          image.id,
        );
        await assert.rejects(
          saveChatImage(
            anna,
            { ...target, room_id: other.id },
            png,
            "screenshot.png",
          ),
          /другому фото/,
        );
        await assert.rejects(readChatImage(bob, image.id), /недоступно/);
        await assert.rejects(readChatImage(admin, image.id), /недоступен/);
        await assert.rejects(
          send(bob, "room.send", { room_id: room.id, image_id: image.id }),
          /недоступно/,
        );
        await assert.rejects(
          send(anna, "room.send", { room_id: other.id, image_id: image.id }),
          /недоступно/,
        );
        const key = randomUUID();
        const msg = await send(anna, "room.send", {
          room_id: room.id,
          body: "",
          image_id: image.id,
          request_id: key,
        });
        assert.equal(
          (
            await send(anna, "room.send", {
              room_id: room.id,
              body: "",
              image_id: image.id,
              request_id: key,
            })
          ).id,
          msg.id,
        );
        assert.equal(
          (
            await roomData(bob, new URLSearchParams({ id: room.id }))
          ).messages.at(-1).image_id,
          image.id,
        );
        assert.deepEqual(
          await readObject((await readChatImage(bob, image.id)).storage_key),
          png,
        );
        await assert.rejects(
          send(anna, "room.send", { room_id: room.id, image_id: image.id }),
          /уже отправлено/,
        );
        await assert.rejects(
          send(anna, "room.send", { room_id: room.id, body: " " }),
          /Напишите сообщение/,
        );
        await send(anna, "room.update", {
          room_id: room.id,
          title: "Screenshot fixture",
          members: [],
        });
        await assert.rejects(readChatImage(bob, image.id), /недоступен/);
        await assert.rejects(
          saveChatImage(
            bob,
            { room_id: room.id, request_id: randomUUID() },
            png,
            "screenshot.png",
          ),
          /недоступен/,
        );
        const rec = await send(admin, "case.create", {
          finance: { currency: "UZS", contract_amount: "100000" },
          name: "Screenshot case",
          country: "Spain",
          visa_type: "Shengen",
          responsible_id: "anna",
        });
        const count = async () =>
          Number(
            (
              await db.query(
                "SELECT count(*) FROM documents WHERE case_id=$1",
                [rec.id],
              )
            ).rows[0].count,
          );
        const before = await count();
        const caseImage = await saveChatImage(
          anna,
          { case_id: rec.id, request_id: randomUUID() },
          png,
          "screenshot.png",
        );
        await assert.rejects(readChatImage(bob, caseImage.id), /недоступно/);
        await send(anna, "chat.send", {
          case_id: rec.id,
          image_id: caseImage.id,
          body: "",
        });
        assert.equal(
          (
            await chatData(admin, new URLSearchParams({ case_id: rec.id }))
          ).messages.at(-1).image_id,
          caseImage.id,
        );
        assert.equal(
          (await readChatImage(admin, caseImage.id)).id,
          caseImage.id,
        );
        assert.equal(await count(), before);
        await assert.rejects(
          saveChatImage(
            anna,
            { case_id: rec.id, request_id: randomUUID() },
            Buffer.from("not a png"),
            "screenshot.png",
          ),
          /Формат/,
        );
        infected = true;
        await assert.rejects(
          saveChatImage(
            anna,
            { case_id: rec.id, request_id: randomUUID() },
            png,
            "screenshot.png",
          ),
          /антивирусом/,
        );
        assert.equal(
          (
            await db.query(
              "SELECT count(*) FROM chat_images WHERE case_id=$1",
              [rec.id],
            )
          ).rows[0].count,
          "1",
        );
      } finally {
        if (oldHost === undefined) delete process.env.CLAMAV_HOST;
        else process.env.CLAMAV_HOST = oldHost;
        if (oldPort === undefined) delete process.env.CLAMAV_PORT;
        else process.env.CLAMAV_PORT = oldPort;
        await new Promise<void>((resolve) => scanner.close(() => resolve()));
      }
    },
  );
  await t.test(
    "Telegram chat settings are admin-only, live, revision-safe and preserve general settings",
    async () => {
      const { telegramChatSettings, recordTelegramChat, chatIdSchema } =
        await import("../src/lib/telegram-settings");
      const { processUpdate } = await import("../src/lib/telegram");
      const previous = (
        await db.query("SELECT value FROM system_settings WHERE id='general'")
      ).rows[0].value;
      const oldToken = process.env.TELEGRAM_BOT_TOKEN,
        oldBackup = process.env.TELEGRAM_BACKUP_CHAT_ID,
        originalFetch = globalThis.fetch;
      process.env.TELEGRAM_BOT_TOKEN = "test-only";
      process.env.TELEGRAM_BACKUP_CHAT_ID = "-199999";
      const calls: Array<{ method: string; chat: string }> = [];
      globalThis.fetch = async (input: any, init: any) => {
        const url = String(input);
        if (!url.startsWith("https://api.telegram.org/"))
          return originalFetch(input, init);
        const method = url.split("/").pop()!;
        const body =
          init.body instanceof FormData
            ? { chat_id: init.body.get("chat_id") }
            : JSON.parse(String(init.body));
        calls.push({ method, chat: String(body.chat_id) });
        if (method === "getChat")
          return Response.json({
            ok: true,
            result: {
              id: Number(body.chat_id),
              type: "channel",
              title: "Тестовый канал",
              username: "test_channel",
            },
          });
        return Response.json({ ok: true, result: { message_id: 321 } });
      };
      try {
        const defaults = await telegramChatSettings();
        const value = {
          ...defaults,
          workflowChatId: "-100111000001",
          backupChatId: "-100111000002",
          teamChatId: "-100111000003",
          financeChatId: "-100111000004",
          backupEnabled: true,
          teamEnabled: true,
        };
        await assert.rejects(
          getData(anna, "settings-telegram", new URLSearchParams()),
        );
        await assert.rejects(
          getData(
            { ...admin, role: "Manager" },
            "settings-contracts",
            new URLSearchParams(),
          ),
        );
        await assert.rejects(
          mutate(
            {
              ...anna,
              permissions: [...anna.permissions, "can_manage_settings"],
            } as any,
            { action: "telegram-settings.save", data: value },
          ),
          /администратору/,
        );
        await assert.rejects(
          mutate(admin, {
            action: "telegram-settings.save",
            data: { ...value, workflowChatId: "12345" },
          }),
        );
        assert.equal(
          chatIdSchema.safeParse("-4503599627370496").success,
          false,
        );
        await assert.rejects(
          mutate(admin, {
            action: "telegram-settings.save",
            data: { ...value, backupChatId: "" },
          }),
          /резервных/,
        );
        const saved = await mutate(admin, {
          action: "telegram-settings.save",
          data: value,
        });
        assert.equal(saved.revision, 1);
        assert.equal(
          (await telegramChatSettings()).financeChatId,
          value.financeChatId,
        );
        await assert.rejects(
          mutate(admin, { action: "telegram-settings.save", data: value }),
          /изменились/,
        );
        await mutate(admin, {
          action: "settings.save",
          data: {
            timezone: previous.timezone,
            maxFileMb: previous.maxFileMb,
            reminderDays: previous.reminderDays,
          },
        });
        const general = (
          await db.query("SELECT value FROM system_settings WHERE id='general'")
        ).rows[0].value;
        assert.equal(general.backupEnabled, true);
        assert.equal(general.teamEnabled, true);
        await processUpdate({
          channel_post: {
            chat: {
              id: -100222000001,
              type: "channel",
              title: "Канал из события",
            },
          },
        });
        await recordTelegramChat({
          my_chat_member: {
            chat: {
              id: -100222000002,
              type: "supergroup",
              title: "Группа из события",
            },
            new_chat_member: { status: "administrator" },
          },
        });
        await recordTelegramChat({
          message: {
            chat: { id: 12345, type: "private", first_name: "Personal" },
          },
        });
        assert.equal(calls.length, 0);
        const data = await getData(
          admin,
          "settings-telegram",
          new URLSearchParams(),
        );
        assert.ok(data.catalog.some((c: any) => c.chat_id === "-100222000001"));
        assert.ok(
          data.catalog.some(
            (c: any) =>
              c.chat_id === "-100222000002" && c.bot_status === "administrator",
          ),
        );
        assert.ok(!data.catalog.some((c: any) => c.chat_id === "12345"));
        assert.equal(
          (await getData(admin, "me", new URLSearchParams())).settings
            .workflowChatId,
          undefined,
        );
        await mutate(admin, {
          action: "telegram-settings.check",
          data: { chat_id: "-100222000003" },
        });
        assert.equal(calls[0].method, "getChat");
        assert.equal(
          (
            await getData(admin, "settings-telegram", new URLSearchParams())
          ).catalog.find((c: any) => c.chat_id === "-100222000003").title,
          "Тестовый канал",
        );
        const v = (
          await db.query(
            "SELECT id FROM document_versions WHERE scan_status='clean' ORDER BY created_at LIMIT 1",
          )
        ).rows[0];
        await db.query(
          "INSERT INTO backup_deliveries(version_id,state) VALUES($1,'pending') ON CONFLICT(version_id) DO UPDATE SET state='pending'",
          [v.id],
        );
        await db.query(
          "UPDATE telegram_updates SET state='sent' WHERE state='pending'",
        );
        await db.query(
          "INSERT INTO jobs(kind,payload,dedupe_key,run_at) VALUES('backup',$1,'test-live-backup','1900-01-01'),('team',$2,'test-live-team','1900-01-02')",
          [
            JSON.stringify({ versionId: v.id }),
            JSON.stringify({ text: "Test team event" }),
          ],
        );
        const { tick } = await import("../src/lib/worker");
        await tick();
        await tick();
        assert.ok(
          calls.some(
            (c) => c.method === "sendDocument" && c.chat === value.backupChatId,
          ),
        );
        assert.ok(
          calls.some(
            (c) => c.method === "sendMessage" && c.chat === value.teamChatId,
          ),
        );
        await mutate(admin, {
          action: "telegram-settings.save",
          data: {
            ...value,
            revision: 1,
            backupChatId: "",
            backupEnabled: false,
          },
        });
        assert.equal((await telegramChatSettings()).backupChatId, "");
      } finally {
        globalThis.fetch = originalFetch;
        if (oldToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
        else process.env.TELEGRAM_BOT_TOKEN = oldToken;
        if (oldBackup === undefined) delete process.env.TELEGRAM_BACKUP_CHAT_ID;
        else process.env.TELEGRAM_BACKUP_CHAT_ID = oldBackup;
        await db.query("DELETE FROM system_settings WHERE id='telegram'");
        await db.query(
          "UPDATE system_settings SET value=$1 WHERE id='general'",
          [JSON.stringify(previous)],
        );
      }
    },
  );
  await t.test(
    "Automatic contract cannot be disabled; mandatory field policy is administrator-only",
    async () => {
      const { caseFormPolicy } = await import("../src/lib/case-form");
      const old = await caseFormPolicy();
      const input = {
        name: "Automatic contract test",
        country: "Spain",
        visa_type: "Shengen",
        responsible_id: "anna",
        finance: {
          currency: "UZS",
          contract_amount: "150000",
          initial_payment: "50000",
        },
      };
      const rec = await mutate(admin, {
        action: "case.create",
        data: { ...input, create_contract: false },
      });
      assert.equal(rec.status, "Contract signing");
      assert.equal(
        (
          await db.query(
            "SELECT values FROM generated_contracts WHERE case_id=$1",
            [rec.id],
          )
        ).rows[0].values.TOTAL_AMOUNT,
        "150000,00",
      );
      const before = Number(
        (await db.query("SELECT count(*) FROM cases")).rows[0].count,
      );
      await assert.rejects(
        mutate(admin, {
          action: "case.create",
          data: { ...input, finance: undefined },
        }),
        /сумму и валюту/,
      );
      const policy = await mutate(admin, {
        action: "case-form.save",
        data: {
          revision: old.revision,
          required: ["phone", "country", "initial_payment", "payment_deadline"],
        },
      });
      await assert.rejects(
        mutate(
          {
            ...anna,
            permissions: [...anna.permissions, "can_manage_settings"],
          },
          {
            action: "case-form.save",
            data: { revision: policy.revision, required: [] },
          },
        ),
        /только администратор/,
      );
      await assert.rejects(
        mutate(
          { ...admin, role: "Manager" },
          {
            action: "case-form.save",
            data: { revision: policy.revision, required: [] },
          },
        ),
        /только администратор/,
      );
      await assert.rejects(
        mutate(admin, {
          action: "case-form.save",
          data: { revision: old.revision, required: [] },
        }),
        /изменились/,
      );
      await assert.rejects(
        mutate(admin, { action: "case.create", data: input }),
        /Телефон/,
      );
      await assert.rejects(
        mutate(admin, {
          action: "case.create",
          data: {
            ...input,
            phone: "+998000",
            finance: { ...input.finance, initial_payment: "0" },
          },
        }),
        /Первичный взнос/,
      );
      await assert.rejects(
        mutate(admin, {
          action: "case.create",
          data: { ...input, phone: "+998000" },
        }),
        /Дедлайн оплаты/,
      );
      assert.equal(
        Number((await db.query("SELECT count(*) FROM cases")).rows[0].count),
        before,
      );
      const full = await mutate(admin, {
        action: "case.create",
        data: {
          ...input,
          phone: "+998000",
          finance: { ...input.finance, initial_payment: "150000" },
        },
      });
      assert.equal(
        (
          await db.query(
            "SELECT payment_deadline FROM case_finances WHERE case_id=$1",
            [full.id],
          )
        ).rows[0].payment_deadline,
        null,
      );
      const optional = await mutate(admin, {
        action: "case-form.save",
        data: { revision: policy.revision, required: [] },
      });
      const minimal = await mutate(admin, {
        action: "case.create",
        data: { ...input, country: "", visa_type: "" },
      });
      assert.equal(minimal.country, "");
      assert.equal(minimal.status, "Contract signing");
      const clientCount = Number(
        (await db.query("SELECT count(*) FROM clients")).rows[0].count,
      );
      const latest = (
        await db.query(
          "SELECT id,storage_key FROM contract_templates ORDER BY created_at DESC,id DESC LIMIT 1",
        )
      ).rows[0];
      const objectKey = "/test/" + latest.storage_key,
        bytes = objects.get(objectKey);
      objects.delete(objectKey);
      try {
        await assert.rejects(
          mutate(admin, {
            action: "case.create",
            data: { ...input, name: "Failed template render" },
          }),
        );
        assert.equal(
          Number(
            (await db.query("SELECT count(*) FROM clients")).rows[0].count,
          ),
          clientCount,
        );
      } finally {
        if (bytes) objects.set(objectKey, bytes);
      }
      await mutate(admin, {
        action: "case-form.save",
        data: { revision: optional.revision, required: old.required },
      });
    },
  );
  await t.test(
    "Dashboard filters match stage and summary counts, preserve case scope and pagination",
    async () => {
      const { formatInTimeZone, fromZonedTime } = await import("date-fns-tz");
      const day = formatInTimeZone(new Date(), "Asia/Tashkent", "yyyy-MM-dd");
      await db.query(
        "INSERT INTO tasks(case_id,title,responsible_id,deadline,creator_id) VALUES($1,'Filter mine','admin',$2,'admin')",
        [case1.id, fromZonedTime(day + "T08:05:00", "Asia/Tashkent")],
      );
      for (const filter of ["overdue", "today", "mine", "completed"]) {
        const data = await getData(
          admin,
          "dashboard",
          new URLSearchParams({ task_filter: filter }),
        );
        assert.equal(data.tasks.length, Number(data.stats[filter]));
        if (filter === "completed")
          assert.ok(data.tasks.every((t: any) => t.status === "Completed"));
        else assert.ok(data.tasks.every((t: any) => t.status !== "Completed"));
        if (filter === "mine")
          assert.ok(data.tasks.every((t: any) => t.responsible_id === "admin"));
        if (filter === "today")
          assert.ok(
            data.tasks.every(
              (t: any) =>
                formatInTimeZone(t.deadline, "Asia/Tashkent", "yyyy-MM-dd") ===
                day,
            ),
          );
        if (filter === "overdue")
          assert.ok(
            data.tasks.every((t: any) => new Date(t.deadline) < new Date()),
          );
      }
      await db.query(
        "UPDATE cases SET status='Waiting for payment' WHERE id=$1",
        [case1.id],
      );
      const selected = await getData(
        admin,
        "dashboard",
        new URLSearchParams({ stage: "Waiting for payment" }),
      );
      assert.ok(selected.stage_cases.some((c: any) => c.id === case1.id));
      assert.ok(
        selected.stage_cases.every(
          (c: any) => c.status === "Waiting for payment",
        ),
      );
      const employee = await getData(
        anna,
        "dashboard",
        new URLSearchParams({ stage: "Waiting for payment" }),
      );
      assert.ok(
        employee.stage_cases.every(
          (c: any) => c.responsible_id === "anna" || c.escalation_id === "anna",
        ),
      );
      assert.ok(!employee.stage_cases.some((c: any) => c.id === case2.id));
      await assert.rejects(
        getData(admin, "dashboard", new URLSearchParams({ stage: "invalid" })),
      );
      await assert.rejects(
        getData(
          admin,
          "dashboard",
          new URLSearchParams({ task_filter: "invalid" }),
        ),
      );
      const cl = case1.client_id;
      for (let i = 0; i < 25; i++)
        await db.query(
          "INSERT INTO cases(client_id,country,visa_type,responsible_id,status) VALUES($1,'Test','Test','admin','Visa refused')",
          [cl],
        );
      const first = (
        await getData(
          admin,
          "dashboard",
          new URLSearchParams({ stage: "Visa refused" }),
        )
      ).stage_cases;
      const second = (
        await getData(
          admin,
          "dashboard",
          new URLSearchParams({ stage: "Visa refused", page: "2" }),
        )
      ).stage_cases;
      assert.equal(first.length, 20);
      assert.ok(second.length >= 5);
      assert.ok(first.every((r: any) => r.status === "Visa refused"));
      assert.ok(
        !first.some((r: any) => second.some((s: any) => s.id === r.id)),
      );
    },
  );
  await t.test(
    "Manual stages stay selectable and are identical in dashboard filters",
    async () => {
      const input = {
        name: "Manual stage test",
        country: "Spain",
        visa_type: "Shengen",
        responsible_id: "admin",
      };
      const rec = await mutate(admin, {
        action: "case.create",
        data: {
          ...input,
          finance: { currency: "UZS", contract_amount: "100000" },
        },
      });
      assert.equal(rec.status, "Contract signing");
      for (const status of [
        "Waiting for payment",
        "Documents collecting",
        "Waiting for decision",
        "Visa approved",
        "Additional request",
        "Visa refused",
      ]) {
        const result = await mutate(admin, {
          action: "case.update",
          data: {
            ...input,
            id: rec.id,
            status,
            email: "",
            phone: "",
            escalation_id: "",
            deadline: "",
          },
        });
        assert.equal(result.status, status);
        const list = await getData(
          admin,
          "dashboard",
          new URLSearchParams({ stage: status }),
        );
        assert.ok(list.stage_cases.some((r: any) => r.id === rec.id));
        assert.ok(list.stage_cases.every((r: any) => r.status === status));
      }
      await assert.rejects(
        mutate(admin, {
          action: "case.update",
          data: {
            ...input,
            id: rec.id,
            status: "New",
            email: "",
            phone: "",
            escalation_id: "",
            deadline: "",
          },
        }),
      );
    },
  );
});

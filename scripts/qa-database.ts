// Isolated, disposable database for browser QA. Never use for production data.
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { readFile, readdir } from "node:fs/promises";
import { hashPassword } from "better-auth/crypto";
import { permissions, caseStatuses } from "../src/lib/domain";
const db = await PGlite.create();
for (const file of (await readdir("migrations")).sort())
  await db.exec(await readFile("migrations/" + file, "utf8"));
await db.exec("CREATE TABLE schema_migrations(name text PRIMARY KEY)");
for (const p of permissions)
  await db.query("INSERT INTO permissions VALUES($1)", [p]);
for (const s of caseStatuses)
  await db.query("INSERT INTO case_statuses VALUES($1)", [s]);
for (const r of ["Administrator", "Manager", "Employee"])
  await db.query("INSERT INTO roles VALUES($1,$1)", [r]);
for (const p of permissions)
  await db.query("INSERT INTO role_permissions VALUES('Administrator',$1)", [
    p,
  ]);
await db.query(
  "INSERT INTO \"user\"(id,name,email,\"emailVerified\") VALUES('qa','Тестовый администратор','qa@example.invalid',true)",
);
await db.query("INSERT INTO staff VALUES('qa','Administrator',true)");
await db.query(
  "INSERT INTO account(id,\"accountId\",\"providerId\",\"userId\",password) VALUES('qa','qa','credential','qa',$1)",
  [await hashPassword("Isolated-QA-only-2026!")],
);
const server = new PGLiteSocketServer({
  db,
  port: 55434,
  host: "127.0.0.1",
  maxConnections: 10,
});
await server.start();
console.log(
  "Disposable QA database listening on 55434. All data is lost when stopped.",
);
process.on("SIGINT", async () => {
  await server.stop();
  await db.close();
  process.exit();
});

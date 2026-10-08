import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import { db, tx } from "../src/lib/db";
import { permissions, caseStatuses } from "../src/lib/domain";
await db.query(
  "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())",
);
for (const name of (await readdir("migrations"))
  .filter((n) => n.endsWith(".sql"))
  .sort())
  await tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(81821)");
    if (
      (await c.query("SELECT 1 FROM schema_migrations WHERE name=$1", [name]))
        .rowCount
    )
      return;
    await c.query(await readFile(`migrations/${name}`, "utf8"));
    await c.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
    console.log("Applied", name);
  });
await tx(async (c) => {
  for (const p of permissions)
    await c.query("INSERT INTO permissions VALUES($1) ON CONFLICT DO NOTHING", [
      p,
    ]);
  for (const s of caseStatuses)
    await c.query(
      "INSERT INTO case_statuses VALUES($1) ON CONFLICT DO NOTHING",
      [s],
    );
  for (const role of ["Administrator", "Manager", "Employee"]) {
    const r = await c.query(
      "INSERT INTO roles VALUES($1,$1) ON CONFLICT DO NOTHING RETURNING id",
      [role],
    );
    if (!r.rowCount) continue;
    const list =
      role === "Administrator"
        ? permissions
        : role === "Manager"
          ? permissions.filter(
              (p) =>
                ![
                  "can_manage_users",
                  "can_manage_roles",
                  "can_manage_settings",
                  "can_view_audit_log",
                ].includes(p),
            )
          : [
              "can_view_cases",
              "can_upload_documents",
              "can_download_documents",
              "can_create_tasks",
              "can_edit_tasks",
              "can_complete_tasks",
            ];
    for (const p of list)
      await c.query("INSERT INTO role_permissions VALUES($1,$2)", [role, p]);
  }
});
console.log("Database ready; no sample clients inserted.");
await db.end();

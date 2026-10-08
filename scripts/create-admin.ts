import "dotenv/config";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { db, tx } from "../src/lib/db";
import { createInterface } from "node:readline/promises";
const io = createInterface({ input: process.stdin, output: process.stdout });
try {
  const name = await io.question("Administrator name: ");
  const email = await io.question("Administrator email: ");
  console.log(
    "Use a unique password (at least 12 characters). Input is visible in this terminal.",
  );
  const password = await io.question("Password: ");
  if (password.length < 12 || !email.includes("@") || !name.trim())
    throw new Error("Invalid input");
  const uid = randomUUID();
  await tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(81822)");
    if (
      (await c.query("SELECT 1 FROM staff WHERE role_id='Administrator'"))
        .rowCount
    )
      throw new Error(
        "Administrator already exists. Use the application to create additional staff.",
      );
    await c.query(
      'INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)',
      [uid, name, email.toLowerCase()],
    );
    await c.query(
      'INSERT INTO account(id,"accountId","providerId","userId",password) VALUES($1,$2,\'credential\',$2,$3)',
      [randomUUID(), uid, await hashPassword(password)],
    );
    await c.query(
      "INSERT INTO staff(user_id,role_id) VALUES($1,'Administrator')",
      [uid],
    );
    await c.query(
      "INSERT INTO audit_logs(user_id,action,entity,entity_id,source) VALUES($1,'Первый администратор создан','user',$1,'system')",
      [uid],
    );
  });
  console.log("Administrator created.");
} finally {
  io.close();
  await db.end();
}

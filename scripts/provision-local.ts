import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { hashPassword } from 'better-auth/crypto';
const credentials = JSON.parse(await readFile('.data/credentials.json','utf8'));
if (process.argv.includes('--database')) {
  const pg = new Pool({host:'127.0.0.1',port:5432,user:'postgres',password:credentials.postgresPassword,database:'postgres'});
  const password = process.env.POSTGRES_PASSWORD!;
  if (!/^[a-f0-9]{64}$/.test(password)) throw new Error('Invalid generated database secret');
  if (!(await pg.query("SELECT 1 FROM pg_roles WHERE rolname='iz'")).rowCount) await pg.query(`CREATE ROLE iz LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
  if (!(await pg.query("SELECT 1 FROM pg_database WHERE datname='iz'")).rowCount) await pg.query('CREATE DATABASE iz OWNER iz');
  await pg.end();
  console.log('Application database initialized.');
} else {
  const {db,tx} = await import('../src/lib/db');
  await tx(async c => {
    await c.query('SELECT pg_advisory_xact_lock(81822)');
    if ((await c.query("SELECT 1 FROM staff WHERE role_id='Administrator'")).rowCount) return;
    const uid=randomUUID();
    await c.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)',[uid,'Администратор',credentials.email]);
    await c.query('INSERT INTO account(id,"accountId","providerId","userId",password) VALUES($1,$2,\'credential\',$2,$3)',[randomUUID(),uid,await hashPassword(credentials.password)]);
    await c.query("INSERT INTO staff(user_id,role_id) VALUES($1,'Administrator')",[uid]);
    await c.query("INSERT INTO audit_logs(user_id,action,entity,entity_id,source) VALUES($1,'Первый администратор создан','user',$1,'system')",[uid]);
  });
  await db.end(); console.log('Administrator ready; credentials are in the protected access file.');
}

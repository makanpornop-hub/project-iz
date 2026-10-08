import 'dotenv/config';
import {readFile,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {Pool} from 'pg';
import assert from 'node:assert/strict';
const credential=JSON.parse(await readFile('.data/credentials.json','utf8'));
const admin=new Pool({host:'127.0.0.1',port:5432,user:'postgres',password:credential.postgresPassword,database:'postgres'});
const name='iz_restore_check_'+Date.now();
const folder=(await readdir('backups')).sort().at(-1)!;
try {
 await admin.query(`CREATE DATABASE ${name} OWNER iz`);
 const result=spawnSync('.runtime/pgsql/bin/pg_restore.exe',['-h','127.0.0.1','-U','iz','-d',name,'--no-owner','--exit-on-error',`backups/${folder}/database.dump`],{encoding:'utf8',env:{...process.env,PGPASSWORD:process.env.POSTGRES_PASSWORD}});
 assert.equal(result.status,0,result.stderr);
 const restored=new Pool({host:'127.0.0.1',user:'iz',password:process.env.POSTGRES_PASSWORD,database:name});
 try {assert.equal((await restored.query("SELECT count(*)::int AS n FROM staff WHERE role_id='Administrator'")).rows[0].n,1);assert.equal((await restored.query('SELECT count(*)::int AS n FROM clients')).rows[0].n,0);}finally{await restored.end();}
 console.log('PASS: backup restored into a separate temporary database and verified.');
} finally {
 if(!/^iz_restore_check_\d+$/.test(name)) throw new Error('Unsafe test database name');
 await admin.query(`DROP DATABASE IF EXISTS ${name}`);
 await admin.end();
}

import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { S3Client,PutObjectCommand,GetObjectCommand,DeleteObjectCommand } from '@aws-sdk/client-s3';
import { scan } from '../src/lib/storage';
import { db } from '../src/lib/db';
const base='http://localhost:3000';
const credentials=JSON.parse(await readFile('.data/credentials.json','utf8'));
assert.equal((await (await fetch(base+'/api/health')).json()).ready,true);
assert.equal((await fetch(base+'/api/data/cases')).status,401);
const login=await fetch(base+'/api/auth/sign-in/email',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({email:credentials.email,password:credentials.password})});
assert.equal(login.status,200);
const cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
assert.ok(cookie);
for(const section of ['cases','clients','tasks','dashboard']) {
  const r=await fetch(base+'/api/data/'+section,{headers:{Cookie:cookie}});
  assert.equal(r.status,200,'Authenticated section '+section);
}
console.log('PASS: real administrator login, access protection and application data.');
const s3=new S3Client({region:'us-east-1',endpoint:process.env.S3_ENDPOINT,forcePathStyle:true,credentials:{accessKeyId:process.env.S3_ACCESS_KEY_ID!,secretAccessKey:process.env.S3_SECRET_ACCESS_KEY!}});
const Bucket=process.env.S3_BUCKET!,Key='installation-check-'+randomUUID();
const Body=Buffer.from('%PDF-1.4\n% Project Iz installation check\n%%EOF\n');
const put=await s3.send(new PutObjectCommand({Bucket,Key,Body,ContentType:'application/pdf'}));
try {
  const read=await s3.send(new GetObjectCommand({Bucket,Key}));
  assert.deepEqual(Buffer.from(await read.Body!.transformToByteArray()),Body);
  assert.equal(await scan(Body),true);
  assert.ok(put.VersionId);
  console.log('PASS: real private storage write/read, versioning and ClamAV scan.');
} finally {await s3.send(new DeleteObjectCommand({Bucket,Key,VersionId:put.VersionId}));}
const nodemailer=await import('nodemailer');
await nodemailer.default.createTransport({host:'127.0.0.1',port:1025}).verify();
console.log('PASS: local SMTP server.');
await fetch(base+'/api/auth/sign-out',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie},body:'{}'});
assert.equal((await db.query('SELECT count(*)::int AS n FROM clients')).rows[0].n,0);
await db.end();
console.log('PASS: no sample clients left in the working database.');

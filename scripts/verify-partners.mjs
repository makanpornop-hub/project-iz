import 'dotenv/config';import fs from 'node:fs';import assert from 'node:assert/strict';
const base='http://localhost:3000';
assert.equal((await (await fetch(base+'/api/health')).json()).ready,true);
assert.equal((await fetch(base+'/partners')).status,200);
assert.equal((await fetch(base+'/api/data/partners')).status,401);
const credentials=JSON.parse(fs.readFileSync('.data/credentials.json','utf8'));
const response=await fetch(base+'/api/auth/sign-in/email',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({email:credentials.email,password:credentials.password})});
if(response.status!==200)throw new Error('Saved installation login no longer works; authenticated deployment check not completed');
const cookie=response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
try{
 const r=await fetch(base+'/api/data/partners',{headers:{Cookie:cookie}});assert.equal(r.status,200);
 const groups=await r.json();assert.ok(Array.isArray(groups));for(const group of groups){assert.ok(Array.isArray(group.partners));assert.equal(typeof group.name,'string');}
 const me=await (await fetch(base+'/api/data/me',{headers:{Cookie:cookie}})).json();assert.ok(me.actor.permissions.includes('can_manage_partners'));
 console.log('PASS: production page, authenticated partner data, administrator edit permission, and denial without login.');
}finally{await fetch(base+'/api/auth/sign-out',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,Origin:base},body:'{}'});}


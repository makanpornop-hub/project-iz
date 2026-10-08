import "dotenv/config";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {PDFDocument} from "pdf-lib";
import {db,tx} from "../src/lib/db";
import {actorFor} from "../src/lib/access";
import {initializeSpain,workflowData} from "../src/lib/workflow";
import {scan} from "../src/lib/storage";
const caseId=randomUUID(),clientId=randomUUID(),rollback=new Error("rollback verification");
try{
 const uid=(await db.query("SELECT user_id FROM staff WHERE active AND role_id='Administrator' LIMIT 1")).rows[0].user_id;
 const actor=await actorFor(uid);
 try{
  await tx(async c=>{
   await c.query("INSERT INTO clients(id,name) VALUES($1,'Installation verification transaction')",[clientId]);
   const rec=(await c.query("INSERT INTO cases(id,client_id,country,visa_type,responsible_id) VALUES($1,$2,'Spain','ВНЖ испания',$3) RETURNING *",[caseId,clientId,uid])).rows[0];
   await initializeSpain(c,actor,rec);
   const wf=await workflowData(caseId,c);assert.equal(wf.groups.length,15);assert.equal(wf.groups[0].fields[0].name,"Диплом");
   assert.equal((await c.query("SELECT count(*)::int AS n FROM tasks WHERE case_id=$1",[caseId])).rows[0].n,2);
   throw rollback;
  });
 }catch(e){if(e!==rollback)throw e;}
 assert.equal((await db.query("SELECT 1 FROM cases WHERE id=$1",[caseId])).rowCount,0);
 assert.equal((await db.query("SELECT 1 FROM clients WHERE id=$1",[clientId])).rowCount,0);
 const pdf=await PDFDocument.create();pdf.addPage([595,842]);assert.equal(await scan(Buffer.from(await pdf.save())),true);
 assert.equal((await (await fetch("http://localhost:3000/api/health")).json()).ready,true);
 const denied=await fetch("http://localhost:3000/api/workflow",{method:"POST",headers:{"Content-Type":"application/json",Origin:"http://localhost:3000"},body:JSON.stringify({action:"workflow.submit",data:{case_id:caseId}})});
 assert.equal(denied.status,401);
 console.log("PASS: real PostgreSQL template/tasks/field order; transaction rollback left no test case; generated PDF passed real ClamAV; app ready and workflow requires login.");
}finally{await db.end();}


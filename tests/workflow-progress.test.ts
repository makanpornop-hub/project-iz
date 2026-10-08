import {test} from 'node:test';import assert from 'node:assert/strict';import {workflowGroupProgress} from '../src/lib/workflow-validation';
const field=(id:string,required=true,scan='clean')=>({id,name:id,required,latest:{id,scan_status:scan}});
test('Group completion ignores absent optional files and requires clean mandatory documents',()=>{
 assert.deepEqual(workflowGroupProgress({fields:[field('a'),{id:'b',required:false}]}),{done:1,total:1,complete:true});
 assert.equal(workflowGroupProgress({fields:[field('a',true,'pending')]}).complete,false);
 assert.equal(workflowGroupProgress({fields:[field('a'),{id:'b',required:true}]}).complete,false);
 assert.equal(workflowGroupProgress({fields:[]}).complete,false);
});
test('Merged group completes only with current clean output',()=>{
 const g={fields:[{...field('a'),merge_order:1}],output:{latest:{scan_status:'clean',source_version_ids:['old']}}};
 assert.equal(workflowGroupProgress(g).complete,false);
 g.output.latest.source_version_ids=['a'];assert.equal(workflowGroupProgress(g).complete,true);
 g.output.latest.scan_status='pending';assert.equal(workflowGroupProgress(g).complete,false);
});

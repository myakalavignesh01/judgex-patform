import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {combineSpecialists,runSpecialistReview,specialists} from '../server/specialists.ts';
import type {SpecialistId,SpecialistOutput} from '../server/specialists.ts';
import type {ReviewOutput} from '../server/review.ts';
const criteria=[{id:'build',name:'Build',weight:100}],evidence=[{id:'e1',text:'Demonstrated prototype',source:'slide 1'}];
const output=(score:number|null):SpecialistOutput=>({findings:[{criterionId:'build',score,rationale:'Only demonstrated behavior was reviewed.',evidenceIds:score===null?[]:['e1'],uncertainty:'medium',limitations:score===null?['Insufficient evidence']:[]}],feedback:'Review the evidence.',flags:[]});
test('five specialist suggestions combine deterministically and disagreements remain visible',()=>{
 const outputs=Object.fromEntries(specialists.map((s,i)=>[s.id,output([6,7,8,9,10][i])])) as Record<SpecialistId,SpecialistOutput>;
 const result=combineSpecialists(criteria,evidence,outputs);assert.equal(result.findings[0].score,8);assert.equal(result.findings[0].uncertainty,'high');assert(result.flags.length>0);assert.deepEqual(result.findings[0].evidenceIds,['e1']);assert(result.findings[0].rationale.includes('UX Judge'));
});
test('insufficient specialist evidence is never silently scored as zero',()=>{
 const outputs=Object.fromEntries(specialists.map(s=>[s.id,output(null)]));assert.equal(combineSpecialists(criteria,evidence,outputs).findings[0].score,null);outputs.technical=output(9);const result=combineSpecialists(criteria,evidence,outputs);assert.equal(result.findings[0].score,9);assert.equal(result.findings[0].uncertainty,'high');assert(result.findings[0].limitations.some(x=>x.includes('insufficient evidence')));outputs.ux=output(8);outputs.ux.findings[0].evidenceIds=['fake'];assert.throws(()=>combineSpecialists(criteria,evidence,outputs));
});
test('specialist failures resume from saved stages and never approve results',async()=>{
 const saved:ReviewOutput={},calls:string[]=[];let failing=true;
 const checkpoint=async(stage:string,status:string,value?:unknown)=>{if(status==='complete')saved[stage]=value;};
 const judge=async(id:SpecialistId)=>{calls.push(id);if(id==='ux'&&failing)throw Error('Provider unavailable');return output(8);};
 const reviews={reviewConsistency:async()=>({summary:'No contradictions identified in supplied evidence.',issues:[]}),writeFeedback:async()=>({summary:'Constructive draft.',strengths:['Demonstrated prototype'],improvements:['Add a reliability test'],limitations:[]})};
 await assert.rejects(runSpecialistReview({key:'test',model:'test'},criteria,evidence,saved,checkpoint,judge,reviews),/Provider unavailable/);assert(saved.technical);assert(saved.innovation);assert(!saved.assessment);failing=false;
 const result=await runSpecialistReview({key:'test',model:'test'},criteria,evidence,saved,checkpoint,judge,reviews);assert.equal(calls.filter(x=>x==='technical').length,1);assert.equal(calls.filter(x=>x==='ux').length,2);assert.equal(result.assessment?.findings[0].score,8);assert(result.feedback);assert(!('approved' in result));
});
test('only assigned specialists call the provider for a criterion',async()=>{
 const calls:string[]=[];const subset=[{...criteria[0],judge_domains:['technical'] as SpecialistId[]}];const result=await runSpecialistReview({key:'test',model:'test'},subset,evidence,{},async()=>{},async id=>{calls.push(id);return output(7);},{reviewConsistency:async()=>({summary:'Review complete.',issues:[]}),writeFeedback:async()=>({summary:'Draft complete.',strengths:[],improvements:[],limitations:[]})});assert.deepEqual(calls,['technical']);assert.equal(result.assessment?.findings[0].score,7);
});

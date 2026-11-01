import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {runReview,validateConsistency,validateFeedback} from '../server/review.ts';
import type {ReviewOutput} from '../server/review.ts';
const criteria=[{id:'build',name:'Build',weight:100}],evidence=[{id:'e1',text:'Working form',source:'slide1'}];
const assessment={findings:[{criterionId:'build',score:8,rationale:'Working form shown',evidenceIds:['e1'],uncertainty:'medium' as const,limitations:[]}],feedback:'Useful prototype',flags:[]};
const consistency={summary:'Check the claimed deployment.',issues:[{criterionId:'build',severity:'high' as const,explanation:'Deployment is not demonstrated.',evidenceIds:['e1']}]};
const feedback={summary:'A useful prototype with deployment still to demonstrate.',strengths:['Working form'],improvements:['Demonstrate deployment'],limitations:['Only slides were provided']};
test('consistency stage rejects invented citations and invalid criterion or severity',()=>{
 assert.deepEqual(validateConsistency(consistency,criteria,evidence),consistency);
 for(const change of [{evidenceIds:['fake']},{criterionId:'fake'},{severity:'critical'}])assert.throws(()=>validateConsistency({...consistency,issues:[{...consistency.issues[0],...change}]},criteria,evidence));
 assert.throws(()=>validateFeedback({...feedback,improvements:'malformed'}));
});
test('review resumes after a failed feedback stage without reassessing or changing scores',async()=>{
 const saved:ReviewOutput={};const calls:string[]=[];
 const checkpoint=async(stage:string,status:string,value?:unknown)=>{calls.push(stage+':'+status);if(status==='complete')saved[stage]=value;};
 const adapters={assess:async()=>assessment,reviewConsistency:async()=>consistency,writeFeedback:async()=>{throw Error('Provider unavailable')}};
 await assert.rejects(runReview({key:'test',model:'test'},criteria,evidence,saved,checkpoint,adapters),/Provider unavailable/);
 assert.deepEqual(Object.keys(saved),['assessment','consistency']);assert.equal(calls.at(-1),'feedback:failed');
 const resumed=await runReview({key:'test',model:'test'},criteria,evidence,saved,checkpoint,{assess:async()=>{throw Error('Must not reassess')},reviewConsistency:async()=>{throw Error('Must not repeat review')},writeFeedback:async()=>feedback});
 assert.equal(resumed.assessment?.findings[0].score,8);assert.deepEqual(resumed.feedback,feedback);assert.equal(calls.filter(x=>x==='assessment:complete').length,1);
});
test('invalid provider review is not checkpointed as complete and blocks feedback',async()=>{
 const calls:string[]=[];let feedbackCalled=false;
 await assert.rejects(runReview({key:'test',model:'test'},criteria,evidence,{},async(stage,status)=>{calls.push(stage+':'+status)},{assess:async()=>assessment,reviewConsistency:async()=>({...consistency,issues:[{...consistency.issues[0],evidenceIds:['invented']}]}),writeFeedback:async()=>{feedbackCalled=true;return feedback;}}));
 assert(!calls.includes('consistency:complete'));assert.equal(feedbackCalled,false);assert.equal(calls.at(-1),'consistency:failed');
});

import {assess,validateAssessment} from './assessment.ts';
import type {Assessment,Evidence,RubricCriterion} from './assessment.ts';
import {runReview,reviewConsistency,writeFeedback} from './review.ts';
import type {ReviewStage,ReviewOutput} from './review.ts';
export const specialists=[
 {id:'technical',name:'Technical Judge',focus:'Review implementation, architecture, reliability and the demonstrated technical behavior. Do not assume a repository proves deployed behavior.'},
 {id:'innovation',name:'Innovation Judge',focus:'Review the described differentiation and novel approach. Do not claim global novelty or patentability without evidence.'},
 {id:'ux',name:'UX Judge',focus:'Review demonstrated usability, accessibility and user flow. Do not infer user research or accessibility conformance that was not supplied.'},
 {id:'product',name:'Product Judge',focus:'Review problem fit, product coherence, feasibility and validation. Do not invent traction, business results or market evidence.'},
 {id:'impact',name:'Impact Judge',focus:'Review supported benefits, limitations, sustainability and impact measurements. Separate claimed future benefit from measured outcomes.'},
] as const;
export type SpecialistId=typeof specialists[number]['id'];
type Criteria=RubricCriterion&{judge_domains?:SpecialistId[]};
export type SpecialistOutput=Assessment&{skipped?:boolean};
const assigned=(c:Criteria,id:SpecialistId)=>!c.judge_domains||c.judge_domains.includes(id);
export function combineSpecialists(criteria:Criteria[],evidence:Evidence[],outputs:Partial<Record<SpecialistId,SpecialistOutput>>):Assessment{
 for(const spec of specialists){const subset=criteria.filter(c=>assigned(c,spec.id));if(subset.length)validateAssessment(outputs[spec.id],subset,evidence);}
 const flags:string[]=[];
 const findings=criteria.map(c=>{
  const reviews=specialists.filter(s=>assigned(c,s.id)).map(s=>({name:s.name,finding:outputs[s.id]!.findings.find(f=>f.criterionId===c.id)!}));
  if(!reviews.length)throw Error('Assign at least one specialist to each criterion');
  const scored=reviews.filter(r=>r.finding.score!==null),values=scored.map(r=>r.finding.score!).sort((a,b)=>a-b);
  const score=values.length?(values[Math.floor((values.length-1)/2)]+values[Math.floor(values.length/2)])/2:null;
  const disagreement=values.length>1&&values.at(-1)!-values[0]>=3;
  if(disagreement)flags.push(c.id+': specialist suggestions differ by at least 3 points; organizer review required.');
  const uncertainty=disagreement||scored.length<reviews.length||reviews.some(r=>r.finding.uncertainty==='high')?'high':reviews.some(r=>r.finding.uncertainty==='medium')?'medium':'low';
  const limitations=[...new Set(reviews.flatMap(r=>[...r.finding.limitations.map(text=>r.name+': '+text),...(r.finding.score===null?[r.name+' reported insufficient evidence.']:[])]))];
  return {criterionId:c.id,score,rationale:reviews.map(r=>r.name+': '+r.finding.rationale).join('\n\n'),evidenceIds:[...new Set(reviews.flatMap(r=>r.finding.evidenceIds))],uncertainty,limitations};
 });
 for(const spec of specialists)for(const flag of outputs[spec.id]?.flags||[])flags.push(spec.name+': '+flag);
 return validateAssessment({findings,feedback:'Specialist suggestions were combined by criterion using the median of supported scores. Missing evidence is not scored as zero. The organizer must approve the final decision.',flags:[...new Set(flags)]},criteria,evidence);
}
export async function runSpecialistReview(config:{key:string;model:string},criteria:Criteria[],evidence:Evidence[],saved:ReviewOutput,checkpoint:(stage:ReviewStage,status:'running'|'complete'|'failed',value?:unknown,error?:string)=>Promise<void>,judge=async(id:SpecialistId,subset:Criteria[])=>assess(config,subset,evidence,specialists.find(s=>s.id===id)!.focus),reviews={reviewConsistency,writeFeedback}){
 // Preserve already checkpointed legacy runs; new runs collect all five bounded specialist stages.
 if(saved.assessment)return runReview(config,criteria,evidence,saved,checkpoint);
 const output:ReviewOutput={...saved};
 for(const spec of specialists){const subset=criteria.filter(c=>assigned(c,spec.id));try{
  if(output[spec.id]){if(subset.length)validateAssessment(output[spec.id],subset,evidence);continue;}
  await checkpoint(spec.id,'running');const value:SpecialistOutput=subset.length?validateAssessment(await judge(spec.id,subset),subset,evidence):{findings:[],feedback:'No rubric criteria assigned.',flags:[],skipped:true};
  await checkpoint(spec.id,'complete',value);output[spec.id]=value;
 }catch(e){await checkpoint(spec.id,'failed',undefined,(e as Error).message);throw e;}}
 return runReview(config,criteria,evidence,output,checkpoint,{assess:async()=>combineSpecialists(criteria,evidence,output),...reviews});
}

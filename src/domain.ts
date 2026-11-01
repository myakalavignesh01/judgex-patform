export type Criterion = {id:string;name:string;description:string;weight:number};
export type Project = {id:string;team:string;title:string;track:string;abstract:string;repo:string;members:number;color:string;status:'draft'|'review'|'approved';scores:Record<string,number>;feedback:string;version:number;lockedAt?:string;approvedAt?:string;slot:string;evidence:string[]};
export type Event = {id:string;name:string;date:string;timezone:string;location:string;status:'draft'|'live'|'released';criteria:Criterion[];frozen:boolean;projects:Project[];releasedAt?:string};
export type Audit = {id:string;eventId:string;action:string;at:string};
export type State = {schema:1;events:Event[];audit:Audit[]};
export function validateRubric(criteria:Criterion[]) {
 if(!criteria.length || new Set(criteria.map(c=>c.id)).size!==criteria.length) throw Error('Add unique rubric criteria.');
 if(criteria.some(c=>!c.name.trim()||!Number.isFinite(c.weight)||c.weight<=0)) throw Error('Every criterion needs a name and a positive weight.');
 if(Math.abs(criteria.reduce((s,c)=>s+c.weight,0)-100)>0.00001) throw Error('Rubric weights must add up to 100%.');
}
export function total(criteria:Criterion[],scores:Record<string,number>) {
 validateRubric(criteria);
 for(const c of criteria) if(!Number.isFinite(scores[c.id])||scores[c.id]<0||scores[c.id]>10) throw Error('Score every criterion between 0 and 10.');
 return Math.round(criteria.reduce((s,c)=>s+scores[c.id]*c.weight/10,0)*100)/100;
}
export function releaseIssues(event:Event):string[] {
 const issues:string[]=[];
 if(!event.frozen) issues.push('Freeze the rubric by approving the first review.');
 if(!event.projects.length) issues.push('Add at least one submission.');
 const pending=event.projects.filter(p=>p.status!=='approved').length;
 if(pending) issues.push(`${pending} team${pending===1?'':'s'} still need submission and approval.`);
 try{validateRubric(event.criteria);for(const p of event.projects.filter(p=>p.status==='approved'))total(event.criteria,p.scores);}catch(e){issues.push((e as Error).message);}
 return issues;
}
export function approve(event:Event,id:string,scores:Record<string,number>,feedback:string,reason:string):Event {
 if(event.status==='released') throw Error('Released results are immutable in this milestone.');
 const project=event.projects.find(p=>p.id===id);
 if(!project||project.status==='draft') throw Error('Lock the submission before reviewing.');
 total(event.criteria,scores);
 if(!feedback.trim()) throw Error('Add feedback before approval.');
 const changed=Object.keys(project.scores).length>0&&event.criteria.some(c=>project.scores[c.id]!==scores[c.id]);
 if(changed&&!reason.trim()) throw Error('Explain the score change before approval.');
 return {...event,frozen:true,projects:event.projects.map(p=>p.id===id?{...p,scores:{...scores},feedback:feedback.trim(),status:'approved',approvedAt:new Date().toISOString()}:p)};
}
export function release(event:Event):Event {
 if(event.status==='released') return event;
 const issues=releaseIssues(event);if(issues.length)throw Error(issues.join(' '));
 return {...event,status:'released',releasedAt:new Date().toISOString()};
}
export function lockProject(event:Event,id:string,draft:Pick<Project,'title'|'abstract'|'repo'>):Event {
 if(event.status==='released')throw Error('This event has ended.');
 const p=event.projects.find(p=>p.id===id);
 if(!p||p.status!=='draft')throw Error('This submission is already locked.');
 if(!draft.title.trim()||draft.abstract.trim().length<30)throw Error('Add a title and an abstract of at least 30 characters.');
 if(draft.repo){let u:URL;try{u=new URL(draft.repo);}catch{throw Error('Enter a valid HTTPS repository URL.');}if(u.protocol!=='https:')throw Error('Repository links must use HTTPS.');}
 return {...event,projects:event.projects.map(p=>p.id===id?{...p,...draft,status:'review',version:p.version+1,lockedAt:new Date().toISOString(),evidence:[draft.abstract]}:p)};
}
export const rubric:Criterion[]=[
 {id:'innovation',name:'Innovation',description:'Originality and a clear advantage over existing approaches.',weight:30},
 {id:'execution',name:'Technical execution',description:'Architecture, implementation quality, and a working solution.',weight:30},
 {id:'impact',name:'Impact & feasibility',description:'Clear user value and a credible path to real-world use.',weight:25},
 {id:'presentation',name:'Presentation',description:'Clarity of the problem, demonstration, and project defence.',weight:15}
];
const rows=[
 ['TerraByte','Turning waste into opportunity','Sustainability','#e1efe6','A neighborhood exchange that matches surplus food with community kitchens. The prototype includes inventory listings, time-sensitive matching, and a dashboard for pickup coordination.','10:00'],
 ['Neural Nomads','CareBridge','Healthcare','#e9e4f8','An accessible patient handover workspace for community health workers. A working prototype organizes care notes and follow-up tasks; clinical impact has not been validated.','10:15'],
 ['Pixel Pioneers','AccessAble','Open innovation','#fae8d9','A navigation companion designed around accessible routes. The demo compares step-free paths, explains reported barriers, and lets volunteers submit route corrections.','10:30'],
 ['Circuit Breakers','GridWise','Sustainability','#dfeaf9','A dashboard for understanding campus energy consumption. Sample meter data drives room-level comparisons and an explainable schedule recommendation.','10:45'],
 ['Byte Collective','SkillSwap','Education','#f5e1ed','A peer-learning marketplace for campus communities. Students exchange skills through short sessions, with availability matching and session feedback.','11:00'],
 ['Nova Labs','Your next big idea','Open innovation','#e1ecef','', '11:15']
];
export function seed():State {
 return {schema:1,events:[{id:'launchpad',name:'Launchpad Hackathon 2026',date:'2026-11-14',timezone:'Asia/Kolkata',location:'Innovation Hub · Hyderabad',status:'live',criteria:rubric.map(c=>({...c})),frozen:true,projects:rows.map((r,i):Project=>({id:'p'+i,team:r[0],title:r[1],track:r[2],color:r[3],abstract:r[4],repo:'',members:i%2?3:4,status:i===5?'draft':i<2?'approved':'review',scores:i<2?{innovation:9-i,execution:8.5,impact:8+i*.5,presentation:9}:{},feedback:i<2?'Strong problem definition and a clear prototype. Validate the assumptions with a small user pilot and document the results.':'',version:i===5?0:1,lockedAt:i===5?undefined:'2026-11-01T04:30:00Z',approvedAt:i<2?'2026-11-01T05:00:00Z':undefined,slot:r[5],evidence:i===5?[]:[r[4],'Demo evidence: the team walked through the primary workflow using synthetic data. No live deployment or independent impact measurement was provided.']}))}],audit:[{id:'a1',eventId:'launchpad',action:'Neural Nomads scorecard approved · demo organizer',at:'2026-11-01T05:00:00Z'},{id:'a0',eventId:'launchpad',action:'Rubric v1 frozen for evaluation',at:'2026-11-01T04:30:00Z'}]};
}

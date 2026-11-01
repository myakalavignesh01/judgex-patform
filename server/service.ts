import {sendScheduleEmail} from './schedule-mail.ts';
import {RequestLimiter} from './rate-limit.ts';
import {createServer} from 'node:http';
import {createHash,timingSafeEqual} from 'node:crypto';
import {extractVisualEvidence,sendResultEmail} from './assessment.ts';
import {runSpecialistReview} from './specialists.ts';
import {ingestPublicRepository} from './repository.ts';
import {encryptInvitation,decryptInvitation,sendInvitationEmail} from './invitations.ts';
import {chunkText,embed} from './retrieval.ts';
import {verifyEmailWebhook} from './webhooks.ts';
import {uploadProviderFile,getProviderFile,deleteProviderFile,extractProviderWindow,mediaWindows} from './media.ts';
const env=process.env;
const required=['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVICE_ROLE_KEY','APP_ORIGIN'];
for(const name of required)if(!env[name])throw Error('Missing server configuration: '+name);
const base=env.SUPABASE_URL!.replace(/\/$/,'');
const origin=new URL(env.APP_ORIGIN!).origin;
const provider={key:env.GEMINI_API_KEY||'',model:env.GEMINI_MODEL||''};
async function db(path:string,options:RequestInit={},token=env.SUPABASE_SERVICE_ROLE_KEY!){
 const r=await fetch(base+path,{...options,headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY!,Authorization:'Bearer '+token,'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(30000)});
 const text=await r.text();let data:any;try{data=text?JSON.parse(text):null}catch{data={message:'Invalid service response'}}if(!r.ok)throw Error(data?.message||'Database request failed');return data;
}
const query=(table:string,filter:string,token?:string)=>db('/rest/v1/'+table+'?select=*&'+filter,{},token);
const insert=(table:string,data:unknown)=>db('/rest/v1/'+table,{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(data)});
const update=(table:string,filter:string,data:unknown)=>db('/rest/v1/'+table+'?'+filter,{method:'PATCH',body:JSON.stringify(data)});
async function rawBody(req:AsyncIterable<Uint8Array>){const parts:Buffer[]=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>1024*1024)throw Error('Request body too large');parts.push(Buffer.from(chunk));}return Buffer.concat(parts).toString('utf8');}
async function body(req:AsyncIterable<Uint8Array>){const text=await rawBody(req);return text?JSON.parse(text):{};}
function sameSecret(a:string,b:string){const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb);}
export function sniff(bytes:Uint8Array,mime:string){const b=Buffer.from(bytes);if(mime==='application/pdf')return b.subarray(0,5).toString()==='%PDF-';if(mime==='image/png')return b.subarray(0,8).toString('hex')==='89504e470d0a1a0a';if(mime==='image/jpeg')return b[0]===255&&b[1]===216&&b[2]===255;if(mime==='image/webp')return b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP';if(mime==='video/webm'||mime==='audio/webm')return b.subarray(0,4).toString('hex')==='1a45dfa3';if(mime==='video/mp4'||mime==='audio/mp4')return b.subarray(4,8).toString()==='ftyp';if(mime==='audio/mpeg')return b.subarray(0,3).toString()==='ID3'||(b[0]===255&&(b[1]&224)===224);return false;}
async function artifactBytes(a:any){const r=await fetch(base+'/storage/v1/object/authenticated/judgex-evidence/'+a.object_key,{headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY!,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY},signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('Artifact object is unavailable');const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.length!==a.size_bytes||!sniff(bytes,a.mime_type))throw Error('Artifact size or MIME signature does not match');return bytes;}
async function completeArtifact(id:string,token:string){const [a]=await query('artifacts','id=eq.'+encodeURIComponent(id),token);if(!a)throw Error('Artifact not found or not authorized');const user=await db('/auth/v1/user',{},token);if(a.created_by!==user.id)throw Error('Only the uploader may complete an artifact');if(a.submission_id)throw Error('Artifact submission is locked');const bytes=await artifactBytes(a);
 if(!env.MALWARE_SCAN_URL||!env.MALWARE_SCAN_TOKEN)throw Error('Upload preserved. Malware scanning must be configured before this file can enter evaluation.');
 const scannerUrl=new URL(env.MALWARE_SCAN_URL);if(scannerUrl.protocol!=='https:')throw Error('Scanner requires HTTPS');const scan=await fetch(scannerUrl,{method:'POST',headers:{Authorization:'Bearer '+env.MALWARE_SCAN_TOKEN,'Content-Type':a.mime_type},body:bytes,signal:AbortSignal.timeout(90000)});const result=await scan.json();if(!scan.ok||result.clean!==true){await update('artifacts','id=eq.'+a.id,{scan_state:'rejected'});throw Error('File could not pass the malware scan');}
 await update('artifacts','id=eq.'+a.id,{scan_state:'clean',checksum:createHash('sha256').update(bytes).digest('hex')});return {status:'clean'};
}
class JobYield extends Error{delay:number;constructor(delay=1000){super('Processing checkpoint saved');this.delay=delay;}}
async function extractRemoteArtifact(a:any,submissionId:string,job:any){
 let [checkpoint]=await query('artifact_processing','artifact_id=eq.'+a.id);if(checkpoint?.state==='complete')return;
 if(!checkpoint?.provider_file_name||(checkpoint.provider_expiration&&new Date(checkpoint.provider_expiration).getTime()<Date.now()+60000)){
  const uploaded=await uploadProviderFile(provider,await artifactBytes(a),a.mime_type);
  try{checkpoint=await db('/rest/v1/rpc/register_media_file',{method:'POST',body:JSON.stringify({job_id_input:job.id,lease_token_input:job.lease_token,artifact_id_input:a.id,name_input:uploaded.name,uri_input:uploaded.uri,expiration_input:uploaded.expirationTime||null})});}catch(e){try{await deleteProviderFile(provider,uploaded.name)}catch{}throw e;}
 }
 const file=await getProviderFile(provider,checkpoint.provider_file_name);
 if(file.state==='PROCESSING'){if(Date.now()-new Date(checkpoint.updated_at).getTime()>30*60000)throw Error('Provider media preparation timed out. Use manual review or retry later.');throw new JobYield(15000);}
 if(file.state!=='ACTIVE')throw Error('Provider media preparation failed');
 const video=a.mime_type.startsWith('video/');
 const maximum=Math.min(3600,Math.max(120,Number(env.MAX_PRESENTATION_SECONDS||900)));
 const duration=video?Number((file.videoMetadata?.videoDuration||'').replace(/s$/,'')):1;
 const windows=video?mediaWindows(duration,120,maximum):[{start:0,end:1}];
 const window=windows.find(w=>w.start>=Number(checkpoint.next_offset_seconds));
 if(window){
  const extracted=await extractProviderWindow(provider,file,video?window:undefined);if(extracted.items.length>256||extracted.limitations.length>32)throw Error('Extracted evidence exceeds the per-segment quota');
  extracted.items.push(...extracted.limitations.map(text=>({text:'Extraction limitation: '+text,page:null,timestamp:video?window.start:null})));
  await db('/rest/v1/rpc/commit_media_segment',{method:'POST',body:JSON.stringify({job_id_input:job.id,lease_token_input:job.lease_token,artifact_id_input:a.id,submission_id_input:submissionId,start_input:window.start,end_input:window.end,duration_input:duration,items_input:extracted.items.map(item=>({...item,text:item.text.slice(0,20000)}))})});
  if(window.end<duration)throw new JobYield();
 }
 await update('artifact_processing','artifact_id=eq.'+a.id,{state:'complete',updated_at:new Date().toISOString()});
 try{await deleteProviderFile(provider,file.name);await update('artifact_processing','artifact_id=eq.'+a.id,{provider_uri:null})}catch{console.warn('Provider media cleanup pending; source expires at provider retention limit');}
}
async function processJob(job:any){
 if(job.kind==='email'&&job.payload.scheduleId){
  const [n]=await query('notifications','id=eq.'+job.payload.notificationId);if(!n||n.status!=='queued')return;
  const [slot]=await query('presentation_slots','id=eq.'+job.payload.scheduleId),[event]=await query('events','id=eq.'+job.event_id);
  const members=await query('team_memberships','team_id=eq.'+job.team_id+'&user_id=eq.'+job.payload.userId);
  if(!slot||slot.team_id!==job.team_id||slot.version!==job.payload.scheduleVersion||!event||['released','archived'].includes(event.status)||!members.length||(job.payload.messageKind==='presentation_reminder'&&new Date(slot.starts_at).getTime()<Date.now())){await update('notifications','id=eq.'+n.id+'&status=eq.queued',{status:'cancelled',last_error:'Schedule changed, reminder expired or recipient left the team'});return;}
  const [team]=await query('teams','id=eq.'+job.team_id);const user=await db('/auth/v1/admin/users/'+job.payload.userId);if(!user.email||!user.email_confirmed_at)throw Error('Schedule recipient is not verified');
  const sent=await sendScheduleEmail({key:env.RESEND_API_KEY||'',from:env.RESEND_FROM||'',origin},{id:job.idempotency_key,to:user.email,eventName:event.name,teamName:team.name,startsAt:slot.starts_at,timezone:event.timezone,room:slot.room,kind:job.payload.messageKind});await update('notifications','id=eq.'+n.id+'&status=eq.queued',{status:'sent',provider_id:sent.id});return;
 }
 if(job.kind==='email'&&job.payload.invitationId){
  const [invitation]=await query('invitations','id=eq.'+job.payload.invitationId);if(!invitation||invitation.status!=='pending'||new Date(invitation.expires_at)<new Date())return;
  const [team]=await query('teams','id=eq.'+invitation.team_id),[event]=await query('events','id=eq.'+job.event_id);
  await sendInvitationEmail({key:env.RESEND_API_KEY||'',from:env.RESEND_FROM||'',origin},{id:job.idempotency_key,to:invitation.email,eventName:event.name,teamName:team.name,token:decryptInvitation(job.payload.encryptedToken,env.INVITATION_ENCRYPTION_KEY||'')});return;
 }
 if(job.kind==='email'){
  const [n]=await query('notifications','id=eq.'+job.payload.notificationId);if(!n||n.status!=='queued')return;
  const [event]=await query('events','id=eq.'+job.event_id);if(!event?.released_at)throw Error('Results are not released');
  const [card]=await query('effective_scorecards','id=eq.'+job.payload.scorecardId);if(!card)throw Error('Approved scorecard missing');
  const user=await db('/auth/v1/admin/users/'+job.payload.userId);if(!user.email)throw Error('Recipient has no email');
  const sent=await sendResultEmail({key:env.RESEND_API_KEY||'',from:env.RESEND_FROM||'',origin},{id:job.idempotency_key,to:user.email,eventName:event.name,scorecardId:card.id,decisionVersion:job.payload.decisionVersion});await update('notifications','id=eq.'+n.id,{status:'sent',provider_id:sent.id});return;
 }
 const submissionId=job.payload.submissionId;
 if(!submissionId)throw Error('Job lacks a submission');
 const [submission]=await query('submission_versions','id=eq.'+submissionId);if(!submission)throw Error('Submission not found');
 if(job.kind==='repository'){
  if((await query('evidence_items','submission_id=eq.'+submissionId+'&source=like.github:*')).length)return;
  const snapshot=await ingestPublicRepository(submission.content.repository_url);
  if(snapshot.items.length)await insert('evidence_items',snapshot.items.map(item=>({...item,submission_id:submissionId})));
  await insert('audit_logs',{event_id:job.event_id,action:'repository.ingested',details:{submissionId,commitSha:snapshot.commitSha,limitations:snapshot.limitations}});return;
 }
 if(job.kind==='extract'){
  const artifacts=await query('artifacts','submission_id=eq.'+submissionId);
  for(const artifact of artifacts){if(artifact.scan_state!=='clean')throw Error('Artifact has not passed scanning');
   if(artifact.mime_type.startsWith('video/')||artifact.size_bytes>15*1024*1024){await extractRemoteArtifact(artifact,submissionId,job);continue;}
   if((await query('evidence_items','artifact_id=eq.'+artifact.id)).length)continue;
   const bytes=await artifactBytes(artifact);const extracted=await extractVisualEvidence(provider,{mimeType:artifact.mime_type,base64:Buffer.from(bytes).toString('base64')},artifact.kind==='recording'?'presentation':'slides');
   const items=extracted.items.map((item:any,index:number)=>({extraction_key:artifact.id+':'+index,submission_id:submissionId,artifact_id:artifact.id,source:artifact.object_key,content:item.text,page:item.page??null,timestamp_seconds:item.timestamp??null}));if(items.length)await insert('evidence_items',items);
  }return;
 }
 if(job.kind==='assess'){
  const [rubric]=await query('rubric_versions','id=eq.'+submission.rubric_id);
  const evidence=await query('evidence_items','submission_id=eq.'+submissionId+'&order=created_at.asc');
  if(!rubric||!evidence.length)throw Error('Rubric and evidence are required');
  const existingChunks=await query('evidence_chunks','submission_id=eq.'+submissionId),known=new Set(existingChunks.map((c:any)=>c.evidence_id+':'+c.ordinal));
  let indexed=0;
  for(const e of evidence)for(const [ordinal,text] of chunkText(e.content).entries()){
   if(++indexed>600)throw Error('Evidence exceeds the indexing quota. Use manual review or reduce the submission.');
   if(known.has(e.id+':'+ordinal))continue;
   const vector=env.GEMINI_EMBEDDING_MODEL?await embed({key:provider.key,model:env.GEMINI_EMBEDDING_MODEL},text,'RETRIEVAL_DOCUMENT'):null;
   await db('/rest/v1/evidence_chunks?on_conflict=evidence_id,ordinal',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates'},body:JSON.stringify({evidence_id:e.id,submission_id:submissionId,ordinal,body:text,embedding:vector?'['+vector.join(',')+']':null,embedding_model:env.GEMINI_EMBEDDING_MODEL||null})});
  }
  const snippets=new Map<string,any>();for(const criterion of rubric.criteria){const queryText=criterion.name+' '+(criterion.description||'')+' '+(criterion.evidence_requirements||'');const vector=env.GEMINI_EMBEDDING_MODEL?await embed({key:provider.key,model:env.GEMINI_EMBEDDING_MODEL},queryText,'RETRIEVAL_QUERY'):null;const matches=await db('/rest/v1/rpc/retrieve_evidence',{method:'POST',body:JSON.stringify({submission_id_input:submissionId,query_text:queryText,embedding_input:vector?'['+vector.join(',')+']':null,limit_input:8})});for(const match of matches)snippets.set(match.chunk_id,match);}
  const grounded=new Map<string,any>();for(const match of [...snippets.values()].slice(0,32)){const entry=grounded.get(match.evidence_id)||{id:match.evidence_id,text:'',source:match.source,page:match.page,timestamp:match.timestamp_seconds};entry.text+=(entry.text?'\n[…]\n':'')+match.body;grounded.set(match.evidence_id,entry);}
  const [saved]=await query('assessment_runs','job_id=eq.'+job.id);
  await runSpecialistReview(provider,rubric.criteria,[...grounded.values()],saved?.output||{},async(stage,status,output,error)=>{
   await db('/rest/v1/rpc/checkpoint_assessment',{method:'POST',body:JSON.stringify({job_id_input:job.id,lease_token_input:job.lease_token,stage_input:stage,status_input:status,model_input:provider.model,output_input:output??null,error_input:error??null})});
  });return;
 }
 throw Error('This job type requires an implementation before it can be processed');
}
let draining=false;
async function drain(){if(draining)return;draining=true;try{for(let count=0;count<5;count++){const [job]=await db('/rest/v1/rpc/claim_job',{method:'POST',body:'{}'});if(!job)break;const heartbeat=setInterval(()=>update('jobs','id=eq.'+job.id+'&lease_token=eq.'+job.lease_token+'&status=eq.running',{lease_until:new Date(Date.now()+300000).toISOString()}).catch(()=>{}),60000);try{await processJob(job);await update('jobs','id=eq.'+job.id+'&lease_token=eq.'+job.lease_token,{status:'complete',lease_until:null,lease_token:null,last_error:null})}catch(e){if(e instanceof JobYield){await update('jobs','id=eq.'+job.id+'&lease_token=eq.'+job.lease_token,{status:'queued',attempts:Math.max(0,job.attempts-1),lease_until:null,lease_token:null,last_error:null,available_at:new Date(Date.now()+e.delay).toISOString()});}else await update('jobs','id=eq.'+job.id+'&lease_token=eq.'+job.lease_token,{status:job.attempts>=5?'dead':'retry',lease_until:null,lease_token:null,last_error:(e as Error).message,available_at:new Date(Date.now()+Math.min(3600000,30000*2**job.attempts)+Math.random()*5000).toISOString()});}finally{clearInterval(heartbeat)}}}finally{draining=false}}
const requestLimiter=new RequestLimiter();
const server=createServer(async(req,res)=>{
 const started=Date.now();const requestId=crypto.randomUUID();res.on('finish',()=>console.log(JSON.stringify({event:'http.request',requestId,method:req.method,route:['/health','/v1/invitations/send','/v1/artifacts/complete','/v1/assessments','/webhooks/resend','/internal/jobs'].includes(req.url||'')?req.url:'unknown',status:res.statusCode,durationMs:Date.now()-started}))); res.setHeader('X-Request-Id',requestId);res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.headers.origin===origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');}
 if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
 const json=(status:number,data:unknown)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data))};
 try{
  if(!requestLimiter.allow(req.socket.remoteAddress||'unknown')){res.setHeader('Retry-After','60');json(429,{error:'Too many requests. Try again shortly.',requestId});return;}
  if(req.url==='/health'){json(200,{status:'ok',integrations:{gemini:!!provider.key&&!!provider.model,email:!!env.RESEND_API_KEY&&!!env.RESEND_FROM,scanner:!!env.MALWARE_SCAN_URL&&!!env.MALWARE_SCAN_TOKEN,worker:env.RUN_WORKER==='true',semanticRetrieval:!!provider.key&&!!env.GEMINI_EMBEDDING_MODEL}});return;}
  if(req.url==='/webhooks/resend'&&req.method==='POST'){
   const raw=await rawBody(req);const header=(name:string)=>String(req.headers[name]||'');
   const event=verifyEmailWebhook(raw,{'svix-id':header('svix-id'),'svix-timestamp':header('svix-timestamp'),'svix-signature':header('svix-signature')},env.RESEND_WEBHOOK_SECRET||'');
   await db('/rest/v1/rpc/record_email_delivery',{method:'POST',body:JSON.stringify({webhook_id_input:header('svix-id'),type_input:event.type,provider_id_input:event.data.email_id})});json(200,{received:true});return;
  }
  if(req.url==='/internal/jobs'&&req.method==='POST'){if(!env.WORKER_SECRET||!sameSecret(req.headers.authorization||'','Bearer '+env.WORKER_SECRET)){json(401,{error:'Unauthorized'});return;}await drain();json(200,{processed:true});return;}
  if(req.headers.origin&&req.headers.origin!==origin){json(403,{error:'Origin is not allowed'});return;}
  const token=(req.headers.authorization||'').replace(/^Bearer /,'');if(!token){json(401,{error:'Sign-in required'});return;}
  const user=await db('/auth/v1/user',{},token);if(!user?.email_confirmed_at){json(401,{error:'Verified sign-in required'});return;}
  if(!['/v1/invitations/send','/v1/artifacts/complete','/v1/assessments'].includes(req.url||'')||req.method!=='POST'){json(404,{error:'Route not found',requestId});return;}
  const allowed=await db('/rest/v1/rpc/consume_api_budget',{method:'POST',body:JSON.stringify({user_id_input:user.id,operation_input:req.url})});if(!allowed){res.setHeader('Retry-After','60');json(429,{error:'Request limit reached. Try again in a minute.',requestId});return;}
  const input=await body(req);
  if(req.method==='POST'&&req.url==='/v1/invitations/send'){
   if(!env.RESEND_API_KEY||!env.RESEND_FROM||!env.INVITATION_ENCRYPTION_KEY){json(503,{error:'Configure email delivery and invitation encryption first'});return;}
   if(typeof input.token!=='string'||!(/^[a-f0-9]{64}$/).test(input.token))throw Error('Invalid invitation token');
   const hash=createHash('sha256').update(input.token).digest('hex');
   const [invitation]=await query('invitations','token_hash=eq.'+hash,token);if(!invitation||invitation.status!=='pending')throw Error('Pending invitation not found');
   const [team]=await query('teams','id=eq.'+invitation.team_id,token);if(team?.captain_id!==user.id)throw Error('Captain permission required');
   const logical='invitation:'+invitation.id;if(!(await query('jobs','idempotency_key=eq.'+encodeURIComponent(logical))).length)await insert('jobs',{event_id:team.event_id,team_id:team.id,kind:'email',payload:{invitationId:invitation.id,encryptedToken:encryptInvitation(input.token,env.INVITATION_ENCRYPTION_KEY)},idempotency_key:logical});
   json(202,{status:'queued'});return;
  }
  if(req.method==='POST'&&req.url==='/v1/artifacts/complete'){json(200,await completeArtifact(String(input.artifactId),token));return;}
  if(req.method==='POST'&&req.url==='/v1/assessments'){if(!provider.key||!provider.model){json(503,{error:'Configure Gemini before starting AI assessment'});return;}await db('/rest/v1/rpc/enqueue_assessment',{method:'POST',body:JSON.stringify({submission_id_input:input.submissionId})},token);json(202,{status:'queued'});return;}
  json(404,{error:'Route not found'});
 }catch(e){json(400,{error:(e as Error).message,requestId});}
});
server.listen(Number(env.PORT||8787),'0.0.0.0',()=>console.log('JudgeX API listening; worker enabled: '+(env.RUN_WORKER==='true')));
if(env.RUN_WORKER==='true'){const timer=setInterval(()=>drain().catch(()=>console.error('Worker cycle failed; check database connectivity')),10000);timer.unref();}

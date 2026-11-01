import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {vector} from '@electric-sql/pglite-pgvector';
test('database enforces tenant, invitation, submission, approval and release boundaries',async t=>{
 const db=new PGlite({extensions:{pgcrypto,vector}});t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create schema extensions;create extension pgcrypto with schema extensions;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create function auth.role() returns text language sql stable as $$select 'authenticated'::text$$;
 grant usage on schema public,auth,storage to anon,authenticated,service_role;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to authenticated;
 alter default privileges in schema public grant all on tables to service_role;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);for(const file of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(file,dir),'utf8'));
 const ids=Array.from({length:6},(_,i)=>'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'));
 for(let i=0;i<ids.length;i++)await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[ids[i],'user'+i+'@example.test']);
 async function as(index:number){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[ids[index],JSON.stringify({email:'user'+index+'@example.test'})]);await db.exec('set role authenticated');}
 async function scalar(sql:string,args:unknown[]=[]){const r=await db.query<Record<string,any>>(sql,args);return Object.values(r.rows[0]||{})[0];}
 await as(0);const event1=await scalar("select create_event('Pilot One','Organization One')");await db.query('select publish_event($1)',[event1]);const code1=await scalar('select join_code from events where id=$1',[event1]);
 await as(3);const event2=await scalar("select create_event('Pilot Two','Organization Two')");await db.query('select publish_event($1)',[event2]);
 await as(1);await db.query('select join_event($1)',[code1]);const team1=await scalar("select create_team($1,'First Team')",[event1]);
 await as(2);await db.query('select join_event($1)',[code1]);const team2=await scalar("select create_team($1,'Second Team')",[event1]);
 await t.test('participants cannot read or modify another team or tenant',async()=>{
  await as(1);assert.equal(Number(await scalar('select count(*) from teams where id=$1',[team2])),0);assert.equal(Number(await scalar('select count(*) from events where id=$1',[event2])),0);
  await assert.rejects(db.query("select save_project($1,'Attack','An unauthorized project update with enough text')",[team2]));
  await assert.rejects(db.query("update projects set title='Attack' where team_id=$1",[team1]));
  await assert.rejects(db.query('select release_results($1)',[event1]));
 });
 await t.test('invitation acceptance is bound to the verified intended account',async()=>{
  await as(1);const token=await scalar("select invite_member($1,'user4@example.test')",[team1]);
  await as(5);await assert.rejects(db.query('select accept_invitation($1)',[token]));
  await as(4);await db.query('select accept_invitation($1)',[token]);assert.equal(Number(await scalar('select count(*) from team_memberships where team_id=$1',[team1])),2);await assert.rejects(db.query('select accept_invitation($1)',[token]));
 });
 await t.test('private storage follows the team boundary and pending uploads block lock',async()=>{
  await as(1);const a=await scalar("select create_artifact($1,'slide.png','image/png',8,'image')",[team1]);
  await db.query("insert into storage.objects(bucket_id,name) values('judgex-evidence',$1)",[a.object_key]);
  await assert.rejects(db.query('select remove_pending_artifact($1)',[a.id]));
  await as(2);assert.equal(Number(await scalar('select count(*) from storage.objects where name=$1',[a.object_key])),0);await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('judgex-evidence',$1)",[a.object_key]));
  await as(1);await db.query("select save_project($1,'Draft project','A detailed project abstract with enough content to submit.')",[team1]);await assert.rejects(db.query('select lock_submission($1)',[team1]));
  await db.query("delete from storage.objects where bucket_id='judgex-evidence' and name=$1",[a.object_key]);await db.query('select remove_pending_artifact($1)',[a.id]);
  await assert.rejects(db.query("select create_artifact($1,'recording.mp4','video/mp4',100,'document')",[team1]));
 });
 let submission1:string,submission2:string;
 await t.test('locking preserves snapshots and freezes the rubric',async()=>{
  await as(1);await db.query("select save_project($1,'Working project','A sufficiently detailed project abstract for evaluation.','','A clear system architecture.')",[team1]);submission1=await scalar('select lock_submission($1)',[team1]);
  await assert.rejects(db.query("select save_project($1,'Changed','An attempted edit after a locked submission exists')",[team1]));await assert.rejects(db.query('select lock_submission($1)',[team1]));
  await as(0);await assert.rejects(db.query('select set_rubric($1,$2)',[event1,JSON.stringify([{id:'new',name:'New',weight:100}])]));
  await assert.rejects(db.query('select release_results($1)',[event1]));
  await as(2);await db.query("select save_project($1,'Second project','Another detailed project abstract with source evidence.')",[team2]);submission2=await scalar('select lock_submission($1)',[team2]);
 });
 const scores=JSON.stringify({innovation:8,execution:8,impact:8,presentation:8});
 await t.test('scores are bounded, deterministic and private until release',async()=>{
  await as(0);await assert.rejects(db.query("select approve_scorecard($1,$2,'Feedback')",[submission1,JSON.stringify({innovation:11,execution:8,impact:8,presentation:8})]));
  await db.query("select approve_scorecard($1,$2,'A useful prototype with clearly explained evidence.')",[submission1,scores]);assert.equal(Number(await scalar('select weighted_total from approved_scorecards where submission_id=$1',[submission1])),80);
  await assert.rejects(db.query("select approve_scorecard($1,$2,'Changed feedback')",[submission1,JSON.stringify({innovation:7,execution:8,impact:8,presentation:8})]));
  await as(1);assert.equal(Number(await scalar('select count(*) from approved_scorecards')),0);await assert.rejects(db.query("select approve_scorecard($1,$2,'Participant cannot approve')",[submission1,scores]));
 });
 await t.test('release creates one notification per verified member and is idempotent',async()=>{
  await as(0);await assert.rejects(db.query('select release_results($1)',[event1]));await db.query("select approve_scorecard($1,$2,'Reviewed and approved based on evidence.')",[submission2,scores]);
  await db.query('select release_results($1)',[event1]);assert.equal(Number(await scalar('select count(*) from notifications where event_id=$1',[event1])),3);await db.query('select release_results($1)',[event1]);assert.equal(Number(await scalar("select count(*) from jobs where event_id=$1 and kind='email'",[event1])),3);
  await assert.rejects(db.query("select approve_scorecard($1,$2,'Cannot edit released results','Reason')",[submission1,scores]));
  await as(1);assert.equal(Number(await scalar('select count(*) from approved_scorecards')),1);assert.equal(Number(await scalar('select count(*) from jobs')),0);assert.equal(Number(await scalar('select count(*) from audit_logs')),0);
  await as(3);assert.equal(Number(await scalar('select count(*) from approved_scorecards')),0);
 });
 await t.test('retrieval requires authorization before keyword or vector matching',async()=>{
  await db.exec('reset role');const e=await scalar('select id from evidence_items where submission_id=$1 limit 1',[submission1]);await db.query("insert into evidence_chunks(evidence_id,submission_id,ordinal,body) values($1,$2,0,'A working implementation with a clear architecture')",[e,submission1]);
  await as(1);assert.equal((await db.query('select * from retrieve_evidence($1,$2)',[submission1,'architecture'])).rows.length,1);
  await as(2);await assert.rejects(db.query('select * from retrieve_evidence($1,$2)',[submission1,'architecture']));
  await as(3);await assert.rejects(db.query('select * from retrieve_evidence($1,$2)',[submission1,'architecture']));
 });
 await t.test('only explicit public release exposes totals, never private scorecard data',async()=>{
  await as(1);await assert.rejects(db.query('select set_public_results($1,true)',[event1]));
  await as(0);assert.equal((await db.query('select * from public_leaderboard($1)',[event1])).rows.length,0);await db.query('select set_public_results($1,true)',[event1]);
  await db.exec('set role anon');const rows=(await db.query('select * from public_leaderboard($1)',[event1])).rows;assert.equal(rows.length,2);assert(!Object.keys(rows[0]).includes('feedback'));await assert.rejects(db.query('select * from approved_scorecards'));
 });
 await t.test('email callbacks apply once and late sent events cannot undo delivery',async()=>{
  await db.exec('reset role');await db.query("update notifications set provider_id='provider-test' where user_id=$1",[ids[1]]);
  assert.equal(await scalar("select record_email_delivery('webhook-1','email.delivered','provider-test')"),true);assert.equal(await scalar("select record_email_delivery('webhook-1','email.delivered','provider-test')"),false);await db.query("select record_email_delivery('webhook-2','email.sent','provider-test')");assert.equal(await scalar("select status from notifications where provider_id='provider-test'"),'delivered');
 });
 await t.test('only the worker can claim jobs and expired final leases become dead letters',async()=>{
  await as(0);await assert.rejects(db.query('select * from claim_job()'));await db.exec('reset role');await db.exec("update jobs set status='complete'");
  await db.query("insert into jobs(event_id,team_id,kind,idempotency_key,status,attempts,lease_until) values($1,$2,'extract','expired-test','running',5,now()-interval '1 hour')",[event1,team1]);await db.query("insert into jobs(event_id,team_id,kind,idempotency_key) values($1,$2,'extract','ready-test')",[event1,team1]);
  const claimed=await db.query<{idempotency_key:string;attempts:number}>('select * from claim_job()');assert.equal(claimed.rows[0].idempotency_key,'ready-test');assert.equal(claimed.rows[0].attempts,1);assert.equal(await scalar("select status from jobs where idempotency_key='expired-test'"),'dead');
 });
 await t.test('media checkpoints commit once and reject stale worker leases',async()=>{
  await db.exec("reset role;update jobs set status='complete'");
  const artifact=await scalar("insert into artifacts(team_id,submission_id,object_key,mime_type,size_bytes,kind,scan_state,created_by) values($1,$2,'media-test.webm','video/webm',100,'recording','clean',$3) returning id",[team1,submission1,ids[1]]);
  await db.query('insert into artifact_processing(artifact_id) values($1)',[artifact]);
  await db.query("insert into jobs(event_id,team_id,kind,payload,idempotency_key) values($1,$2,'extract',$3,'media-checkpoint-test')",[event1,team1,JSON.stringify({submissionId:submission1})]);
  const first=(await db.query<Record<string,any>>('select * from claim_job()')).rows[0];
  const sql='select commit_media_segment($1,$2,$3,$4,$5,$6,240,$7)';
  const args=[first.id,first.lease_token,artifact,submission1,0,120,JSON.stringify([{text:'Visible architecture diagram',page:null,timestamp:60}])];
  await assert.rejects(db.query(sql,[first.id,ids[5],...args.slice(2)]));assert.equal(await scalar(sql,args),true);assert.equal(await scalar(sql,args),false);
  assert.equal(Number(await scalar('select count(*) from evidence_items where artifact_id=$1',[artifact])),1);
  await db.query("update jobs set status='queued',lease_token=null,lease_until=null where id=$1",[first.id]);
  const second=(await db.query<Record<string,any>>('select * from claim_job()')).rows[0];assert.notEqual(first.lease_token,second.lease_token);
  await assert.rejects(db.query("select register_media_file($1,$2,$3,'files/test','https://generativelanguage.googleapis.com/v1beta/files/test')",[first.id,first.lease_token,artifact]));
  await db.query("select register_media_file($1,$2,$3,'files/test','https://generativelanguage.googleapis.com/v1beta/files/test')",[first.id,second.lease_token,artifact]);assert.equal(Number(await scalar('select next_offset_seconds from artifact_processing where artifact_id=$1',[artifact])),120);
  const next=[first.id,second.lease_token,artifact,submission1,120,240,JSON.stringify([{text:'Demonstrated working prototype',page:null,timestamp:180}])];
  await assert.rejects(db.query(sql,[first.id,first.lease_token,...next.slice(2)]));
  await assert.rejects(db.query(sql,[...next.slice(0,6),JSON.stringify([{text:'Wrong timestamp',page:null,timestamp:999}])]));
  assert.equal(await scalar(sql,next),true);assert.equal(await scalar('select state from artifact_processing where artifact_id=$1',[artifact]),'complete');
  await as(1);await assert.rejects(db.query(sql,next));
 });
 await t.test('assessment checkpoints enforce stage ordering, leases and participant isolation',async()=>{
  await as(3);const event=await scalar("select create_event('Review stages','Review Test')");await db.query('select publish_event($1)',[event]);const code=await scalar('select join_code from events where id=$1',[event]);
  await as(5);await db.query('select join_event($1)',[code]);const team=await scalar("select create_team($1,'Review Team')",[event]);await db.query("select save_project($1,'Review project','A sufficiently detailed abstract for the review pipeline.')",[team]);const sub=await scalar('select lock_submission($1)',[team]);
  await db.exec("reset role;update jobs set status='complete'");await db.query("insert into jobs(event_id,team_id,kind,payload,idempotency_key) values($1,$2,'assess',$3,'review-stage-test')",[event,team,JSON.stringify({submissionId:sub})]);
  const j=(await db.query<Record<string,any>>('select * from claim_job()')).rows[0];
  const sql='select checkpoint_assessment($1,$2,$3,$4,\'test-model\',$5,$6)';const args=[j.id,j.lease_token,'assessment','running',null,null];
  await as(5);await assert.rejects(db.query(sql,args));await db.exec('reset role');
  await assert.rejects(db.query(sql,[j.id,ids[0],...args.slice(2)]));await db.query(sql,args);await assert.rejects(db.query("select checkpoint_assessment($1,$2,'technical','running','different-model')",[j.id,j.lease_token]));
  await assert.rejects(db.query(sql,[j.id,j.lease_token,'feedback','running',null,null]));
  await assert.rejects(db.query(sql,[j.id,j.lease_token,'assessment','complete',JSON.stringify({findings:[]}),null]));
  for(const stage of ['technical','innovation','ux','product','impact'])await db.query(sql,[j.id,j.lease_token,stage,'complete',JSON.stringify({findings:[]}),null]);
  await db.query(sql,[j.id,j.lease_token,'assessment','complete',JSON.stringify({findings:[]}),null]);
  await db.query(sql,[j.id,j.lease_token,'consistency','failed',null,'Provider unavailable']);assert.equal(await scalar('select status from assessment_runs where job_id=$1',[j.id]),'failed');
  await db.query("update jobs set status='queued',lease_token=null,lease_until=null where id=$1",[j.id]);const next=(await db.query<Record<string,any>>('select * from claim_job()')).rows[0];
  await assert.rejects(db.query(sql,[j.id,j.lease_token,'consistency','running',null,null]));
  await db.query(sql,[j.id,next.lease_token,'consistency','complete',JSON.stringify({summary:'Review',issues:[]}),null]);await db.query(sql,[j.id,next.lease_token,'feedback','complete',JSON.stringify({summary:'Draft'}),null]);
  assert.equal(Number(await scalar('select count(*) from assessment_runs where job_id=$1',[j.id])),1);assert.equal(await scalar('select status from assessment_runs where job_id=$1',[j.id]),'manual_review');
  await as(5);assert.equal(Number(await scalar('select count(*) from assessment_runs where job_id=$1',[j.id])),0);
  await as(3);await db.query("select change_event_state($1,'archive')",[event]);await db.exec('reset role');await assert.rejects(db.query(sql,[j.id,next.lease_token,'feedback','complete',JSON.stringify({summary:'Changed'}),null]));
 });
 await t.test('complete event rules preserve omitted deadlines and enforce registration windows',async()=>{
  await as(3);await db.query("select configure_event($1,$2)",[event2,JSON.stringify({registration_starts_at:'2099-01-01T00:00:00Z',registration_ends_at:'2099-02-01T00:00:00Z',submission_ends_at:'2099-03-01T00:00:00Z',appeals_ends_at:'2099-04-01T00:00:00Z',eligibility:'Students and invited mentors',team_size:3,event_mode:'hybrid'})]);
  await db.query('select configure_event($1,$2)',[event2,JSON.stringify({location:'Auditorium'})]);assert.equal(await scalar('select submission_ends_at is not null from events where id=$1',[event2]),true);
  await assert.rejects(db.query('select configure_event($1,$2)',[event2,JSON.stringify({registration_ends_at:'2098-01-01T00:00:00Z'})]));
  const code=await scalar('select join_code from events where id=$1',[event2]);await as(4);await assert.rejects(db.query('select join_event($1)',[code]));
  await as(3);await db.query('select configure_event($1,$2)',[event2,JSON.stringify({registration_starts_at:null,registration_ends_at:null})]);
 });
 await t.test('project details enter immutable evidence and AI differences require a linked reason',async()=>{
  await as(3);const event=await scalar("select create_event('Full project','Full project organization')");await db.query('select publish_event($1)',[event]);const code=await scalar('select join_code from events where id=$1',[event]);await assert.rejects(db.query("select create_team($1,'Organizer team')",[event]));
  await as(4);await db.query('select join_event($1)',[code]);const team=await scalar("select create_team($1,'Complete Team')",[event]);const details={problem:'Accessibility barriers',solution:'Route planner',tech_stack:'React and PostgreSQL',impact:'Shorter accessible routes',demo_url:'https://example.test/demo',declarations:'Synthetic data, original prototype'};
  await db.query('select save_project_details($1,$2,$3,$4,$5,$6)',[team,'Complete project','A detailed abstract with enough information to submit.','','Architecture description',JSON.stringify(details)]);const sub=await scalar('select lock_submission($1)',[team]);
  assert.equal(await scalar("select content->'details'->>'tech_stack' from submission_versions where id=$1",[sub]),details.tech_stack);await assert.rejects(db.query('select save_project_details($1,$2,$3,$4,$5,$6)',[team,'Edited','An attempted edit after the submission is locked.','','',JSON.stringify(details)]));
  await db.exec('reset role');assert.equal(Number(await scalar("select count(*) from evidence_items where submission_id=$1 and source='project.tech_stack'",[sub])),1);
  const rubric=await scalar('select rubric_id from submission_versions where id=$1',[sub]);const run=await scalar("insert into assessment_runs(submission_id,rubric_id,provider,model,prompt_version,status,output) values($1,$2,'test','test','test','manual_review',$3) returning id",[sub,rubric,JSON.stringify({assessment:{findings:[{criterionId:'innovation',score:7}]}})]);
  await as(3);await assert.rejects(db.query("select approve_scorecard($1,$2,'Final constructive feedback')",[sub,scores]));const card=await scalar("select approve_scorecard($1,$2,'Final constructive feedback','Prototype evidence supports a higher innovation score.')",[sub,scores]);assert.equal(await scalar('select assessment_run_id from approved_scorecards where id=$1',[card]),run);assert.equal(await scalar('select assessment_run_id from score_changes where scorecard_id=$1',[card]),run);
 });
 await t.test('invitation decline is email-bound and API budgets are worker-only and capped',async()=>{
  await as(3);await db.query('select publish_event($1)',[event2]);const code=await scalar('select join_code from events where id=$1',[event2]);await as(4);await db.query('select join_event($1)',[code]);const declineTeam=await scalar("select create_team($1,'Decline test team')",[event2]);const token=await scalar("select invite_member($1,'user5@example.test')",[declineTeam]);await as(1);await assert.rejects(db.query('select decline_invitation($1)',[token]));await as(5);await db.query('select decline_invitation($1)',[token]);await assert.rejects(db.query('select accept_invitation($1)',[token]));await assert.rejects(db.query("select consume_api_budget($1,'/v1/assessments')",[ids[5]]));
  await db.exec('reset role;set role service_role');for(let i=0;i<6;i++)assert.equal(await scalar("select consume_api_budget($1,'/v1/assessments')",[ids[5]]),true);assert.equal(await scalar("select consume_api_budget($1,'/v1/assessments')",[ids[5]]),false);assert.equal(await scalar("select consume_api_budget($1,'/unknown')",[ids[5]]),false);await db.exec('reset role');await db.query("update api_budgets set window_start=now()-interval '2 minutes' where user_id=$1",[ids[5]]);assert.equal(await scalar("select consume_api_budget($1,'/v1/assessments')",[ids[5]]),true);
 });
 await t.test('event lifecycle is organizer-scoped and archives preserve released team results',async()=>{
  await as(1);await assert.rejects(db.query("select change_event_state($1,'archive')",[event1]));
  await as(3);await db.query("select change_event_state($1,'close_registration')",[event2]);assert.equal(await scalar('select status from events where id=$1',[event2]),'evaluating');await db.query("select change_event_state($1,'reopen_registration')",[event2]);await assert.rejects(db.query("select change_event_state($1,'return_to_draft')",[event2]));
  await as(0);await db.query("select change_event_state($1,'archive')",[event1]);await as(1);assert.equal(Number(await scalar('select count(*) from approved_scorecards')),1);
  await assert.rejects(db.query("select create_artifact($1,'later.png','image/png',8,'image')",[team1]));await assert.rejects(db.query('select check_in($1)',[team1]));
  await as(0);await assert.rejects(db.query("select schedule_team($1,now(),'Room')",[team1]));await assert.rejects(db.query('select set_rubric($1,$2)',[event1,JSON.stringify([{id:'new',name:'New',weight:100}])]));const dead=await scalar("select id from jobs where event_id=$1 and status='dead' limit 1",[event1]);if(dead)await assert.rejects(db.query('select retry_job($1)',[dead]));await db.query("select change_event_state($1,'restore')",[event1]);assert.equal(await scalar('select status from events where id=$1',[event1]),'released');await assert.rejects(db.query("select change_event_state($1,'return_to_draft')",[event1]));
 });
 await t.test('presentation scheduling is conflict-checked, versioned and idempotently notifies verified teams',async()=>{
  await as(0);const event=await scalar("select create_event('Presentation operations','Presentation organization')");await db.query('select publish_event($1)',[event]);const code=await scalar('select join_code from events where id=$1',[event]);
  const criteria=[{id:'build',name:'Build',weight:50,description:'Implementation',anchors:'0: no evidence; 10: fully demonstrated',evidence_requirements:'Demo and architecture',tie_break_priority:1},{id:'impact',name:'Impact',weight:50,tie_break_priority:2}];
  await assert.rejects(db.query('select set_rubric($1,$2)',[event,JSON.stringify([criteria[0],{...criteria[1],tie_break_priority:1}])]));await assert.rejects(db.query('select set_rubric($1,$2)',[event,JSON.stringify([{...criteria[0],judge_domains:['unknown']},criteria[1]])]));await db.query('select set_rubric($1,$2)',[event,JSON.stringify(criteria)]);
  await as(1);await db.query('select join_event($1)',[code]);const first=await scalar("select create_team($1,'First presentation')",[event]);await as(2);await db.query('select join_event($1)',[code]);const second=await scalar("select create_team($1,'Second presentation')",[event]);
  await as(0);const schedule='select configure_presentation($1,$2,$3,15,true)';await db.query(schedule,[first,'2099-01-01T10:00:00Z','Studio']);await db.query(schedule,[first,'2099-01-01T10:00:00Z','Studio']);assert.equal(Number(await scalar('select count(*) from notifications where event_id=$1',[event])),2);
  await assert.rejects(db.query(schedule,[second,'2099-01-01T10:05:00Z','Studio']));await db.query(schedule,[second,'2099-01-01T10:30:00Z','Studio']);await db.query(schedule,[first,'2099-01-01T11:00:00Z','Studio']);assert.equal(Number(await scalar("select count(*) from notifications where event_id=$1 and status='cancelled'",[event])),2);assert.equal(Number(await scalar('select version from presentation_slots where team_id=$1',[first])),2);
  await as(1);await assert.rejects(db.query("select set_presentation_state($1,'presenting')",[first]));await db.query('select check_in($1)',[first]);await as(0);await db.query("select set_presentation_state($1,'presenting')",[first]);await db.query("select set_presentation_state($1,'ready')",[second]);await assert.rejects(db.query("select set_presentation_state($1,'presenting')",[second]));await db.query("select set_presentation_state($1,'complete')",[first]);await db.query("select set_presentation_state($1,'presenting')",[second]);
  await db.query("select ask_defence_question($1,'How does your implementation recover from a failed request?','Architecture diagram')",[first]);const question=await scalar('select id from defence_questions where team_id=$1',[first]);
  await as(2);assert.equal(Number(await scalar('select count(*) from defence_questions where team_id=$1',[first])),0);await assert.rejects(db.query("select answer_defence_question($1,'An unauthorized answer')",[question]));
  await as(1);await db.query("select answer_defence_question($1,'Requests retry safely using an idempotency key.')",[question]);await db.query("select save_project($1,'Defence project','A sufficiently detailed abstract for the presentation project.')",[first]);const sub=await scalar('select lock_submission($1)',[first]);assert.equal(await scalar("select content->'defenceAnswers'->0->>'answer' from submission_versions where id=$1",[sub]),'Requests retry safely using an idempotency key.');assert.equal(Number(await scalar("select count(*) from evidence_items where submission_id=$1 and source like 'defence:%'",[sub])),1);await assert.rejects(db.query("select answer_defence_question($1,'A changed answer after locking')",[question]));
  await db.exec('reset role');assert.equal(await scalar("select checksum=encode(extensions.digest(content::text,'sha256'),'hex') from submission_versions where id=$1",[sub]),true);await as(0);await assert.rejects(db.query("select ask_defence_question($1,'A new question after the lock')",[first]));await assert.rejects(db.query('select set_rubric($1,$2)',[event,JSON.stringify(criteria)]));assert.deepEqual((await scalar('select tie_break_scores($1,$2)',[JSON.stringify({build:9,impact:7}),JSON.stringify(criteria)])).map(Number),[9,7]);
 });
 await t.test('released revisions preserve history, reject stale edits and atomically notify only the correct team',async()=>{
  await as(0);const card=await scalar('select id from approved_scorecards where submission_id=$1',[submission1]);
  await db.exec('reset role');await db.query("update events set appeals_ends_at='2099-01-01T00:00:00Z' where id=$1",[event1]);
  await as(1);const appeal=await scalar("select create_appeal($1,'Please review the execution evidence in the submitted architecture.','execution')",[card]);await assert.rejects(db.query("select create_appeal($1,'A duplicate appeal for the same decision version.')",[card]));await assert.rejects(db.query("select revise_released_scorecard($1,1,$2,'Corrected feedback','A participant cannot revise')",[card,scores]));
  await as(3);await assert.rejects(db.query("select revise_released_scorecard($1,1,$2,'Corrected feedback','Another organizer cannot revise')",[card,scores]));await assert.rejects(db.query('select decision_history($1)',[card]));await assert.rejects(db.query('select scorecard_event($1)',[card]));
  await as(0);await db.query("select resolve_appeal($1,'We are checking the submitted architecture.','reviewing')",[appeal]);
  const revised=JSON.stringify({innovation:9,execution:8,impact:8,presentation:8});const sql='select revise_released_scorecard($1,1,$2,$3,$4,$5)';const args=[card,revised,'Updated feedback after checking the submitted architecture.','The architecture evidence supports a higher innovation score.',appeal];const revision=await scalar(sql,args);assert.equal(await scalar(sql,args),revision);
  assert.equal(Number(await scalar('select weighted_total from approved_scorecards where id=$1',[card])),80);assert.equal(Number(await scalar('select weighted_total from effective_scorecards where id=$1',[card])),83);assert.equal(Number(await scalar('select decision_version from effective_scorecards where id=$1',[card])),2);assert.equal(Number(await scalar("select count(*) from notifications where event_id=$1 and kind='decision_revision'",[event1])),2);assert.equal(await scalar('select status from appeals where id=$1',[appeal]),'resolved');assert.equal(Number(await scalar('select count(*) from appeal_updates where appeal_id=$1',[appeal])),2);
  await assert.rejects(db.query(sql,[card,scores,'Different feedback after a stale edit.','A stale change must not overwrite the latest version.',null]));await assert.rejects(db.query("select revise_released_scorecard($1,2,$2,'Valid feedback','A valid reason')",[card,JSON.stringify({innovation:11,execution:8,impact:8,presentation:8})]));await assert.rejects(db.query("update decision_revisions set reason='Changed' where id=$1",[revision]));
  const exported=await scalar('select export_event_results($1)',[event1]);assert.equal(Number(exported.rows.find((r:Record<string,any>)=>r.team==='First Team').approvedTotal),83);const publicRows=(await db.query<Record<string,any>>('select * from public_leaderboard($1)',[event1])).rows;assert.equal(Number(publicRows[0].approved_score),83);
  await as(1);const history=await scalar('select decision_history($1)',[card]);assert.deepEqual(history.map((h:Record<string,any>)=>Number(h.total)),[80,83]);assert.equal(await scalar('select scorecard_event($1)',[card]),event1);assert.equal(Number(await scalar('select count(*) from decision_revisions')),1);assert.equal(Number(await scalar('select count(*) from appeal_updates where appeal_id=$1',[appeal])),2);await db.query("select create_appeal($1,'Please clarify the revised impact decision and evidence link.')",[card]);
  await as(2);assert.equal(Number(await scalar('select count(*) from decision_revisions')),0);await assert.rejects(db.query('select decision_history($1)',[card]));await assert.rejects(db.query('select scorecard_event($1)',[card]));assert.equal(Number(await scalar('select count(*) from appeal_updates where appeal_id=$1',[appeal])),0);
  await as(0);await db.query("select change_event_state($1,'archive')",[event1]);await assert.rejects(db.query("select revise_released_scorecard($1,2,$2,'Another corrected feedback','A correction while archived')",[card,scores]));await db.query("select change_event_state($1,'restore')",[event1]);
 });
 await t.test('result exports require the event organizer and leave an audit record',async()=>{
  await as(1);await assert.rejects(db.query('select export_event_results($1)',[event1]));await as(3);await assert.rejects(db.query('select export_event_results($1)',[event1]));await as(0);const data=await scalar('select export_event_results($1)',[event1]);assert.equal(data.rows.length,2);assert.equal(data.released,true);assert.equal(data.schemaVersion,1);assert.equal(Number(data.rows[0].approvedTotal),83);assert.equal(Number(await scalar("select count(*) from audit_logs where event_id=$1 and action='results.exported'",[event1])),2);
 });
});

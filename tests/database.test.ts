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
 await t.test('event lifecycle is organizer-scoped and archives preserve released team results',async()=>{
  await as(1);await assert.rejects(db.query("select change_event_state($1,'archive')",[event1]));
  await as(3);await db.query("select change_event_state($1,'close_registration')",[event2]);assert.equal(await scalar('select status from events where id=$1',[event2]),'evaluating');await db.query("select change_event_state($1,'reopen_registration')",[event2]);await db.query("select change_event_state($1,'return_to_draft')",[event2]);assert.equal(await scalar('select status from events where id=$1',[event2]),'draft');
  await as(0);await db.query("select change_event_state($1,'archive')",[event1]);await as(1);assert.equal(Number(await scalar('select count(*) from approved_scorecards')),1);
  await as(0);const dead=await scalar("select id from jobs where event_id=$1 and status='dead' limit 1",[event1]);if(dead)await assert.rejects(db.query('select retry_job($1)',[dead]));await db.query("select change_event_state($1,'restore')",[event1]);assert.equal(await scalar('select status from events where id=$1',[event1]),'released');await assert.rejects(db.query("select change_event_state($1,'return_to_draft')",[event1]));
 });
});

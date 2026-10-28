// Isolated Postgres-compatible verification; never connects to Supabase.
// Install @electric-sql/pglite in a temporary tools directory and supply its
// absolute module entry as PGLITE_MODULE_PATH. No production credentials needed.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { PGlite } = await import(process.env.PGLITE_MODULE_PATH || "@electric-sql/pglite");
const db = new PGlite();
const org = "10000000-0000-4000-8000-000000000001";
const otherOrg = "10000000-0000-4000-8000-000000000002";
const callId = "20000000-0000-4000-8000-000000000001";
const actor = "30000000-0000-4000-8000-000000000001";
let checks = 0;
async function rejects(sql, args, code) {
  await assert.rejects(db.query(sql, args), error => error.code === code); checks++;
}
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.organizations(id uuid primary key, is_active boolean default true);
    create table public.organization_modules(organization_id uuid,module_key text,enabled boolean);
    create table public.organization_role_permissions(organization_id uuid,role text,permission_key text,
      allowed boolean,primary key(organization_id,role,permission_key),
      constraint organization_role_permissions_permission_key_check check(permission_key <> ''));
    create table public.organization_user_permission_overrides(organization_id uuid,user_id uuid,permission_key text,
      allowed boolean,constraint organization_user_permission_overrides_permission_key_check check(permission_key <> ''));
    grant usage on schema public to service_role,anon,authenticated;
    grant select on public.organizations,public.organization_modules to service_role;
    insert into public.organizations values('${org}',true),('${otherOrg}',true);
    insert into public.organization_modules values('${org}','ask865',true),('${otherOrg}','ask865',false);
  `);
  await db.exec(await readFile(new URL("../supabase/migrations/20261028031738_ask865_call_intelligence.sql", import.meta.url), "utf8"));
  const settings = (await db.query("select * from public.ask865_call_settings")).rows;
  assert.equal(settings.length, 1); assert.equal(settings[0].enabled, false); checks++;
  await db.exec("set role service_role");
  const evaluation = { category: "sales", score: 60, reasons: ["below_70"], state: "graded", rubricVersion: "pilot-1", assessment: { summary: "synthetic" } };
  await db.query(`insert into public.ask865_call_reviews(id,organization_id,provider_call_id,recording_id,employee_id,direction,started_at,category,score,ai_category,ai_score,evaluation,scoring_allowed,consent_reference,policy_version,status,expires_at)
    values($1,$2,'synthetic-id','synthetic-recording','synthetic-agent','inbound',now(),'sales',60,'sales',60,$3,true,'synthetic-consent','test-policy','needs_review',now()+interval '730 days')`, [callId,org,JSON.stringify(evaluation)]);
  const correct = "select public.atlas_ask865_correct_call($1,$2,$3,$4,$5,$6,$7,$8) as revision";
  const args = [org,callId,actor,1,"sales",85,"coaching_assigned","Verified synthetic evidence"];
  const corrected = await db.query(correct,args); assert.equal(corrected.rows[0].revision,2); checks++;
  const record = (await db.query("select * from public.ask865_call_reviews where id=$1",[callId])).rows[0];
  assert.equal(record.ai_score,60); assert.equal(record.score,85); checks++;
  const audit = (await db.query("select * from public.ask865_call_audit")).rows;
  assert.equal(audit.length,1); assert.equal(audit[0].actor_id,actor); assert.equal(audit[0].before_state.score,60); assert.equal(audit[0].after_state.score,85); checks++;
  await rejects(correct,args,"40001"); // stale manager write
  await rejects(correct,[otherOrg,callId,actor,2,"sales",90,"resolved","Cross organization attempt"],"42501");
  await db.exec("reset role; update public.organization_modules set enabled=true; set role service_role;");
  await rejects(correct,[otherOrg,callId,actor,2,"sales",90,"resolved","Cross organization attempt"],"P0002");
  await rejects(correct,[org,callId,actor,2,"vendor",80,"resolved","Wrong excluded score"],"23514");
  await rejects("update public.ask865_call_reviews set score=99 where id=$1",[callId],"42501");
  await rejects("update public.ask865_call_reviews set ai_score=99 where id=$1",[callId],"42501");
  await rejects("update public.ask865_call_audit set reason='tampered'",[],"42501");
  await rejects("delete from public.ask865_call_audit",[],"42501");
  assert.equal((await db.query("select count(*)::int n from public.ask865_call_audit")).rows[0].n,1); checks++;
  const reclassified = await db.query(correct,[org,callId,actor,2,"vendor",null,"resolved","Confirmed a vendor call"]);
  assert.equal(reclassified.rows[0].revision,3);
  const excluded = (await db.query("select score,recording_id,evaluation,expires_at-started_at as retention from public.ask865_call_reviews where id=$1",[callId])).rows[0];
  assert.equal(excluded.score,null); assert.equal(excluded.recording_id,null); assert.equal(excluded.evaluation.assessment,null); checks++;
  await db.exec("reset role; set role authenticated");
  await rejects("select * from public.ask865_call_reviews",[],"42501");
  await rejects("select * from public.ask865_call_audit",[],"42501");
  await rejects("select * from public.ask865_call_settings",[],"42501");
  await rejects(correct,args,"42501");
  await db.exec("reset role; set role anon");
  await rejects("select * from public.ask865_call_reviews",[],"42501");
  await rejects(correct,args,"42501");
  await db.exec("reset role; set role service_role");
  // Duplicate ingestion does not replace the corrected score/classification.
  await db.query(`insert into public.ask865_call_reviews(organization_id,provider_call_id,direction,started_at,category,score,ai_category,ai_score,evaluation,scoring_allowed,policy_version,status,expires_at)
    values($1,'synthetic-id','inbound',now(),'sales',10,'sales',10,'{}',true,'test-policy','needs_review',now()+interval '1 day')
    on conflict(organization_id,provider_call_id) do nothing`,[org]);
  assert.equal((await db.query("select revision from public.ask865_call_reviews where id=$1",[callId])).rows[0].revision,3); checks++;
  await db.query("delete from public.ask865_call_reviews where organization_id=$1",[otherOrg]);
  assert.equal((await db.query("select count(*)::int n from public.ask865_call_reviews")).rows[0].n,1); checks++;
  await db.query("delete from public.ask865_call_reviews where organization_id=$1",[org]);
  assert.equal((await db.query("select count(*)::int n from public.ask865_call_audit")).rows[0].n,0); checks++;
  await db.exec("reset role");
  await db.exec(await readFile(new URL("../supabase/migrations/20261028141407_ask865_recording_jobs.sql", import.meta.url), "utf8"));
  await db.query("update public.ask865_call_settings set enabled=true,policy_version='synthetic-policy',provider_account_id='123' where organization_id=$1",[org]);
  await db.exec("set role authenticated");
  await rejects("select * from public.ask865_recording_jobs",[],"42501");
  await rejects("select * from public.atlas_ask865_claim_recording($1,'123')",[org],"42501");
  await db.exec("reset role; set role service_role");
  const jobData = JSON.stringify({ recordingIds:["456"],direction:"inbound",startedAt:new Date().toISOString(),durationSeconds:30,employeeId:null });
  await db.query("insert into public.ask865_recording_jobs(organization_id,provider_account_id,provider_call_id,job_data) values($1,'123','synthetic-recording',$2)",[org,jobData]);
  await db.query("insert into public.ask865_recording_jobs(organization_id,provider_account_id,provider_call_id,job_data) values($1,'123','synthetic-recording',$2) on conflict(organization_id,provider_account_id,provider_call_id) do nothing",[org,jobData]);
  assert.equal((await db.query("select count(*)::int n from public.ask865_recording_jobs")).rows[0].n,1); checks++;
  await rejects("select * from public.atlas_ask865_claim_recording($1,'wrong')",[org],"42501");
  await rejects("select * from public.atlas_ask865_claim_recording($1,'123')",[otherOrg],"42501");
  const first=(await db.query("select * from public.atlas_ask865_claim_recording($1,'123')",[org])).rows[0];
  assert.equal(first.attempts,1); assert.ok(first.lease_token); checks++;
  assert.equal((await db.query("select * from public.atlas_ask865_claim_recording($1,'123')",[org])).rows.length,0); checks++;
  await db.query("update public.ask865_recording_jobs set archive_file_id='stable-file',lease_until=now()-interval '1 minute' where organization_id=$1 and id=$2",[org,first.id]);
  const second=(await db.query("select * from public.atlas_ask865_claim_recording($1,'123')",[org])).rows[0];
  assert.equal(second.archive_file_id,"stable-file"); assert.equal(second.attempts,2); assert.notEqual(first.lease_token,second.lease_token); checks++;
  assert.equal((await db.query("update public.ask865_recording_jobs set state='completed' where organization_id=$1 and id=$2 and lease_token=$3 returning id",[org,first.id,first.lease_token])).rows.length,0); checks++;
  await db.query("update public.ask865_recording_jobs set lease_until=now()-interval '1 minute' where organization_id=$1 and id=$2",[org,first.id]);
  const third=(await db.query("select * from public.atlas_ask865_claim_recording($1,'123')",[org])).rows[0]; assert.equal(third.attempts,3); checks++;
  await db.query("update public.ask865_recording_jobs set lease_until=now()-interval '1 minute' where organization_id=$1 and id=$2",[org,first.id]);
  assert.equal((await db.query("select * from public.atlas_ask865_claim_recording($1,'123')",[org])).rows.length,0); checks++;
  assert.equal((await db.query("select state,last_error from public.ask865_recording_jobs")).rows[0].state,"failed"); checks++;
  await rejects("insert into public.ask865_recording_jobs(organization_id,provider_account_id,provider_call_id,job_data) values($1,'123','bad',$2)",[org,JSON.stringify({transcript:"must not persist"})],"23514");
  console.log(`Call database: ${checks} checks passed; isolated synthetic data only.`);
} finally { await db.close(); }

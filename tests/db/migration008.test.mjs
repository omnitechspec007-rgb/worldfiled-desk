// Real-Postgres tests for migrations 008 and 009. CI supplies PostgreSQL 16; local runs may use embedded-postgres.
import pg from "pg";
import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";

const root = new URL("../../supabase/", import.meta.url).pathname;
let server = null;
let admin;
if (process.env.TEST_DATABASE_URL) {
  admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
} else {
  const EmbeddedPostgres = (await import("embedded-postgres")).default;
  server = new EmbeddedPostgres({ databaseDir: "./data8", user: "postgres", password: "pw", port: 54338, persistent: false });
  await server.initialise(); await server.start();
  admin = new pg.Client({ host: "localhost", port: 54338, user: "postgres", password: "pw", database: "postgres" });
}
await admin.connect();
let pass = 0, fail = 0;
const ok = (label, value) => { console.log((value ? "PASS " : "FAIL ") + label); value ? pass++ : fail++; };
const hash = (value) => createHash("sha256").update(value).digest("hex");
try {
  await admin.query("create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;");
  await admin.query(fs.readFileSync(root + "schema.sql", "utf8"));
  const migration = fs.readFileSync(root + "migrations/008_story_decision_idempotency.sql", "utf8");
  await admin.query(migration);
  await admin.query(migration);
  ok("migration 008 applies twice without duplicating or failing", true);
  const migration9 = fs.readFileSync(root + "migrations/009_claim_verification_idempotency.sql", "utf8");
  await admin.query(migration9);
  await admin.query(migration9);
  ok("migration 009 applies twice without duplicating or failing", true);

  const storyId = (await admin.query("insert into stories(headline,cluster_key) values('Test decision','test-decision-1') returning id")).rows[0].id;
  const key = randomUUID();
  const payload = JSON.stringify({ storyId, decision: "approved", notes: "Reviewed sources", acknowledged: true });
  const digest = hash(payload);
  await admin.query("grant usage on schema public to service_role");
  await admin.query("set role service_role");
  const invoke = (idempotencyKey, requestHash, decision = "approved", notes = "Reviewed sources", acknowledged = true) =>
    admin.query("select public.record_story_editorial_decision($1,$2,$3,$4,$5,$6) as result", [idempotencyKey, requestHash, storyId, decision, notes, acknowledged]);
  const first = (await invoke(key, digest)).rows[0].result;
  ok("first request commits success", first.status === 200 && first.body.ok === true && first.replayed === false);
  const replay = (await invoke(key, digest)).rows[0].result;
  ok("same key and payload replays original success", replay.status === 200 && replay.replayed === true && JSON.stringify(replay.body) === JSON.stringify(first.body));
  const mismatch = (await invoke(key, hash(payload + "changed"), "rejected", "Changed", false)).rows[0].result;
  ok("same key with changed payload is rejected", mismatch.status === 409 && mismatch.body.error === "idempotency_key_reused");
  await admin.query("reset role");
  const counts = await admin.query("select (select count(*) from editorial_decisions where story_id=$1) decisions, (select count(*) from audit_events where entity_id=$1::text::text) audits, (select count(*) from idempotency_records where idempotency_key=$2) keys", [storyId, key]);
  ok("replay and conflict create no duplicate decision or audit", Number(counts.rows[0].decisions) === 1 && Number(counts.rows[0].audits) === 1 && Number(counts.rows[0].keys) === 1);
  const audit = await admin.query("select detail from audit_events where entity_id=$1::text order by id desc limit 1", [storyId]);
  ok("audit event includes the idempotency key for traceability", audit.rows[0].detail.idempotency_key === key);
  const status = (await admin.query("select editorial_status from stories where id=$1", [storyId])).rows[0].editorial_status;
  ok("story status and appended decision agree", status === "approved");
  await admin.query("set role service_role");

  const invalidKey = randomUUID();
  const invalid = (await invoke(invalidKey, hash("invalid"), "approved", "x", false)).rows[0].result;
  ok("approval without acknowledgement is refused", invalid.status === 400);
  const notFound = (await admin.query("select public.record_story_editorial_decision($1,$2,$3,'rejected','',false) as result", [randomUUID(), hash("missing"), randomUUID()])).rows[0].result;
  ok("missing story is refused without recording a key", notFound.status === 404);

  // Inject an audit failure: the transaction must roll back decision, status, and idempotency row together.
  await admin.query("reset role");
  await admin.query(`create function public.test_fail_audit() returns trigger language plpgsql as $$ begin raise exception 'injected audit failure'; end $$;`);
  await admin.query("create trigger test_fail_audit before insert on audit_events for each row execute function public.test_fail_audit()");
  await admin.query("set role service_role");
  const failKey = randomUUID();
  let rolledBack = false;
  try { await invoke(failKey, hash("rollback"), "rejected", "", false); } catch { rolledBack = true; }
  ok("audit failure propagates instead of reporting saved", rolledBack);
  await admin.query("reset role");
  await admin.query("drop trigger test_fail_audit on audit_events; drop function public.test_fail_audit()");
  const rollbackState = await admin.query("select (select count(*) from editorial_decisions where story_id=$1 and decision='rejected') decisions, (select count(*) from idempotency_records where idempotency_key=$2) keys, (select editorial_status from stories where id=$1) status", [storyId, failKey]);
  ok("audit failure rolls back decision, status and idempotency record", Number(rollbackState.rows[0].decisions) === 0 && Number(rollbackState.rows[0].keys) === 0 && rollbackState.rows[0].status === "approved");

  await admin.query("set role service_role");
  const retry = (await invoke(failKey, hash("rollback"), "rejected", "", false)).rows[0].result;
  ok("same key can safely retry after rolled-back transaction", retry.status === 200 && retry.replayed === false);
  await admin.query("reset role");

  const grants = await admin.query("select has_table_privilege('anon','idempotency_records','select') anon_read, has_table_privilege('authenticated','idempotency_records','insert') auth_write, has_function_privilege('anon','public.record_story_editorial_decision(uuid,text,uuid,text,text,boolean)','execute') anon_execute, has_function_privilege('service_role','public.record_story_editorial_decision(uuid,text,uuid,text,text,boolean)','execute') service_execute");
  ok("idempotency storage and RPC are unavailable to browser roles", !grants.rows[0].anon_read && !grants.rows[0].auth_write && !grants.rows[0].anon_execute && grants.rows[0].service_execute);

  // Two independent sessions submit the same logical decision at the same time.
  const story2 = (await admin.query("insert into stories(headline,cluster_key) values('Concurrent test','test-decision-concurrent') returning id")).rows[0].id;
  const key2 = randomUUID();
  const hash2 = hash(JSON.stringify({ storyId: story2, decision: "rejected", notes: "Concurrent", acknowledged: false }));
  const second = new pg.Client(process.env.TEST_DATABASE_URL
    ? { connectionString: process.env.TEST_DATABASE_URL }
    : { host: "localhost", port: 54338, user: "postgres", password: "pw", database: "postgres" });
  await second.connect();
  await admin.query("set role service_role");
  await second.query("set role service_role");
  const concurrentCall = (client) => client.query("select public.record_story_editorial_decision($1,$2,$3,'rejected','Concurrent',false) as result", [key2, hash2, story2]);
  const [left, right] = await Promise.all([concurrentCall(admin), concurrentCall(second)]);
  await admin.query("reset role");
  await second.query("reset role");
  const outcomes = [left.rows[0].result, right.rows[0].result];
  const concurrentState = await admin.query("select (select count(*) from editorial_decisions where story_id=$1) decisions, (select count(*) from audit_events where entity_id=$1::text) audits, (select count(*) from idempotency_records where idempotency_key=$2) keys", [story2, key2]);
  ok("concurrent same-key requests produce one commit and one replay", outcomes.every(x => x.status === 200) && outcomes.filter(x => x.replayed === false).length === 1 && outcomes.filter(x => x.replayed === true).length === 1);
  ok("concurrent retry creates exactly one decision, audit event and idempotency record", Number(concurrentState.rows[0].decisions) === 1 && Number(concurrentState.rows[0].audits) === 1 && Number(concurrentState.rows[0].keys) === 1);
  await second.end();

  // Claim-verification RPC integration: real tables, real transaction, and independent sessions.
  const story3 = (await admin.query("insert into stories(headline,cluster_key) values('Claim RPC test','test-claim-rpc') returning id")).rows[0].id;
  const source3 = (await admin.query("insert into retrieved_sources(url,url_hash,title,publisher,content_status,extract) values($1,$2,'Official notice','Test agency','extracted','Evidence passage') returning id", ["https://example.org/claim-rpc", hash("https://example.org/claim-rpc")])).rows[0].id;
  const claim3 = (await admin.query("insert into claims(story_id,claim_text,claim_hash,category) values($1,'The agency published the policy on 5 November.',$2,'date') returning id", [story3, hash("The agency published the policy on 5 November.")])).rows[0].id;
  await admin.query("insert into claim_evidence(claim_id,source_id,passage,passage_hash,extraction_status,is_contradiction) values($1,$2,'The agency published the policy on 5 November.', $3,'extracted',false)", [claim3, source3, hash("evidence-passage-1")]);
  await admin.query("grant usage on schema public to service_role");
  await admin.query("set role service_role");
  const claimKey = randomUUID();
  const claimDigest = hash(JSON.stringify({storyId:story3,claimId:claim3,outcome:"SUPPORTED",notes:"Checked official notice.",contradictionResolution:""}));
  const claimCall = (client, key=claimKey, digest=claimDigest, outcome="SUPPORTED", notes="Checked official notice.", resolution="") =>
    client.query("select public.record_claim_verification_decision($1,$2,$3,$4,$5,$6,$7) as result", [key,digest,story3,claim3,outcome,notes,resolution]);
  const claimFirst = (await claimCall(admin)).rows[0].result;
  ok("claim decision RPC records a supported claim with checked passage", claimFirst.status===200 && claimFirst.replayed===false && claimFirst.body.result.outcome==="SUPPORTED");
  const claimReplay = (await claimCall(admin)).rows[0].result;
  ok("claim decision RPC replays the original result", claimReplay.status===200 && claimReplay.replayed===true && claimReplay.body.result.id===claimFirst.body.result.id);
  const claimMismatch = (await claimCall(admin,claimKey,hash("different request"),"CONTRADICTED","Different")).rows[0].result;
  ok("claim decision rejects same key with changed request", claimMismatch.status===409);
  await admin.query("reset role");
  const claimCounts = await admin.query("select (select count(*) from verification_results where claim_id=$1) decisions,(select count(*) from audit_events where entity_id=$1::text) audits,(select count(*) from idempotency_records where idempotency_key=$2) keys", [claim3,claimKey]);
  ok("claim replay creates one decision, one audit event and one idempotency record", Number(claimCounts.rows[0].decisions)===1 && Number(claimCounts.rows[0].audits)===1 && Number(claimCounts.rows[0].keys)===1);
  const claimAudit = await admin.query("select detail from audit_events where entity_id=$1::text order by id desc limit 1",[claim3]);
  ok("claim audit event contains idempotency key", claimAudit.rows[0].detail.idempotency_key===claimKey);
  const claimStatus = (await admin.query("select verification_status from stories where id=$1",[story3])).rows[0].verification_status;
  ok("claim decision updates story verification status atomically", claimStatus==="in_progress");

  // Contradiction gate is evaluated inside the database transaction.
  await admin.query("insert into claim_evidence(claim_id,source_id,passage,passage_hash,extraction_status,is_contradiction) values($1,$2,'A conflicting publication date is reported.', $3,'extracted',true)", [claim3,source3,hash("evidence-passage-2")]);
  await admin.query("set role service_role");
  const contradictionKey = randomUUID();
  const blocked = (await claimCall(admin,contradictionKey,hash("blocked"),"SUPPORTED","Reviewed")).rows[0].result;
  ok("contradictory evidence blocks supported decision without specific reconciliation", blocked.status===409);
  const resolved = (await claimCall(admin,contradictionKey,hash("resolved"),"SUPPORTED","Reviewed","The conflicting passage refers to a separate publication date. The official notice and its publication record directly identify the date stated in this claim, and the conflicting report does not describe the same notice or event.")).rows[0].result;
  ok("supported decision with explicit reconciliation is accepted", resolved.status===200);
  await admin.query("reset role");

  // Audit failure must roll back claim decision, story status and idempotency record.
  await admin.query(`create function public.test_fail_claim_audit() returns trigger language plpgsql as $ begin if new.entity_type='claim' then raise exception 'injected claim audit failure'; end if; return new; end $;`);
  await admin.query("create trigger test_fail_claim_audit before insert on audit_events for each row execute function public.test_fail_claim_audit()");
  await admin.query("set role service_role");
  const rollbackClaimKey = randomUUID();
  let claimRolledBack = false;
  try { await claimCall(admin,rollbackClaimKey,hash("claim-rollback"),"PARTIALLY_SUPPORTED","Partial"); } catch { claimRolledBack = true; }
  ok("claim audit failure propagates instead of reporting success", claimRolledBack);
  await admin.query("reset role");
  await admin.query("drop trigger test_fail_claim_audit on audit_events; drop function public.test_fail_claim_audit()");
  const claimRollbackState = await admin.query("select (select count(*) from verification_results where claim_id=$1 and outcome='PARTIALLY_SUPPORTED') decisions,(select count(*) from idempotency_records where idempotency_key=$2) keys,(select verification_status from stories where id=$3) status",[claim3,rollbackClaimKey,story3]);
  ok("claim audit failure rolls back decision and idempotency record", Number(claimRollbackState.rows[0].decisions)===0 && Number(claimRollbackState.rows[0].keys)===0 && claimRollbackState.rows[0].status==="in_progress");

  // Same-key requests in two independent sessions create exactly one claim decision.
  const concurrentClaimKey = randomUUID();
  const concurrentClaimHash = hash("claim concurrent test");
  const secondClaim = new pg.Client(process.env.TEST_DATABASE_URL ? {connectionString:process.env.TEST_DATABASE_URL} : {host:"localhost",port:54338,user:"postgres",password:"pw",database:"postgres"});
  await secondClaim.connect();
  await admin.query("set role service_role");
  await secondClaim.query("set role service_role");
  const [claimLeft,claimRight] = await Promise.all([
    claimCall(admin,concurrentClaimKey,concurrentClaimHash,"PARTIALLY_SUPPORTED","Concurrent"),
    claimCall(secondClaim,concurrentClaimKey,concurrentClaimHash,"PARTIALLY_SUPPORTED","Concurrent")
  ]);
  await admin.query("reset role");
  await secondClaim.query("reset role");
  const claimOutcomes=[claimLeft.rows[0].result,claimRight.rows[0].result];
  ok("concurrent claim retries yield one commit and one replay", claimOutcomes.every(x=>x.status===200) && claimOutcomes.filter(x=>x.replayed===false).length===1 && claimOutcomes.filter(x=>x.replayed===true).length===1);
  const concurrentClaimState=await admin.query("select (select count(*) from verification_results where claim_id=$1 and outcome='PARTIALLY_SUPPORTED') decisions,(select count(*) from audit_events where entity_id=$1::text) audits,(select count(*) from idempotency_records where idempotency_key=$2) keys",[claim3,concurrentClaimKey]);
  ok("concurrent claim retry creates exactly one decision, audit and key", Number(concurrentClaimState.rows[0].decisions)===1 && Number(concurrentClaimState.rows[0].audits)===1 && Number(concurrentClaimState.rows[0].keys)===1);
  await secondClaim.end();
} finally {
  await admin.end(); if (server) await server.stop();
}
console.log(`\\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

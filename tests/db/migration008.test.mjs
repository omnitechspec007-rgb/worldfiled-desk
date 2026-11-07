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
  const migration10 = fs.readFileSync(root + "migrations/010_claim_evidence_idempotency.sql", "utf8");
  await admin.query(migration10);
  await admin.query(migration10);
  ok("migration 010 applies twice without duplicating or failing", true);
  const migration11 = fs.readFileSync(root + "migrations/011_material_claim_idempotency.sql", "utf8");
  await admin.query(migration11);
  await admin.query(migration11);
  ok("migration 011 applies twice without duplicating or failing", true);

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
  const concurrentState = await admin.query("select (select count(*) from editorial_decisions where story_id=$1) decisions, (select count(*) from audit_events where entity_id=$1::text and event_type='story_rejected') audits, (select count(*) from idempotency_records where idempotency_key=$2) keys", [story2, key2]);
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
  await admin.query(`create function public.test_fail_claim_audit() returns trigger language plpgsql as $test$ begin if new.entity_type='claim' then raise exception 'injected claim audit failure'; end if; return new; end $test$;`);
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
  const concurrentClaimState=await admin.query("select (select count(*) from verification_results where claim_id=$1 and outcome='PARTIALLY_SUPPORTED') decisions,(select count(*) from audit_events where entity_id=$1::text and event_type='claim_verification_partially_supported') audits,(select count(*) from idempotency_records where idempotency_key=$2) keys",[claim3,concurrentClaimKey]);
  ok("concurrent claim retry creates exactly one decision, audit and key", Number(concurrentClaimState.rows[0].decisions)===1 && Number(concurrentClaimState.rows[0].audits)===1 && Number(concurrentClaimState.rows[0].keys)===1);
  await secondClaim.end();

  // Material claim intake RPC: insert, status invalidation, duplicate protection and audit are atomic.
  const story8=(await admin.query("insert into stories(headline,cluster_key) values('Material claim intake test','test-material-claim') returning id")).rows[0].id;
  await admin.query("update stories set verification_status='verified' where id=$1",[story8]);
  const claimText8="The regulator published the notice on 7 November.";
  const claimHash8=hash(claimText8.trim().toLowerCase());
  const claimKey8=randomUUID();
  const claimRequestHash8=hash(JSON.stringify({storyId:story8,claimText:claimText8,category:"date"}));
  await admin.query("set role service_role");
  const claimAddCall=(client,key=claimKey8,digest=claimRequestHash8,textValue=claimText8,category="date",fingerprint=claimHash8)=>
    client.query("select public.add_material_claim($1,$2,$3,$4,$5,$6) as result",[key,digest,story8,textValue,fingerprint,category]);
  const claimAddFirst=(await claimAddCall(admin)).rows[0].result;
  ok("material claim intake inserts claim and invalidates prior story clearance",claimAddFirst.status===200 && claimAddFirst.body.claim.claim_text===claimText8 && (await admin.query("select verification_status from stories where id=$1",[story8])).rows[0].verification_status==="in_progress");
  const claimAddReplay=(await claimAddCall(admin)).rows[0].result;
  ok("material claim intake replays the original result",claimAddReplay.status===200 && claimAddReplay.replayed===true && claimAddReplay.body.claim.id===claimAddFirst.body.claim.id);
  const claimAddMismatch=(await claimAddCall(admin,claimKey8,hash("changed claim"),claimText8,"other")).rows[0].result;
  ok("material claim idempotency key rejects changed request",claimAddMismatch.status===409);
  const duplicateClaim=(await claimAddCall(admin,randomUUID(),hash("same claim duplicate"))).rows[0].result;
  ok("same claim fingerprint does not create a duplicate",duplicateClaim.status===200 && duplicateClaim.body.note.includes("already recorded"));
  const claimFingerprintConflict=(await claimAddCall(admin,randomUUID(),hash("different case wording"),claimText8.toUpperCase(),"date")).rows[0].result;
  ok("normalized claim fingerprint cannot silently overwrite different displayed wording",claimFingerprintConflict.status===409);
  await admin.query("reset role");
  const claimAddCounts=await admin.query("select (select count(*) from claims where story_id=$1) claims,(select count(*) from audit_events where entity_id=(select id::text from claims where story_id=$1 limit 1) and event_type='material_claim_added') audits,(select count(*) from idempotency_records where endpoint_key='material_claim_add' and idempotency_key=$2) keys",[story8,claimKey8]);
  ok("claim replay and duplicate create one claim and one audit event",Number(claimAddCounts.rows[0].claims)===1 && Number(claimAddCounts.rows[0].audits)===1 && Number(claimAddCounts.rows[0].keys)===1);

  // Material claim audit failure rolls back both the new claim and status invalidation.
  const story9=(await admin.query("insert into stories(headline,cluster_key) values('Claim rollback test','test-claim-rollback') returning id")).rows[0].id;
  await admin.query("update stories set verification_status='verified' where id=$1",[story9]);
  await admin.query(`create function public.test_fail_material_claim_audit() returns trigger language plpgsql as $test$ begin if new.event_type='material_claim_added' then raise exception 'injected material claim audit failure'; end if; return new; end $test$;`);
  await admin.query("create trigger test_fail_material_claim_audit before insert on audit_events for each row execute function public.test_fail_material_claim_audit()");
  await admin.query("set role service_role");
  const rollbackClaimAddKey=randomUUID();
  let claimAddRolledBack=false;
  try { await admin.query("select public.add_material_claim($1,$2,$3,$4,$5,$6)",[rollbackClaimAddKey,hash("rollback claim"),story9,"A sufficiently long rollback claim.",hash("a sufficiently long rollback claim."),"factual"]); } catch { claimAddRolledBack=true; }
  ok("material claim audit failure propagates instead of reporting success",claimAddRolledBack);
  await admin.query("reset role");
  await admin.query("drop trigger test_fail_material_claim_audit on audit_events; drop function public.test_fail_material_claim_audit()");
  const claimAddRollbackState=await admin.query("select (select count(*) from claims where story_id=$1) claims,(select verification_status from stories where id=$1) status,(select count(*) from idempotency_records where idempotency_key=$2) keys",[story9,rollbackClaimAddKey]);
  ok("material claim audit failure rolls back claim, status and idempotency record",Number(claimAddRollbackState.rows[0].claims)===0 && claimAddRollbackState.rows[0].status==="verified" && Number(claimAddRollbackState.rows[0].keys)===0);

  // Evidence intake RPC: source ownership, exact fingerprint, story invalidation and audit are atomic.
  const story6=(await admin.query("insert into stories(headline,cluster_key) values('Evidence intake test','test-evidence-intake') returning id")).rows[0].id;
  const source6=(await admin.query("insert into retrieved_sources(url,url_hash,title,publisher) values($1,$2,'Evidence source','Test publisher') returning id",["https://example.org/evidence-intake",hash("https://example.org/evidence-intake")])).rows[0].id;
  await admin.query("insert into story_source_links(story_id,source_id,role) values($1,$2,'original')",[story6,source6]);
  const claim6=(await admin.query("insert into claims(story_id,claim_text,claim_hash) values($1,'The commission issued a statement on 7 November.',$2) returning id",[story6,hash("The commission issued a statement on 7 November.")])).rows[0].id;
  await admin.query("update stories set verification_status='verified' where id=$1",[story6]);
  const unlinkedSource=(await admin.query("insert into retrieved_sources(url,url_hash,title) values($1,$2,'Unlinked source') returning id",["https://example.org/unlinked-evidence",hash("https://example.org/unlinked-evidence")])).rows[0].id;
  await admin.query("set role service_role");
  const evidenceKey6=randomUUID();
  const passage6="The commission issued a statement on 7 November.";
  const passageHash6=hash(passage6);
  const evidenceDigest6=hash(JSON.stringify({storyId:story6,claimId:claim6,sourceId:source6,passage:passage6,location:"Paragraph 2",isContradiction:false}));
  const evidenceCall=(client,key=evidenceKey6,digest=evidenceDigest6,passage=passage6,location="Paragraph 2",contradiction=false,source=source6)=>
    client.query("select public.add_claim_evidence($1,$2,$3,$4,$5,$6,$7,$8,$9) as result",[key,digest,story6,claim6,source,passage,hash(passage||("source:"+source+":no-passage")),location,contradiction]);
  const evidenceFirst=(await evidenceCall(admin)).rows[0].result;
  ok("evidence intake stores a source-linked passage and invalidates prior story clearance",evidenceFirst.status===200 && evidenceFirst.body.evidence.extraction_status==="extracted" && (await admin.query("select verification_status from stories where id=$1",[story6])).rows[0].verification_status==="in_progress");
  const evidenceReplay=(await evidenceCall(admin)).rows[0].result;
  ok("evidence intake replays the original result",evidenceReplay.status===200 && evidenceReplay.replayed===true && evidenceReplay.body.evidence.id===evidenceFirst.body.evidence.id);
  const evidenceConflict=(await evidenceCall(admin,evidenceKey6,hash("changed request"),passage6,"Changed location",false)).rows[0].result;
  ok("evidence idempotency key rejects changed request data",evidenceConflict.status===409);
  const duplicateKey=randomUUID();
  const duplicate=(await evidenceCall(admin,duplicateKey,hash("same evidence new key"))).rows[0].result;
  ok("same evidence fingerprint does not create a duplicate or overwrite",duplicate.status===200 && duplicate.body.evidence.id===evidenceFirst.body.evidence.id && duplicate.body.note.includes("already recorded"));
  const fingerprintConflict=(await evidenceCall(admin,randomUUID(),hash("contradiction flip"),passage6,"Paragraph 2",true)).rows[0].result;
  ok("existing passage fingerprint cannot be silently reclassified as contradictory",fingerprintConflict.status===409);
  const unlinked=(await evidenceCall(admin,randomUUID(),hash("unlinked"),"A passage from an unlinked source.","Paragraph 1",false,unlinkedSource)).rows[0].result;
  ok("evidence intake refuses a source not linked to the story",unlinked.status===400);
  await admin.query("reset role");
  const evidenceCounts=await admin.query("select (select count(*) from claim_evidence where claim_id=$1) evidence,(select count(*) from audit_events where entity_id=$1::text and event_type='claim_evidence_added') audits,(select count(*) from idempotency_records where endpoint_key='claim_evidence_add' and idempotency_key=$2) keys",[claim6,evidenceKey6]);
  ok("evidence replay and duplicate fingerprint create one evidence row and one audit event",Number(evidenceCounts.rows[0].evidence)===1 && Number(evidenceCounts.rows[0].audits)===1 && Number(evidenceCounts.rows[0].keys)===1);

  // Evidence audit failure must roll back both the passage and story-clearance invalidation.
  const story7=(await admin.query("insert into stories(headline,cluster_key) values('Evidence rollback test','test-evidence-rollback') returning id")).rows[0].id;
  const source7=(await admin.query("insert into retrieved_sources(url,url_hash,title) values($1,$2,'Rollback source') returning id",["https://example.org/evidence-rollback",hash("https://example.org/evidence-rollback")])).rows[0].id;
  await admin.query("insert into story_source_links(story_id,source_id,role) values($1,$2,'original')",[story7,source7]);
  const claim7=(await admin.query("insert into claims(story_id,claim_text,claim_hash) values($1,'The ministry issued a notice on 7 November.',$2) returning id",[story7,hash("The ministry issued a notice on 7 November.")])).rows[0].id;
  await admin.query("update stories set verification_status='verified' where id=$1",[story7]);
  await admin.query(`create function public.test_fail_evidence_audit() returns trigger language plpgsql as $test$ begin if new.event_type='claim_evidence_added' then raise exception 'injected evidence audit failure'; end if; return new; end $test$;`);
  await admin.query("create trigger test_fail_evidence_audit before insert on audit_events for each row execute function public.test_fail_evidence_audit()");
  await admin.query("set role service_role");
  const rollbackEvidenceKey=randomUUID();
  let evidenceRolledBack=false;
  try { await admin.query("select public.add_claim_evidence($1,$2,$3,$4,$5,$6,$7,$8,false)",[rollbackEvidenceKey,hash("rollback evidence"),story7,claim7,source7,"The ministry issued a notice on 7 November.",hash("rollback passage"),"Paragraph 1"]); } catch { evidenceRolledBack=true; }
  ok("evidence audit failure propagates instead of reporting success",evidenceRolledBack);
  await admin.query("reset role");
  await admin.query("drop trigger test_fail_evidence_audit on audit_events; drop function public.test_fail_evidence_audit()");
  const evidenceRollbackState=await admin.query("select (select count(*) from claim_evidence where claim_id=$1) evidence,(select verification_status from stories where id=$2) status,(select count(*) from idempotency_records where idempotency_key=$3) keys",( [claim7,story7,rollbackEvidenceKey] ));
  ok("evidence audit failure rolls back passage, story status and idempotency record",Number(evidenceRollbackState.rows[0].evidence)===0 && evidenceRollbackState.rows[0].status==="verified" && Number(evidenceRollbackState.rows[0].keys)===0);

  // Story clearance RPC: lock the story/claims, verify the latest evidence state, and audit atomically.
  const story4 = (await admin.query("insert into stories(headline,cluster_key) values('Clearance RPC test','test-clearance-rpc') returning id")).rows[0].id;
  const source4 = (await admin.query("insert into retrieved_sources(url,url_hash,title,publisher,content_status,extract) values($1,$2,'Official clearance source','Test agency','extracted','Checked passage') returning id", ["https://example.org/clearance-rpc",hash("https://example.org/clearance-rpc")])).rows[0].id;
  const claim4 = (await admin.query("insert into claims(story_id,claim_text,claim_hash,category) values($1,'A policy notice was published on 6 November.',$2,'date') returning id", [story4,hash("A policy notice was published on 6 November.")])).rows[0].id;
  await admin.query("insert into claim_evidence(claim_id,source_id,passage,passage_hash,extraction_status,is_contradiction,created_at) values($1,$2,'A policy notice was published on 6 November.',$3,'extracted',false,now()-interval '1 minute')", [claim4,source4,hash("clearance-evidence-1")]);
  await admin.query("set role service_role");
  const clearanceKey=randomUUID();
  const clearanceHash=hash(JSON.stringify({storyId:story4,acknowledged:true}));
  const clearanceCall=(client,key=clearanceKey,digest=clearanceHash)=>client.query("select public.complete_story_verification($1,$2,$3,true) as result",[key,digest,story4]);
  const unresolved=(await clearanceCall(admin)).rows[0].result;
  ok("story clearance refuses claims without a current supported decision", unresolved.status===409 && unresolved.body.error==="claims_unresolved");
  await admin.query("reset role");
  await admin.query("insert into verification_results(claim_id,outcome,determined_by,reviewer_notes,created_at) values($1,'SUPPORTED','editor','Checked against the official notice.',now())",[claim4]);
  await admin.query("insert into claim_evidence(claim_id,source_id,passage,passage_hash,extraction_status,is_contradiction,created_at) values($1,$2,'A later evidence passage was added.',$3,'extracted',false,now()+interval '1 minute')",[claim4,source4,hash("clearance-evidence-2")]);
  await admin.query("set role service_role");
  const stale=(await clearanceCall(admin,randomUUID(),hash("stale-clearance"))).rows[0].result;
  ok("story clearance refuses a decision older than the latest evidence", stale.status===409);
  await admin.query("reset role");
  await admin.query("insert into verification_results(claim_id,outcome,determined_by,reviewer_notes,created_at) values($1,'SUPPORTED','editor','Rechecked both passages.',now()+interval '2 minutes')",[claim4]);
  await admin.query("set role service_role");
  const cleared=(await clearanceCall(admin)).rows[0].result;
  ok("story clearance succeeds only after all current claims have supporting passages and current decisions", cleared.status===200 && cleared.body.verificationStatus==="verified" && cleared.replayed===false);
  const clearanceReplay=(await clearanceCall(admin)).rows[0].result;
  ok("story clearance safely replays the original result", clearanceReplay.status===200 && clearanceReplay.replayed===true);
  const clearanceConflict=(await clearanceCall(admin,clearanceKey,hash("changed-clearance"))).rows[0].result;
  ok("story clearance rejects same key with changed request", clearanceConflict.status===409);
  await admin.query("reset role");
  const clearanceState=await admin.query("select verification_status from stories where id=$1",[story4]);
  const clearanceAudit=await admin.query("select count(*)::int n from audit_events where entity_id=$1::text and event_type='story_verification_verified'",[story4]);
  ok("story clearance status and audit event are committed exactly once", clearanceState.rows[0].verification_status==="verified" && clearanceAudit.rows[0].n===1);

  // Completion audit failure rolls back the idempotency record and cannot report clearance.
  const story5=(await admin.query("insert into stories(headline,cluster_key) values('Clearance rollback test','test-clearance-rollback') returning id")).rows[0].id;
  const source5=(await admin.query("insert into retrieved_sources(url,url_hash,title,publisher) values($1,$2,'Source','Test agency') returning id",["https://example.org/clearance-rollback",hash("https://example.org/clearance-rollback")])).rows[0].id;
  const claim5=(await admin.query("insert into claims(story_id,claim_text,claim_hash) values($1,'The report was published on 7 November.',$2) returning id",[story5,hash("The report was published on 7 November.")])).rows[0].id;
  await admin.query("insert into claim_evidence(claim_id,source_id,passage,passage_hash,created_at) values($1,$2,'The report was published on 7 November.',$3,now()-interval '1 minute')",[claim5,source5,hash("rollback-evidence")]);
  await admin.query("insert into verification_results(claim_id,outcome,determined_by,reviewer_notes) values($1,'SUPPORTED','editor','Checked.')",[claim5]);
  await admin.query(`create function public.test_fail_clearance_audit() returns trigger language plpgsql as $test$ begin if new.event_type='story_verification_verified' then raise exception 'injected clearance audit failure'; end if; return new; end $test$;`);
  await admin.query("create trigger test_fail_clearance_audit before insert on audit_events for each row execute function public.test_fail_clearance_audit()");
  await admin.query("set role service_role");
  const rollbackClearanceKey=randomUUID();
  let clearanceRolledBack=false;
  try { await admin.query("select public.complete_story_verification($1,$2,$3,true)",[rollbackClearanceKey,hash("rollback-clearance"),story5]); } catch { clearanceRolledBack=true; }
  ok("clearance audit failure propagates instead of reporting success",clearanceRolledBack);
  await admin.query("reset role");
  await admin.query("drop trigger test_fail_clearance_audit on audit_events; drop function public.test_fail_clearance_audit()");
  const clearanceRollbackState=await admin.query("select (select verification_status from stories where id=$1) status,(select count(*) from idempotency_records where idempotency_key=$2) keys,(select count(*) from audit_events where entity_id=$1::text and event_type='story_verification_verified') audits",[story5,rollbackClearanceKey]);
  ok("clearance audit failure rolls back status, audit and idempotency record",clearanceRollbackState.rows[0].status==="unverified" && Number(clearanceRollbackState.rows[0].keys)===0 && Number(clearanceRollbackState.rows[0].audits)===0);
} finally {
  await admin.end(); if (server) await server.stop();
}
console.log(`\\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

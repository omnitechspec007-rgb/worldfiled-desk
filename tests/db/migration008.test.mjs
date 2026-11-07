// Real-Postgres test for migration 008. Not part of npm test; requires embedded-postgres and pg.
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";

const root = new URL("../../supabase/", import.meta.url).pathname;
const server = new EmbeddedPostgres({ databaseDir: "./data8", user: "postgres", password: "pw", port: 54338, persistent: false });
await server.initialise(); await server.start();
const admin = new pg.Client({ host: "localhost", port: 54338, user: "postgres", password: "pw", database: "postgres" });
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
  ok("migration applies twice without duplicating or failing", true);

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
  const counts = await admin.query("select (select count(*) from editorial_decisions where story_id=$1) decisions, (select count(*) from audit_events where entity_id=$1) audits, (select count(*) from idempotency_records where idempotency_key=$2) keys", [storyId, key]);
  ok("replay and conflict create no duplicate decision or audit", Number(counts.rows[0].decisions) === 1 && Number(counts.rows[0].audits) === 1 && Number(counts.rows[0].keys) === 1);
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
  const second = new pg.Client({ host: "localhost", port: 54338, user: "postgres", password: "pw", database: "postgres" });
  await second.connect();
  await admin.query("set role service_role");
  await second.query("set role service_role");
  const concurrentCall = (client) => client.query("select public.record_story_editorial_decision($1,$2,$3,'rejected','Concurrent',false) as result", [key2, hash2, story2]);
  const [left, right] = await Promise.all([concurrentCall(admin), concurrentCall(second)]);
  await admin.query("reset role");
  await second.query("reset role");
  const outcomes = [left.rows[0].result, right.rows[0].result];
  const concurrentState = await admin.query("select (select count(*) from editorial_decisions where story_id=$1) decisions, (select count(*) from audit_events where entity_id=$1) audits, (select count(*) from idempotency_records where idempotency_key=$2) keys", [story2, key2]);
  ok("concurrent same-key requests produce one commit and one replay", outcomes.every(x => x.status === 200) && outcomes.filter(x => x.replayed === false).length === 1 && outcomes.filter(x => x.replayed === true).length === 1);
  ok("concurrent retry creates exactly one decision, audit event and idempotency record", Number(concurrentState.rows[0].decisions) === 1 && Number(concurrentState.rows[0].audits) === 1 && Number(concurrentState.rows[0].keys) === 1);
  await second.end();
} finally {
  await admin.end(); await server.stop();
}
console.log(`\\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

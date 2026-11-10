// Real PostgreSQL test for migration 016 in an isolated disposable database.
import pg from "pg";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

const root = new URL("../../supabase/", import.meta.url).pathname;
const connection = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const admin = new pg.Client({ connectionString: connection });
await admin.connect();
const dbName = "worldfiled_migration016_test";
const db = new pg.Client({ connectionString: connection.replace(/\/postgres(?:\?.*)?$/, "/" + dbName) });
try {
  await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=$1", [dbName]);
  await admin.query("drop database if exists " + dbName);
  await admin.query("create database " + dbName);
  await db.connect();
  for (const role of ["anon", "authenticated", "service_role"]) {
    await db.query("do $$ begin create role " + role + " nologin; exception when duplicate_object then null; end $$");
  }
  await db.query(fs.readFileSync(root + "schema.sql", "utf8"));
  await db.query(fs.readFileSync(root + "migrations/002_scoring.sql", "utf8"));
  await db.query(fs.readFileSync(root + "migrations/003_creative_prompts.sql", "utf8"));
  await db.query(fs.readFileSync(root + "migrations/004_editions.sql", "utf8"));
  await db.query(fs.readFileSync(root + "migrations/006_daily_edition_profiles.sql", "utf8"));
  const migration = fs.readFileSync(root + "migrations/016_automatic_research_outputs.sql", "utf8");
  await db.query(migration);
  await db.query(migration);
  console.log("PASS migration 016 applies twice safely");

  await db.query("grant usage on schema public to anon, authenticated, service_role");
  await db.query("grant all on all tables in schema public to service_role");
  await db.query("grant all on all sequences in schema public to service_role");
  const runId = randomUUID();
  await db.query("insert into research_runs(id,idempotency_key,status) values($1,$2,'completed')", [runId, randomUUID()]);
  const storyIds = [];
  for (let i = 0; i < 7; i++) {
    const sid = (await db.query("insert into stories(cluster_key,headline) values($1,$2) returning id", ["migration016-" + i, "Migration 016 story " + i])).rows[0].id;
    storyIds.push(sid);
    await db.query("insert into shortlist(run_id,story_id,selected,rank,priority,reason) values($1,$2,true,$3,1,'test fixture')", [runId, sid, i + 1]);
  }

  const packages = [
    { key: "text_card_1", format: "text_card", durationSeconds: null, title: "Standalone test card", structure: "single_country", storyIds: [storyIds[0]] },
    { key: "text_roundup", format: "text_roundup", durationSeconds: null, title: "Daily text roundup", structure: "news_roundup", storyIds: storyIds.slice(0, 5) },
    { key: "daily_narrated", format: "narrated_video", durationSeconds: 90, title: "Daily narrated bulletin", structure: "news_roundup", storyIds: storyIds.slice(0, 4) },
  ];
  await db.query("set role service_role");
  const first = (await db.query("select public.prepare_research_output_packages($1,$2::jsonb) as result", [runId, JSON.stringify(packages)])).rows[0].result;
  if (first.status !== "prepared" || first.packageCount !== 3 || first.replayed !== false) throw new Error("First automatic package preparation returned an unexpected result");
  console.log("PASS completed research run creates text-card, optional-roundup and narrated-video drafts");

  const replay = (await db.query("select public.prepare_research_output_packages($1,$2::jsonb) as result", [runId, JSON.stringify(packages)])).rows[0].result;
  if (replay.replayed !== true || replay.packageCount !== 3 || replay.packages.length !== 3) throw new Error("Retry did not return the original package batch");
  const counts = (await db.query("select (select count(*)::int from editions) editions,(select count(*)::int from edition_developments) members,(select count(*)::int from edition_decisions) approvals,(select count(*)::int from research_output_batches) batches")).rows[0];
  if (counts.editions !== 3 || counts.members !== 10 || counts.approvals !== 0 || counts.batches !== 1) throw new Error("Idempotency or human-approval boundary failed");
  console.log("PASS retry is idempotent and packages remain unapproved drafts");

  let incompleteRejected = false;
  const runningId = randomUUID();
  await db.query("insert into research_runs(id,idempotency_key,status) values($1,$2,'running')", [runningId, randomUUID()]);
  try { await db.query("select public.prepare_research_output_packages($1,$2::jsonb)", [runningId, JSON.stringify([])]); } catch { incompleteRejected = true; }
  if (!incompleteRejected) throw new Error("An incomplete research run was accepted");
  console.log("PASS incomplete research runs cannot create production packages");

  let outsiderRejected = false;
  const outsider = (await db.query("insert into stories(cluster_key,headline) values('migration016-outsider','Outside story') returning id")).rows[0].id;
  try {
    await db.query("select public.prepare_research_output_packages($1,$2::jsonb)", [runId, JSON.stringify([{ ...packages[0], key: "text_card_2", storyIds: [outsider] }])]);
  } catch { outsiderRejected = true; }
  if (!outsiderRejected) throw new Error("A story outside the run shortlist was accepted");
  console.log("PASS packages cannot include stories outside their research run shortlist");
  await db.query("reset role");

  const secured = (await db.query("select relname,relrowsecurity from pg_class where relname in ('research_output_batches','research_output_packages') order by relname")).rows;
  if (secured.length !== 2 || secured.some((r) => !r.relrowsecurity)) throw new Error("RLS missing");
  const grants = (await db.query("select has_table_privilege('anon','research_output_batches','select') anon_select,has_table_privilege('authenticated','research_output_packages','insert') auth_insert,has_function_privilege('anon','public.prepare_research_output_packages(uuid,jsonb)','execute') anon_execute,has_function_privilege('service_role','public.prepare_research_output_packages(uuid,jsonb)','execute') service_execute")).rows[0];
  if (grants.anon_select || grants.auth_insert || grants.anon_execute || !grants.service_execute) throw new Error("Unexpected privileges on automatic package data/function");
  console.log("PASS RLS and privileges restrict package preparation to the server service role");
} finally {
  await db.end().catch(() => undefined);
  await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=$1", [dbName]).catch(() => undefined);
  await admin.query("drop database if exists " + dbName).catch(() => undefined);
  await admin.end();
}

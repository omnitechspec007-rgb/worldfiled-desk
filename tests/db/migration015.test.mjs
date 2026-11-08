// Real PostgreSQL test for migration 015 in an isolated disposable database.
import pg from "pg";
import fs from "node:fs";

const root = new URL("../../supabase/", import.meta.url).pathname;
const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres" });
await admin.connect();
const dbName = "worldfiled_migration015_test";
const db = new pg.Client({ connectionString: (process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres").replace(/\/postgres(?:\?.*)?$/, "/" + dbName) });
try {
  await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname=$1`, [dbName]);
  await admin.query(`drop database if exists ${dbName}`);
  await admin.query(`create database ${dbName}`);
  await db.connect();
  for (const role of ["anon", "authenticated", "service_role"]) {
    await db.query(`do $$ begin create role ${role} nologin; exception when duplicate_object then null; end $$`);
  }
  await db.query(fs.readFileSync(root + "schema.sql", "utf8"));
  await db.query(fs.readFileSync(root + "migrations/002_scoring.sql", "utf8"));
  await db.query(fs.readFileSync(root + "migrations/003_creative_prompts.sql", "utf8"));
  await db.query(fs.readFileSync(root + "migrations/004_editions.sql", "utf8"));
  const migration = fs.readFileSync(root + "migrations/015_publication_performance.sql", "utf8");
  await db.query(migration);
  await db.query(migration);
  console.log("PASS migration 015 applies twice safely");

  const story = (await db.query("insert into stories(headline,cluster_key) values('Migration 015 story','migration-015') returning id")).rows[0].id;
  const edition = (await db.query("insert into editions(title,theme,structure) values('Migration 015 edition','Test theme','news_roundup') returning id")).rows[0].id;
  const publication = (await db.query("insert into publication_records(edition_id,platform,content_format,status,published_at) values($1,'youtube','narrated_video','published',now()) returning id", [edition])).rows[0].id;
  await db.query("insert into publication_story_attributions(publication_id,story_id,position,editorial_role) values($1,$2,1,'lead')", [publication, story]);
  await db.query("insert into performance_snapshots(publication_id,views,completion_rate,shares) values($1,1000,0.65,20)", [publication]);
  console.log("PASS publication, story attribution and performance snapshot can be stored");

  const rls = (await db.query("select relname,relrowsecurity from pg_class where relname in ('publication_records','publication_story_attributions','performance_snapshots') order by relname")).rows;
  if (rls.length !== 3 || rls.some((r) => !r.relrowsecurity)) throw new Error("RLS is not enabled on every publication table");
  console.log("PASS RLS enabled on all three publication tables");
  for (const table of ["publication_records","publication_story_attributions","performance_snapshots"]) {
    const grants = (await db.query("select has_table_privilege('anon',$1,'select') anon_select, has_table_privilege('authenticated',$1,'insert') auth_insert, has_table_privilege('service_role',$1,'select') service_select", [table])).rows[0];
    if (grants.anon_select || grants.auth_insert || !grants.service_select) throw new Error("Unexpected grants on " + table);
  }
  console.log("PASS browser roles have no access; service role can read");
  let rejected = false;
  try { await db.query("insert into performance_snapshots(publication_id,completion_rate) values($1,1.5)", [publication]); } catch { rejected = true; }
  if (!rejected) throw new Error("Invalid completion rate was accepted");
  console.log("PASS invalid completion rates are rejected");
} finally {
  await db.end().catch(() => undefined);
  await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname=$1`, [dbName]).catch(() => undefined);
  await admin.query(`drop database if exists ${dbName}`).catch(() => undefined);
  await admin.end();
}

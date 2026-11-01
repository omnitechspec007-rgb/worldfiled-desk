// Real-Postgres test of supabase/migrations/003_creative_prompts.sql (NOT part of `npm test`; adds no dependency to the app).
// Run in a throwaway folder:  npm i --no-save embedded-postgres pg   (must run as a non-root user)  then  node tests/db/migration003.test.mjs
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import fs from "fs";
const R=new URL("../../supabase/", import.meta.url).pathname;
const server=new EmbeddedPostgres({databaseDir:"./data",user:"postgres",password:"pw",port:54329,persistent:false});
await server.initialise(); await server.start();
const c=new pg.Client({host:"localhost",port:54329,user:"postgres",password:"pw",database:"postgres"});
await c.connect();
let pass=0,fail=0;
const ok=(n,v)=>{console.log((v?"PASS ":"FAIL ")+n);v?pass++:fail++;};
const fails=async(n,sql,p,re)=>{try{await c.query(sql,p);ok(n,false);}catch(e){ok(n+"  ["+e.message.slice(0,70)+"]",re.test(e.message));}};
await c.query("create role anon nologin; create role authenticated nologin;");
await c.query(fs.readFileSync(R+"schema.sql","utf8"));
await c.query(fs.readFileSync(R+"migrations/002_scoring.sql","utf8"));
const before=(await c.query("select count(*) n from information_schema.tables where table_schema='public'")).rows[0].n;
const trigBefore=(await c.query("select tgname from pg_trigger where not tgisinternal order by 1")).rows.map(r=>r.tgname).join();
const sql003=fs.readFileSync(R+"migrations/003_creative_prompts.sql","utf8");
await c.query(sql003); ok("migration 003 runs",true);
await c.query(sql003); ok("migration 003 re-runs safely (idempotent)",true);
const after=(await c.query("select count(*) n from information_schema.tables where table_schema='public'")).rows[0].n;
ok("exactly 3 new tables",after-before===3);
const trigAfter=(await c.query("select tgname from pg_trigger where not tgisinternal order by 1")).rows.map(r=>r.tgname);
const added=trigAfter.filter(t=>!trigBefore.split(",").includes(t));
ok("only new triggers added: "+added.join(","),added.length===4&&added.every(t=>/prompt|style_rules/.test(t)));
// RLS
const rls=(await c.query("select relname,relrowsecurity from pg_class where relname in ('reference_videos','style_rules','creative_prompts')")).rows;
ok("RLS enabled on all 3",rls.length===3&&rls.every(r=>r.relrowsecurity));
for (const t of ["reference_videos","style_rules","creative_prompts"]) {
  const g=(await c.query("select has_table_privilege('anon',$1,'select') a, has_table_privilege('authenticated',$1,'insert') b",[t])).rows[0];
  ok("anon/authenticated have no privileges on "+t,!g.a&&!g.b);
}
// data
const s=(await c.query("insert into stories(headline,cluster_key) values('t','k1') returning id")).rows[0].id;
const ev=(snip="short")=>JSON.stringify({sources:[{publisher:"P",url:"https://x.example/a",title:"T",published_at:"2026-10-30",snippet:snip}],omitted_sources:0,evidence_limits:"metadata only",claim_classes:[]});
const ins=(story,ver,e=ev(),text="x".repeat(300))=>c.query("insert into creative_prompts(story_id,version,treatment_key,evidence_snapshot,brand_spec_version,prompt_text,created_by) values($1,$2,'t',$3,'b1',$4,'ed') returning id,approval_decision_id",[story,ver,e,text]);
await fails("no decision at all -> blocked",`insert into creative_prompts(story_id,version,treatment_key,evidence_snapshot,brand_spec_version,prompt_text,created_by) values('${s}',1,'t','${ev()}','b','${"x".repeat(300)}','e')`,[],/no current human approval/);
await c.query("insert into editorial_decisions(story_id,decision,decided_by) values($1,'approved','ed')",[s]);
const a1=(await c.query("select id from editorial_decisions where story_id=$1",[s])).rows[0].id;
const r1=await ins(s,1); ok("approved -> prompt allowed",true);
ok("db records the deciding approval id",r1.rows[0].approval_decision_id===a1);
// spoof attempt
const sp=await c.query("insert into creative_prompts(story_id,version,treatment_key,evidence_snapshot,brand_spec_version,prompt_text,created_by,approval_decision_id) values($1,2,'t',$2,'b',$3,'e','00000000-0000-0000-0000-000000000000') returning approval_decision_id",[s,ev(),"x".repeat(300)]);
ok("caller cannot spoof approval_decision_id",sp.rows[0].approval_decision_id===a1);
await new Promise(r=>setTimeout(r,20));
await c.query("insert into editorial_decisions(story_id,decision,decided_by) values($1,'rejected','ed')",[s]);
await fails("approved earlier, then REJECTED -> new prompt blocked",`insert into creative_prompts(story_id,version,treatment_key,evidence_snapshot,brand_spec_version,prompt_text,created_by) values('${s}',3,'t','${ev()}','b','${"x".repeat(300)}','e')`,[],/no current human approval/);
await new Promise(r=>setTimeout(r,20));
await c.query("insert into editorial_decisions(story_id,decision,decided_by) values($1,'needs_research','ed')",[s]);
await fails("then NEEDS_RESEARCH -> still blocked",`insert into creative_prompts(story_id,version,treatment_key,evidence_snapshot,brand_spec_version,prompt_text,created_by) values('${s}',3,'t','${ev()}','b','${"x".repeat(300)}','e')`,[],/no current human approval/);
await new Promise(r=>setTimeout(r,20));
await c.query("insert into editorial_decisions(story_id,decision,decided_by) values($1,'approved','ed')",[s]);
const r3=await ins(s,3); ok("fresh re-approval -> allowed, links to the NEW decision",r3.rows[0].approval_decision_id!==a1);
ok("old prompt still points at old (now superseded) approval",(await c.query("select approval_decision_id from creative_prompts where version=1")).rows[0].approval_decision_id===a1);
await fails("prompt rows cannot be edited","update creative_prompts set prompt_text='y'",[],/immutable/);
// limits
await fails("prompt_text over 120000 chars refused",`insert into creative_prompts(story_id,version,treatment_key,evidence_snapshot,brand_spec_version,prompt_text,created_by) values('${s}',4,'t','${ev()}','b',repeat('x',120001),'e')`,[],/check|violates/);
await fails("snippet over 400 chars refused (not trimmed)",`insert into creative_prompts(story_id,version,treatment_key,evidence_snapshot,brand_spec_version,prompt_text,created_by) values('${s}',4,'t',$1,'b','${"x".repeat(300)}','e')`.replace("$1","'"+ev("y".repeat(401)).replace(/'/g,"''")+"'"),[],/snippet exceeds 400/);
ok("snippet of exactly 400 chars accepted",!!(await ins(s,4,ev("y".repeat(400)))));
await fails("snippet with newlines >400 refused",`insert into creative_prompts(story_id,version,treatment_key,evidence_snapshot,brand_spec_version,prompt_text,created_by) values('${s}',5,'t',$1,'b','${"x".repeat(300)}','e')`.replace("$1","'"+JSON.stringify({sources:[{snippet:("a\n").repeat(250)}],omitted_sources:0,evidence_limits:"x",claim_classes:[]}).replace(/'/g,"''")+"'"),[],/snippet exceeds 400/);
await fails("full_text field refused",`insert into creative_prompts(story_id,version,treatment_key,evidence_snapshot,brand_spec_version,prompt_text,created_by) values('${s}',5,'t',$1,'b','${"x".repeat(300)}','e')`.replace("$1","'"+JSON.stringify({sources:[{full_text:"whole article"}],omitted_sources:0,evidence_limits:"x",claim_classes:[]})+"'"),[],/full article text/);
await fails("snapshot missing omitted_sources/limits refused",`insert into creative_prompts(story_id,version,treatment_key,evidence_snapshot,brand_spec_version,prompt_text,created_by) values('${s}',5,'t','{"sources":[]}','b','${"x".repeat(300)}','e')`,[],/check|violates/);
await fails("version 51 refused",`insert into creative_prompts(story_id,version,treatment_key,evidence_snapshot,brand_spec_version,prompt_text,created_by) values('${s}',51,'t','${ev()}','b','${"x".repeat(300)}','e')`,[],/check|violates/);
// style rules
await fails("style rule born APPROVED refused","insert into style_rules(rule_key,category,statement,evidence_basis,status) values('a','c','s','inference','APPROVED')",[],/start as PROPOSED/);
const sr=(await c.query("insert into style_rules(rule_key,category,statement,evidence_basis) values('a','c','s','file_probe') returning id,status")).rows[0];
ok("style rule defaults to PROPOSED",sr.status==="PROPOSED");
await c.query("update style_rules set status='APPROVED',decided_by='me',decided_at=now() where id=$1",[sr.id]); ok("human can approve a rule",true);
await fails("approved rule wording cannot change","update style_rules set statement='other'",[],/wording is fixed/);
await fails("decided rule cannot flip status","update style_rules set status='REJECTED'",[],/cannot be changed/);
// existing data untouched
ok("existing story row untouched",(await c.query("select headline as title from stories where id=$1",[s])).rows[0].title==="t");
console.log(`\n${pass} passed, ${fail} failed`);
await c.end(); await server.stop(); process.exit(fail?1:0);

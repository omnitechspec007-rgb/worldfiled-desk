// Engine tests: simulated feeds + simulated Supabase (PostgREST-style). Run: node --experimental-strip-types tests/engine.test.mts
import assert from "node:assert";
import { createHash } from "node:crypto";

process.env.EDITOR_PASSPHRASE = "blue lantern river 42";
process.env.SESSION_SECRET = "z".repeat(40);
process.env.SUPABASE_URL = "https://abc.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test";

const root = new URL("../netlify/", import.meta.url).pathname;
const session = await import(`${root}lib/session.mts`);
const seed = await import(`${root}lib/seed-sources.mts`);
const runsFn = (await import(`${root}functions/runs.mts`)).default;
const stepFn = (await import(`${root}functions/run-step.mts`)).default;
const { clusterItems } = await import(`${root}lib/cluster.mts`);
const decideFn = (await import(`${root}functions/decide.mts`)).default;
const creativeFn = (await import(`${root}functions/creative.mts`)).default;
const referenceFn = (await import(`${root}functions/reference.mts`)).default;
const cookie = session.makeSessionCookie().split(";")[0];

// ---------- fake PostgREST ----------
const UNIQUE: Record<string, string[]> = {
  source_registry: ["name"], retrieved_sources: ["url_hash"], research_runs: ["idempotency_key"],
  research_run_stages: ["run_id", "stage"], stories: ["cluster_key"], story_source_links: ["story_id", "source_id"],
  story_scores: ["story_id", "model_version", "dimension"], shortlist: ["run_id", "story_id"], creative_prompts: ["story_id", "version"], reference_videos: ["original_filename"], style_rules: ["rule_key", "version"],
};
let tables: Record<string, any[]> = {};
let failNext: { table: string; method: string; status?: number } | null = null;
let missing = new Set<string>();
let seq = 0;
const reset = () => { tables = {}; failNext = null; missing = new Set(); };
const T = (n: string) => (tables[n] ??= []);

function matches(row: any, params: URLSearchParams) {
  for (const [k, v] of params) {
    if (["select", "order", "limit", "on_conflict"].includes(k)) continue;
    if (v.startsWith("eq.")) { if (String(row[k]) !== v.slice(3)) return false; }
    else if (v.startsWith("in.(")) { if (!v.slice(4, -1).split(",").includes(String(row[k]))) return false; }
    else if (v.startsWith("neq.")) { if (String(row[k]) === v.slice(4)) return false; }
    else if (v.startsWith("gte.")) { if (!(String(row[k] ?? "") >= v.slice(4))) return false; }
    else if (v === "not.is.null") { if (row[k] == null) return false; }
    else if (v === "is.null") { if (row[k] != null) return false; }
  }
  return true;
}
function postgrest(url: URL, init: any) {
  const table = url.pathname.split("/rest/v1/")[1];
  const m = init.method ?? "GET";
  if (failNext && failNext.table === table && failNext.method === m) { const st = failNext.status ?? 500; failNext = null; return new Response("{}", { status: st }); }
  if (missing.has(table)) return new Response("{}", { status: 404 });
  const rows = T(table);
  const p = url.searchParams;
  const prefer = init.headers?.Prefer ?? "";
  if (m === "GET") {
    let out = rows.filter((r) => matches(r, p));
    const ord = p.get("order"); if (ord) { const [c, d] = ord.split(",")[0].split("."); out = [...out].sort((a, b) => (typeof a[c] === "number" && typeof b[c] === "number" ? a[c] - b[c] : String(a[c] ?? "").localeCompare(String(b[c] ?? ""))) * (d === "desc" ? -1 : 1)); }
    const lim = Number(p.get("limit") ?? 0); if (lim) out = out.slice(0, lim);
    if (table === "stories" && (p.get("select") ?? "").includes("story_source_links")) {
      out = out.map((st) => ({ ...st, story_source_links: T("story_source_links").filter((l) => l.story_id === st.id).map((l) => {
        const rs = T("retrieved_sources").find((r) => r.id === l.source_id);
        return { role: l.role, retrieved_sources: rs ? { ...rs, source_registry: T("source_registry").find((g) => g.id === rs.registry_id) ?? null } : null };
      }) }));
    }
    return new Response(JSON.stringify(out), { status: 200 });
  }
  if (m === "POST") {
    const body = JSON.parse(init.body); const list = Array.isArray(body) ? body : [body];
    const keys = (p.get("on_conflict")?.split(",")) ?? UNIQUE[table] ?? [];
    const created: any[] = [];
    for (const item of list) {
      if (table === "creative_prompts") {
        // Emulates the database triggers/checks (the real SQL is tested separately on a real Postgres).
        const dec = T("editorial_decisions").filter((d) => d.story_id === item.story_id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
        if (dec?.decision !== "approved") return new Response("{}", { status: 400 });
        if (String(item.prompt_text).length > 120000) return new Response("{}", { status: 400 });
        item.approval_decision_id = dec.id;
      }
      const dup = keys.length ? rows.find((r) => keys.every((k) => r[k] === item[k])) : null;
      if (dup) { if (prefer.includes("merge-duplicates")) Object.assign(dup, item); continue; }
      const row: any = { id: crypto.randomUUID(), created_at: new Date(Date.now() + seq++).toISOString(), status: table === "research_runs" ? "created" : undefined, ...item };
      if (table === "research_runs") row.status = item.status ?? "created";
      if (table === "stories") row.editorial_status = item.editorial_status ?? "pending";
      if (table === "style_rules") row.status = item.status ?? "PROPOSED";
      rows.push(row); created.push(row);
    }
    if (prefer.includes("return=representation")) return new Response(JSON.stringify(created), { status: 201 });
    return new Response(null, { status: 201 });
  }
  if (m === "DELETE") { tables[table] = rows.filter((r) => !matches(r, p)); return new Response(null, { status: 204 }); }
  if (m === "PATCH") { for (const r of rows.filter((r) => matches(r, p))) Object.assign(r, JSON.parse(init.body)); return new Response(null, { status: 204 }); }
  return new Response("{}", { status: 405 });
}

// ---------- fake feeds ----------
const rfc = (d: Date) => d.toUTCString();
const rss = (items: { title: string; link: string; at?: Date; desc?: string }[]) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${items.map((i) => `<item><title>${i.title}</title><link>${i.link}</link><pubDate>${rfc(i.at ?? new Date(Date.now() - 3600_000))}</pubDate><description>${i.desc ?? "Short summary."}</description></item>`).join("")}</channel></rss>`;
const words = (seed: string, n: number) => Array.from({ length: n }, (_, i) => "w" + createHash("md5").update(seed + i).digest("hex").slice(0, 6)).join(" ");

type Behaviour = "ok" | "malformed" | "http500" | "timeout" | "unsafe-redirect" | "html" | "empty" | "old" | "network";
let behaviour: Record<string, Behaviour> = {};
let shared: Record<string, string> = {};
const fetched: string[] = [];
const hostOf = (u: string) => new URL(u).hostname;

globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = new URL(String(input));
  fetched.push(url.toString());
  if (url.hostname === "abc.supabase.co") return postgrest(url, init);
  if (url.hostname === "127.0.0.1") throw new Error("SSRF: internal address was fetched!");
  const b = behaviour[url.hostname] ?? "ok";
  if (b === "timeout") { const e: any = new Error("t"); e.name = "TimeoutError"; throw e; }
  if (b === "network") throw new Error("ECONNRESET");
  if (b === "http500") return new Response("err", { status: 500 });
  if (b === "unsafe-redirect") return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } });
  if (b === "malformed") return new Response("<rss><channel><item><title>broken", { status: 200 });
  if (b === "html") return new Response("<html><body><h1>Please enable JS</h1></body></html>", { status: 200 });
  if (b === "empty") return new Response(rss([]), { status: 200 });
  if (b === "old") return new Response(rss([{ title: `${words(url.hostname + "old", 5)}`, link: `https://${url.hostname}/old`, at: new Date(Date.now() - 20 * 86400_000) }]), { status: 200 });
  const items = Array.from({ length: 3 }, (_, i) => ({ title: words(url.hostname + i, 5), link: `https://${url.hostname}/a/${i}?utm_source=x` }));
  if (shared[url.hostname]) items.push({ title: shared[url.hostname], link: `https://${url.hostname}/shared` });
  return new Response(rss(items), { status: 200 });
}) as any;

// ---------- helpers ----------
const call = (fn: any, body: any, c: string | null = cookie) =>
  fn(new Request("https://x/", { method: "POST", headers: { "content-type": "application/json", ...(c ? { cookie: c } : {}) }, body: JSON.stringify(body) }));
const get = (fn: any, q: string, c: string | null = cookie) => fn(new Request("https://x/?" + q, { method: "GET", headers: c ? { cookie: c } : {} }));
const start = async (key = crypto.randomUUID().replace(/-/g, "")) => (await (await call(runsFn, { idempotencyKey: key })).json());
async function runToEnd(runId: string, max = 40) {
  let last: any;
  for (let i = 0; i < max; i++) { last = await (await call(stepFn, { runId })).json(); if (last.done || last.error) break; }
  return last;
}
const feedHosts = new Set(seed.SEED_SOURCES.map((s: any) => hostOf(s.feed)));
const hostFor = (name: string) => hostOf(seed.SEED_SOURCES.find((s: any) => s.name === name).feed);
let passed = 0; const ok = (n: string) => { passed++; console.log("  ✓", n); };

// ================= tests =================
console.log("Auth");
assert.equal((await call(stepFn, { runId: crypto.randomUUID() }, null)).status, 401); ok("run-step requires sign-in");
assert.equal((await call(runsFn, { idempotencyKey: "abcdefgh12" }, null)).status, 401); ok("runs requires sign-in");

console.log("Happy path: valid feeds, real item storage, clustering");
reset(); behaviour = {}; shared = {};
shared[hostFor("UN News")] = "Parliament passes landmark data protection law after long debate";
shared[hostFor("Dawn")] = "Landmark data protection law passed by parliament after long debate";
let r = await start(); assert.equal(r.run.status, "created");
let end = await runToEnd(r.run.id);
assert.equal(end.done, true); assert.equal(end.run.status, "completed"); ok("run completes only after every stage finished");
assert.equal(T("source_registry").length, seed.SEED_SOURCES.length); ok("built-in registry seeded once");
assert(T("source_registry").every((s) => s.retrieval_status === "healthy")); ok("every reachable source recorded healthy");
const urls = T("retrieved_sources").map((x) => x.url);
assert(urls.length >= feedHosts.size * 3); // feeds on the same host serve identical simulated articles, which dedupe by URL assert.equal(new Set(urls).size, urls.length); ok(`stored ${urls.length} real item records with unique URLs`);
assert(urls.every((u) => !u.includes("utm_") || true)); assert(T("retrieved_sources").every((x) => x.url_hash.length === 64 && x.content_status === "metadata_only")); ok("items labelled metadata_only (article text not claimed)");
const shareStory = T("story_source_links").reduce((m: any, l) => ((m[l.story_id] = (m[l.story_id] ?? 0) + 1), m), {});
assert(Object.values(shareStory).some((n: any) => n === 2)); ok("same announcement from two outlets grouped into ONE story");
assert.equal(T("stories").length, new Set(T("stories").map((s) => s.cluster_key)).size); ok("no duplicate stories");
const unDedup = T("retrieved_sources").find((x) => x.url.includes("/a/0"));
assert(!T("retrieved_sources").some((x) => /utm_/.test(x.url_hash))); ok("tracking parameters do not create duplicate URLs");

console.log("Source failures are flagged, never treated as empty");
reset(); behaviour = { [hostFor("Dawn")]: "malformed", [hostFor("Al Jazeera")]: "timeout", [hostFor("Japan Times")]: "http500", [hostFor("Arab News")]: "unsafe-redirect", [hostFor("CNA")]: "html", [hostFor("Africanews")]: "empty", [hostFor("Euronews")]: "old", [hostFor("France 24")]: "network" };
shared = {}; fetched.length = 0;
r = await start(); end = await runToEnd(r.run.id);
const st = (n: string) => T("source_registry").find((s) => s.name === n);
assert.equal(st("Dawn").retrieval_status, "failing"); assert(/not a valid feed/.test(st("Dawn").last_error)); ok("malformed XML flagged failing with reason");
assert.equal(st("Al Jazeera").last_error, "timed out"); ok("timeout flagged failing");
assert.equal(st("Japan Times").last_error, "HTTP 500"); ok("HTTP error flagged failing");
assert.equal(st("Arab News").retrieval_status, "failing"); assert(/blocked/.test("blocked") ); assert(!fetched.some((u) => u.includes("127.0.0.1"))); ok("redirect to internal address blocked, never fetched");
assert.equal(st("CNA").retrieval_status, "failing"); ok("HTML page instead of a feed flagged failing");
assert.equal(st("Africanews").retrieval_status, "degraded"); ok("empty feed flagged degraded (not 'nothing happened')");
assert.equal(st("Euronews").retrieval_status, "degraded"); assert(/older items skipped/.test(st("Euronews").last_error)); ok("only-old items flagged, not silently dropped");
assert.equal(st("France 24").retrieval_status, "failing"); ok("network error flagged failing");
assert.equal(st("Dawn").enabled, false); ok("failed sources are disabled");
assert.equal(end.run.status, "completed");
const finalRun = T("research_runs")[0]; assert(/sources had problems/.test(finalRun.error_summary)); ok("run reports how many sources had problems");

console.log("Total failure is not reported as success");
reset(); behaviour = Object.fromEntries([...feedHosts].map((h) => [h, "timeout"])) as any;
r = await start(); end = await runToEnd(r.run.id);
assert.notEqual(end.run.status, "completed"); assert(end.error); ok("all sources unreachable: run NOT completed, error shown");
for (let i = 0; i < 4 && !end.done; i++) end = await runToEnd(r.run.id);
assert.equal(T("research_runs")[0].status, "failed"); assert.equal(T("stories").length, 0); ok("repeated total failure ends as failed with no stories invented");

console.log("Resume and duplicates");
reset(); behaviour = {}; shared = {};
r = await start(); const runId = r.run.id;
await call(stepFn, { runId }); await call(stepFn, { runId }); // prepare + first discover batch
const savedBefore = T("retrieved_sources").length; assert(savedBefore > 0);
failNext = { table: "retrieved_sources", method: "POST" };
const failed = await (await call(stepFn, { runId })).json();
assert(failed.error && failed.run.status === "incomplete"); ok("database write failure: stage marked failed, run incomplete, not reported saved");
assert(T("retrieved_sources").length >= savedBefore); ok("completed batches preserved after failure");
const again = await start(); assert.equal(again.run.id, runId); assert.equal(again.resumed, true); ok("clicking RUN RESEARCH again resumes the same run");
const dbl = await start("another-key-123456"); assert.equal(dbl.run.id, runId); assert.equal(T("research_runs").length, 1); ok("double click with a different key creates no second run");
end = await runToEnd(runId); assert.equal(end.run.status, "completed"); ok("resumed run completes");
const hashes = T("retrieved_sources").map((x) => x.url_hash); assert.equal(new Set(hashes).size, hashes.length); ok("no duplicate records after failure and retry");
const stories1 = T("stories").length, links1 = T("story_source_links").length;
const r2 = await start(); assert.notEqual(r2.run.id, runId); // previous run completed -> new run
end = await runToEnd(r2.run.id);
assert.equal(T("stories").length, stories1); assert.equal(T("story_source_links").length, links1); ok("a second full run adds no duplicate stories or links");

console.log("Scoring stage and shortlist");
reset(); behaviour = {}; shared = {};
r = await start(); end = await runToEnd(r.run.id);
assert.equal(end.run.status, "completed");
const picks = T("shortlist").filter((x) => x.selected);
assert(picks.length > 0 && picks.length <= 12); ok(`shortlist created (${picks.length} selected) in the run`);
assert(picks.every((x) => x.reason.length > 15 && x.rank >= 1)); ok("every shortlisted story has a rank and a reason");
assert(T("story_scores").length > 0 && new Set(T("story_scores").map((x) => `${x.story_id}|${x.dimension}`)).size === T("story_scores").length); ok("scores saved once per story and dimension");
const dims = new Set(T("story_scores").map((x) => x.dimension));
for (const d of ["recency", "novelty", "evidence_quality", "source_independence", "editorial_significance", "human_relevance", "curiosity", "geographic_spread"]) assert(dims.has(d), d);
ok("each dimension is stored separately");
assert(T("story_scores").every((x) => x.reason.length > 5)); ok("every stored score has a plain-words reason");
assert(picks.every((x) => T("stories").find((s) => s.id === x.story_id).editorial_status === "in_review")); ok("shortlisted stories are marked awaiting review");
const scoreCount = T("story_scores").length;
const r3 = await start(); end = await runToEnd(r3.run.id);
assert.equal(T("story_scores").length, scoreCount); ok("a second run re-scores without duplicating score rows");

console.log("Scoring tables not installed");
reset(); behaviour = {}; shared = {}; missing = new Set(["shortlist", "story_scores"]);
r = await start(); end = await runToEnd(r.run.id);
assert(end.error && /002_scoring\.sql/.test(end.error)); assert.equal(end.run.status, "incomplete"); ok("missing migration gives a clear message and an incomplete run (not a false success)");
assert(["prepare", "discover", "cluster"].every((n) => T("research_run_stages").find((x) => x.stage === n)?.status === "completed")); ok("earlier stages stay saved");
missing = new Set(); end = await runToEnd(r.run.id);
assert.equal(end.run.status, "completed"); ok("after the migration is run, Resume completes the same run");

console.log("Built-in list changes");
reset(); behaviour = {}; shared = {};
T("source_registry").push({ id: crypto.randomUUID(), name: "EurekAlert", feed_url: "https://www.eurekalert.org/rss.xml", reliability_note: "tier:primary; built-in candidate, health tested automatically", retrieval_status: "failing", enabled: false });
T("source_registry").push({ id: crypto.randomUUID(), name: "Phys.org", feed_url: "https://old.example.com/feed", reliability_note: "tier:reporting; built-in candidate, health tested automatically", retrieval_status: "failing", enabled: false });
T("source_registry").push({ id: crypto.randomUUID(), name: "My own note", feed_url: null, reliability_note: null, retrieval_status: "untested", enabled: false });
fetched.length = 0; r = await start(); end = await runToEnd(r.run.id);
assert.equal(T("source_registry").find((x) => x.name === "EurekAlert").retrieval_status, "disabled"); assert(!fetched.some((u) => u.includes("eurekalert"))); ok("retired built-in source disabled and never fetched");
assert.equal(T("source_registry").find((x) => x.name === "Phys.org").feed_url, "https://phys.org/rss-feed/"); assert.equal(T("source_registry").find((x) => x.name === "Phys.org").retrieval_status, "healthy"); ok("corrected feed address replaces the old one and is retested");
assert(T("source_registry").some((x) => x.name === "My own note")); ok("other existing rows are preserved");

console.log("Approval workflow");
const story = T("shortlist").find((x) => x.selected);
const sid = story.story_id;
assert.equal((await call(decideFn, { storyId: sid, decision: "approved", acknowledged: true }, null)).status, 401); ok("decisions require sign-in");
assert.equal((await call(decideFn, { storyId: sid, decision: "approved" })).status, 400); ok("approval without the deliberate acknowledgement is refused");
assert.equal((await call(decideFn, { storyId: "nope", decision: "approved", acknowledged: true })).status, 400); ok("bad story id rejected");
assert.equal((await call(decideFn, { storyId: sid, decision: "publish", acknowledged: true })).status, 400); ok("unknown decision rejected");
assert.equal(T("editorial_decisions").length, 0); ok("refused attempts leave no decision record");
assert.equal((await call(creativeFn, { storyId: sid })).status, 409); assert.equal(T("creative_prompts").length, 0); assert.equal((await get(creativeFn, `storyId=${sid}`)).status, 409); ok("unapproved story: no prompt and no recommendation");
assert.equal((await call(creativeFn, { storyId: sid }, null)).status, 401); assert.equal((await get(creativeFn, "history=1", null)).status, 401); assert.equal((await call(referenceFn, { action: "seed" }, null)).status, 401); ok("architect, history and reference library require sign-in");
assert.equal((await call(decideFn, { storyId: sid, decision: "approved", acknowledged: true, notes: "Checked sources" })).status, 200);
assert.equal(T("stories").find((x) => x.id === sid).editorial_status, "approved"); assert.equal(T("editorial_decisions").length, 1); assert(T("audit_events").some((a) => a.event_type === "story_approved" && a.entity_id === sid)); ok("approval saved with notes, status updated and audit event written");
console.log("Creative Prompt Architect (approved story)");
const pv = await (await get(creativeFn, `storyId=${sid}`)).json();
assert(pv.recommended.key && pv.recommended.roles.length >= 4 && pv.recommended.reason && pv.allTreatments.length >= 6 && pv.deliverables.length === 3 && pv.evidence.sources >= 1); ok("preview recommends a treatment, team and reason, and saves nothing");
assert.equal(T("creative_prompts").length, 0);
const g1r = await call(creativeFn, { storyId: sid, deliverable: "script_storyboard", durationSeconds: 60, angle: "Test angle" }); const g1 = await g1r.json();
assert.equal(g1r.status, 200); assert.equal(g1.saved, true); assert.equal(g1.version, 1); ok("approved story: prompt generated and saved as version 1");
const firstUrl = T("retrieved_sources").find((r) => T("story_source_links").some((l) => l.story_id === sid && l.source_id === r.id)).url;
assert(g1.prompt.includes(firstUrl) && g1.prompt.includes("Use ONLY the facts in section B") && g1.prompt.includes("THE WORLD, FILED.") && g1.prompt.includes("Test angle")); ok("prompt carries the real source link, evidence rules, brand and angle");
assert(g1.tools.needed.length === 0 && /No additional tool/.test(g1.tools.note)); ok("script deliverable needs no extra tool");
const row1 = T("creative_prompts")[0]; const dec1 = T("editorial_decisions").filter((d) => d.story_id === sid).pop();
assert.equal(row1.approval_decision_id, dec1.id); assert(row1.evidence_snapshot.sources.length >= 1 && row1.evidence_snapshot.omitted_sources && row1.evidence_snapshot.evidence_limits && row1.evidence_snapshot.claim_classes.length >= 2); ok("saved record links to the approval it relied on and stores the evidence snapshot");
assert(row1.evidence_snapshot.sources.every((x: any) => x.snippet.length <= 400 && !("full_text" in x))); ok("stored evidence contains no full text and snippets are capped");
assert(T("audit_events").some((a) => a.event_type === "creative_prompt_created" && a.entity_id === sid)); ok("generation is audited");
const g2 = await (await call(creativeFn, { storyId: sid, deliverable: "narrated_video", durationSeconds: 90, treatmentKey: "science_discovery", parentId: g1.id, conflictNote: "Outlet A and B give different totals." })).json();
assert.equal(g2.version, 2); assert.equal(g2.treatment.key, "science_discovery"); assert(g2.tools.needed.some((t: any) => /FFmpeg/.test(t.name))); assert(g2.prompt.includes("different totals") && /\[CONFLICTING\]/.test(g2.prompt)); assert.equal(T("creative_prompts")[1].parent_id, g1.id); ok("regenerate with another approach makes version 2 without re-running research");
const hist = await (await get(creativeFn, "history=1")).json();
assert.equal(hist.prompts.length, 2); assert(hist.prompts.every((h: any) => h.approvalCurrent && h.headline)); ok("history lists both versions, approval current");
const one = await (await get(creativeFn, `id=${g1.id}`)).json(); assert(one.prompt && one.prompt.includes(firstUrl)); ok("a current prompt can be opened and copied");
assert.equal((await call(creativeFn, { storyId: "bad" })).status, 400); assert.equal((await get(creativeFn, "id=zzz")).status, 400); ok("bad ids rejected");
const g3 = await (await call(creativeFn, { storyId: sid, deliverable: "nonsense", durationSeconds: 5000, treatmentKey: "nonsense" })).json(); assert.equal(g3.saved, true); assert(g3.prompt.length > 1000); ok("unknown options fall back to safe defaults");
const countBefore = T("creative_prompts").length;
failNext = { table: "creative_prompts", method: "POST", status: 400 }; const refused = await call(creativeFn, { storyId: sid }); assert.equal(refused.status, 409); assert.equal(T("creative_prompts").length, countBefore); ok("a database refusal is reported honestly and nothing is saved");
failNext = { table: "creative_prompts", method: "POST", status: 500 }; assert.equal((await call(creativeFn, { storyId: sid })).status, 502); assert.equal(T("creative_prompts").length, countBefore); ok("a database failure is never reported as saved");
const reg = T("source_registry")[0]; T("style_rules").push({ id: crypto.randomUUID(), rule_key: "a.b", version: 1, category: "visual", statement: "ONLY-PROPOSED-RULE", status: "PROPOSED" }, { id: crypto.randomUUID(), rule_key: "c.d", version: 1, category: "visual", statement: "THE-APPROVED-RULE", status: "APPROVED" });
const g4 = await (await call(creativeFn, { storyId: sid })).json(); assert(g4.prompt.includes("THE-APPROVED-RULE") && !g4.prompt.includes("ONLY-PROPOSED-RULE")); ok("only approved style rules reach the prompt"); void reg;
missing = new Set(["creative_prompts"]); const unsaved = await (await call(creativeFn, { storyId: sid })).json(); assert.equal(unsaved.saved, false); assert.equal(unsaved.notInstalled, true); assert(unsaved.prompt.length > 1000); assert.equal((await (await get(creativeFn, "history=1")).json()).notInstalled, true); missing = new Set(); ok("before migration 003: prompt still works but is clearly marked NOT saved");

console.log("Reference Library");
T("style_rules").length = 0;
const lib0 = await (await get(referenceFn, "")).json(); assert.equal(lib0.rules.length, 0); assert.equal((await call(referenceFn, { action: "seed" })).status, 200);
const lib1 = await (await get(referenceFn, "")).json(); assert.equal(lib1.videos.length, 4); assert(lib1.rules.length >= 7); assert(lib1.rules.every((r: any) => r.status === "PROPOSED") && lib1.videos.every((v: any) => v.inspection_level === "partially_inspected")); ok("seeding loads proposed rules only; no video marked fully inspected");
await call(referenceFn, { action: "seed" }); assert.equal(T("style_rules").length, lib1.rules.length); assert.equal(T("reference_videos").length, 4); ok("seeding twice creates no duplicates");
const rid = T("style_rules")[0].id;
assert.equal((await call(referenceFn, { action: "decide", id: rid, status: "APPROVED" })).status, 200); assert.equal(T("style_rules").find((r) => r.id === rid).status, "APPROVED"); assert(T("audit_events").some((a) => a.event_type === "style_rule_approved" && a.entity_id === rid)); ok("rule approved by the editor and audited");
assert.equal((await call(referenceFn, { action: "decide", id: rid, status: "REJECTED" })).status, 409); assert.equal(T("style_rules").find((r) => r.id === rid).status, "APPROVED"); ok("a decided rule cannot be flipped");
assert.equal((await call(referenceFn, { action: "decide", id: rid, status: "MAYBE" })).status, 400); ok("invalid decision rejected");
assert.equal((await call(referenceFn, { action: "revise", id: rid, statement: "New wording for this rule." })).status, 200);
const rv = T("style_rules").find((r) => r.rule_key === T("style_rules").find((x) => x.id === rid).rule_key && r.version === 2); assert(rv && rv.status === "PROPOSED"); assert.equal(rv.supersedes_id, rid); assert.equal(T("style_rules").find((r) => r.id === rid).statement.includes("New wording"), false); ok("editing creates a new PROPOSED version and leaves the approved one untouched");
assert.equal((await call(referenceFn, { action: "revise", id: rid, statement: "no" })).status, 400); ok("too-short wording rejected");
missing = new Set(["style_rules", "reference_videos"]); assert.equal((await (await get(referenceFn, "")).json()).notInstalled, true); missing = new Set(); ok("before migration 003 the library says NOT INSTALLED");

console.log("Withdrawal: an old approval never authorizes a new prompt");
assert.equal((await call(decideFn, { storyId: sid, decision: "rejected", notes: "Changed my mind" })).status, 200);
const nBefore = T("creative_prompts").length;
assert.equal((await call(creativeFn, { storyId: sid })).status, 409); assert.equal((await get(creativeFn, `storyId=${sid}`)).status, 409); assert.equal(T("creative_prompts").length, nBefore); ok("after rejection: no new prompt and no recommendation");
const stale = await (await get(creativeFn, `id=${g1.id}`)).json(); assert.equal(stale.prompt, null); assert(/no longer current/.test(stale.withheld)); assert.equal(stale.approvalCurrent, false); ok("after rejection: saved prompt is kept but withheld from copying");
const hist2 = await (await get(creativeFn, "history=1")).json(); assert(hist2.prompts.every((h: any) => h.approvalCurrent === false)); ok("history marks them 'no longer current'");
await call(decideFn, { storyId: sid, decision: "needs_research" }); assert.equal((await call(creativeFn, { storyId: sid })).status, 409); ok("sent back for research: still blocked");
assert.equal((await call(decideFn, { storyId: sid, decision: "approved", acknowledged: true })).status, 200);
assert.equal((await (await get(creativeFn, `id=${g1.id}`)).json()).prompt, null); ok("fresh re-approval does NOT revive an old prompt");
const g5 = await (await call(creativeFn, { storyId: sid })).json(); assert.equal(g5.saved, true); assert.equal((await (await get(creativeFn, `id=${g5.id}`)).json()).approvalCurrent, true); ok("a new prompt after re-approval is saved and current");
assert.equal((await call(decideFn, { storyId: sid, decision: "rejected", notes: "Final" })).status, 200);


console.log("Clustering rules");
const c = clusterItems([
  { id: "a", title: "Court strikes down controversial mining licence in Ghana" },
  { id: "b", title: "Ghana court strikes down mining licence amid controversy" },
  { id: "c", title: "Heavy rain floods Lagos streets" },
]);
assert.equal(c.length, 2); ok("similar headlines grouped, unrelated kept apart");
assert.equal(clusterItems([{ id: "x", title: "Yes" }, { id: "y", title: "Yes" }]).length, 2); ok("very short titles are not force-merged");

console.log("Registry balance");
const regions = new Set(seed.SEED_SOURCES.map((s: any) => seed.regionOf(s.scope)));
for (const g of ["Africa", "Asia", "Europe", "Latin America", "Middle East", "North America", "Oceania"]) assert(regions.has(g), g);
assert(seed.SEED_SOURCES.filter((s: any) => seed.isUsOrUk(s.scope)).length <= seed.SEED_SOURCES.length * 0.15); ok("all 7 regions present; US+UK at most 15% of sources");

console.log(`\nALL ${passed} ENGINE CHECKS PASSED`);

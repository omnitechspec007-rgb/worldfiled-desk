// Planner API tests against a simulated Supabase. The simulation emulates the migration-005 rules (one open cycle,
// closed cycles locked, publish needs a current approval); the real SQL is tested on real Postgres in tests/db/migration005.test.mjs.
import assert from "node:assert";

process.env.EDITOR_PASSPHRASE = "blue lantern river 42";
process.env.SESSION_SECRET = "z".repeat(40);
process.env.SUPABASE_URL = "https://abc.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test";
const root = new URL("../netlify/", import.meta.url).pathname;
const session = await import(`${root}lib/session.mts`);
const fn = (await import(`${root}functions/cycles.mts`)).default;
const { membersKey } = await import(`${root}lib/editions.mts`);
const cookie = session.makeSessionCookie().split(";")[0];
const ok = (m: string) => console.log("PASS " + m);

let tables: Record<string, any[]> = {}; let missing = new Set<string>(["edition_cycles", "cycle_stories"]); let failNext: { table: string; method: string; status: number } | null = null; let seq = 0;
const T = (x: string) => (tables[x] ??= []);
function matches(row: any, p: URLSearchParams) {
  for (const [k, v] of p) {
    if (["select", "order", "limit", "on_conflict"].includes(k)) continue;
    if (v.startsWith("eq.")) { if (String(row[k]) !== v.slice(3)) return false; }
    else if (v.startsWith("in.(")) { if (!v.slice(4, -1).split(",").includes(String(row[k]))) return false; }
  }
  return true;
}
const hashOf = (eid: string) => membersKey(T("edition_developments").filter((d) => d.edition_id === eid).sort((a, b) => a.position - b.position).map((d) => d.story_id));
const latestOf = (rows: any[]) => [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
const REFUSE = () => new Response("{}", { status: 400 });
function postgrest(url: URL, init: any) {
  const table = url.pathname.split("/rest/v1/")[1]; const m = init.method ?? "GET"; const p = url.searchParams;
  if (failNext && failNext.table === table && failNext.method === m) { const s = failNext.status; failNext = null; return new Response("{}", { status: s }); }
  if (missing.has(table)) return new Response("{}", { status: 404 });
  const rows = T(table); const prefer = init.headers?.Prefer ?? "";
  if (m === "GET") {
    let out = rows.filter((r) => matches(r, p));
    const ord = p.get("order"); if (ord) { const [c, d] = ord.split(",")[0].split("."); out = [...out].sort((a, b) => (typeof a[c] === "number" ? a[c] - b[c] : String(a[c] ?? "").localeCompare(String(b[c] ?? ""))) * (d === "desc" ? -1 : 1)); }
    const lim = Number(p.get("limit") ?? 0); if (lim) out = out.slice(0, lim);
    if (table === "stories") out = out.map((st) => ({ ...st, story_source_links: T("story_source_links").filter((l) => l.story_id === st.id).map((l) => { const rs = T("retrieved_sources").find((r) => r.id === l.source_id); return { retrieved_sources: rs ? { ...rs, source_registry: T("source_registry").find((g) => g.id === rs.registry_id) } : null }; }) }));
    return new Response(JSON.stringify(out), { status: 200 });
  }
  if (m === "POST") {
    const body = JSON.parse(init.body); const list = Array.isArray(body) ? body : [body]; const created: any[] = [];
    for (const item of list) {
      if (table === "system_settings") { const ex = rows.find((r) => r.key === item.key); if (ex) { Object.assign(ex, item); created.push(ex); continue; } }
      if (table === "edition_decisions") item.members_hash = hashOf(item.edition_id);
      if (table === "edition_cycles" && rows.some((r) => r.status === "open")) return new Response("{}", { status: 409 });
      const row = { id: crypto.randomUUID(), created_at: new Date(Date.now() + seq++).toISOString(), updated_at: new Date().toISOString(), status: table === "edition_cycles" ? "open" : table === "editions" ? "draft" : undefined, stage_done: table === "edition_cycles" ? {} : undefined, ...item };
      rows.push(row); created.push(row);
    }
    return prefer.includes("return=representation") ? new Response(JSON.stringify(created), { status: 201 }) : new Response(null, { status: 201 });
  }
  if (m === "PATCH") {
    for (const r of rows.filter((r) => matches(r, p))) {
      const patch = JSON.parse(init.body);
      if (table === "edition_cycles") {
        if (r.status !== "open") return REFUSE();
        if (patch.status === "published") { const dec = latestOf(T("edition_decisions").filter((d) => d.edition_id === r.edition_id)); if (!r.edition_id || dec?.decision !== "approved" || dec.members_hash !== hashOf(r.edition_id)) return REFUSE(); }
      }
      Object.assign(r, patch, { updated_at: new Date().toISOString() });
    }
    return new Response(null, { status: 204 });
  }
  return new Response("{}", { status: 405 });
}
globalThis.fetch = (async (input: any, init: any = {}) => { const u = new URL(String(input)); if (u.hostname !== "abc.supabase.co") throw new Error("unexpected fetch " + u); return postgrest(u, init); }) as any;
const call = (body: any, c: string | null = cookie) => fn(new Request("https://x/", { method: "POST", headers: { origin: "https://x", "content-type": "application/json", ...(c ? { cookie: c } : {}) }, body: JSON.stringify(body) }));
const get = (q: string, c: string | null = cookie) => fn(new Request("https://x/?" + q, { method: "GET", headers: c ? { cookie: c } : {} }));

// ---------- seed ----------
const H = 3600_000; const NOW = Date.now(); const at = (h: number) => new Date(NOW - h * H).toISOString();
const reg = (name: string) => { let r = T("source_registry").find((x) => x.name === name); if (!r) { r = { id: crypto.randomUUID(), name, country_scope: "Europe · test", reliability_note: "" }; T("source_registry").push(r); } return r; };
function story(headline: string, ageH: number | string, nSources = 2) {
  const st = { id: crypto.randomUUID(), headline, category: "Public policy", created_at: typeof ageH === "number" ? at(ageH) : ageH, editorial_status: "pending" }; T("stories").push(st);
  for (let i = 0; i < nSources; i++) { const rs = { id: crypto.randomUUID(), registry_id: reg(`${headline.split(" ")[0]} Outlet ${i}`).id, title: `${headline} report ${i}`, url: `https://o${i}.example/${st.id.slice(0, 6)}`, published_at: typeof ageH === "number" ? at(ageH) : ageH, retrieved_at: at(0.5), extract: "Officials said the measure takes effect." }; T("retrieved_sources").push(rs); T("story_source_links").push({ story_id: st.id, source_id: rs.id }); }
  return st.id;
}
const A = story("Alpha ministry publishes preparedness guide for households", 8);
const B = story("Bravo agency announces late shelter funding decision", 1);
const Cc = story("Charlie council passes earlier recycling rule", 40);
const D = story("Delta board approves harbour plan", 6);
for (const storyId of [A, D]) {
  const row = T("stories").find((story) => story.id === storyId)!;
  row.verification_status = "verified";
  T("claims").push({
    id: crypto.randomUUID(), story_id: storyId,
    claim_evidence: [{ id: crypto.randomUUID(), passage: "Checked supporting passage for the planner fixture.", extraction_status: "extracted", is_contradiction: false, created_at: new Date(Date.now() - 60_000).toISOString() }],
    verification_results: [{ id: crypto.randomUUID(), outcome: "SUPPORTED", reviewer_notes: "Planner fixture editor decision.", created_at: new Date().toISOString() }],
  });
}

console.log("Planner API");
assert.equal((await get("", null)).status, 401); assert.equal((await call({ action: "plan" }, null)).status, 401); ok("planner requires sign-in");
let pl = await (await get("")).json();
assert.equal(pl.installed, false); assert.equal(pl.configured, false); assert.equal(pl.config.timezone, "America/New_York"); assert(pl.upcoming.length === 4 && pl.upcoming.every((u: any) => u.timeline.researchCutoff.local)); ok("before migration 005: reports NOT INSTALLED, shows the default schedule and upcoming times with their timelines");
let r = await call({ action: "plan", publishAt: new Date(NOW + 3 * H).toISOString(), mode: "continuous" }); assert.equal(r.status, 409); assert.equal((await r.json()).error, "not_installed"); ok("planning before migration: clear message, nothing saved");

console.log("Settings");
let cr = await call({ action: "save-config", config: { ...pl.config, timezone: "Mars/Base" } }); assert.equal(cr.status, 400); assert((await cr.json()).errors.length >= 1); assert.equal(T("system_settings").length, 0); ok("invalid schedule refused with reasons");
assert.equal((await call({ action: "save-config", config: { ...pl.config, allowances: { ...pl.config.allowances, productionMin: -5 } } })).status, 400); ok("negative allowance refused");
assert.equal((await call({ action: "save-config", config: { ...pl.config, timezone: "Asia/Tokyo", coverageHours: 8 } })).status, 200); assert.equal(T("system_settings")[0].key, "edition_schedule"); assert(T("audit_events").some((a) => a.event_type === "edition_schedule_saved")); ok("valid schedule saved in system_settings and audited (no new table)");
assert.equal((await call({ action: "save-config", config: { ...pl.config, timezone: "Asia/Tokyo", coverageHours: 12 } })).status, 200); assert.equal(T("system_settings").length, 1); ok("saving again updates the same row");
pl = await (await get("")).json(); assert(pl.configured && pl.config.timezone === "Asia/Tokyo" && /GMT\+9/.test(pl.upcoming[0].local)); ok("planner shows times in the configured timezone");
await call({ action: "save-config", config: { ...pl.config, timezone: "America/New_York" } });

console.log("Planning");
missing.clear();
const pubAt = new Date(NOW + 3 * H).toISOString();
assert.equal((await call({ action: "plan", publishAt: new Date(NOW - H).toISOString(), mode: "continuous" })).status, 400); ok("a publication time in the past is refused");
assert.equal((await call({ action: "plan", publishAt: pubAt, mode: "weekly" })).status, 400); ok("unknown mode refused");
let pr = await call({ action: "plan", publishAt: pubAt, mode: "continuous", label: "Test edition" }); let pj = await pr.json(); assert.equal(pr.status, 200); assert(pj.saved && pj.firstEdition); const cyc = T("edition_cycles")[0];
assert.equal(Date.parse(cyc.coverage_end) - Date.parse(cyc.coverage_start), 12 * H); assert.equal(cyc.coverage_end, cyc.research_cutoff); assert.equal(Date.parse(cyc.planned_publish_at) - Date.parse(cyc.research_cutoff), 315 * 60_000); ok("first continuous edition: 12h default coverage ending at the research cutoff, 315 minutes before publication");
assert(cyc.timeline.allowances.productionMin === 120 && cyc.timeline.stages.finalReviewStart.local); assert(T("audit_events").some((a) => a.event_type === "cycle_planned")); ok("plan stores the allowances it used and is audited");
assert.equal((await call({ action: "plan", publishAt: new Date(NOW + 9 * H).toISOString(), mode: "continuous" })).status, 409); ok("a second open cycle is refused");
pl = await (await get("")).json(); const cv = pl.cycle;
assert(cv && cv.coverage.local && cv.timeline.researchCutoff.local && cv.timeline.selectionDeadline.local && cv.plannedLocal && cv.standing.explanation); ok("dashboard: coverage window, research cutoff, selection deadline, planned publication, explanation");
const byId = (id: string) => cv.stories.find((s: any) => s.id === id);
assert(byId(A)?.cls === "NEW" && byId(A).candidate && byId(A).reason); ok("a story reported inside the window is NEW, with a reason");
assert(!byId(B) && cv.lateBreaking.some((x: any) => x.id === B)); ok("a story reported after the cutoff is NOT in the window; it is flagged late-breaking");
assert(byId(Cc)?.cls === "NEVER_VERIFIED" && byId(Cc).candidate === false); ok("an older, never-reviewed story is surfaced as discovered-but-never-verified, not a candidate");
assert(cv.counts.discovered >= 2 && cv.counts.selected === 0 && cv.counts.candidates >= 2); ok("counts: discovered, verified, selected");
assert(cv.stage === "research" && ["ON SCHEDULE", "AT RISK", "BEHIND SCHEDULE"].includes(cv.standing.status)); ok("stage is derived from real progress (research); status is one of the three labels");
assert(cv.standing.status === "BEHIND SCHEDULE" || cv.standing.status === "AT RISK"); assert(cv.standing.actions.some((x: string) => /Evidence standards are not lowered/.test(x))); ok("cutoff already passed with work remaining: recommendations never lower evidence standards");

console.log("Edition linkage, progress and publishing");
const E = crypto.randomUUID(); T("editions").push({ id: E, title: "Ed", status: "draft", structure: "news_roundup" }); [A, D].forEach((s, i) => T("edition_developments").push({ edition_id: E, story_id: s, position: i + 1 }));
assert.equal((await call({ action: "link-edition", id: cyc.id, editionId: crypto.randomUUID() })).status, 404); ok("linking an unknown edition is refused");
assert.equal((await call({ action: "publish", id: cyc.id })).status, 409); ok("cannot publish with no edition");
assert.equal((await call({ action: "link-edition", id: cyc.id, editionId: E })).status, 200);
pl = await (await get("")).json(); assert.equal(pl.cycle.stage, "selection"); assert.equal(pl.cycle.counts.selected, 2); ok("linked edition moves the stage to selection and shows the selected count");
assert.equal((await call({ action: "publish", id: cyc.id })).status, 409); assert.equal(T("cycle_stories").length, 0); ok("publishing needs a current approval: refused, nothing marked");
T("edition_decisions").push({ id: crypto.randomUUID(), edition_id: E, decision: "approved", decided_by: "ed", members_hash: hashOf(E), created_at: new Date(Date.now() + seq++).toISOString() });
pl = await (await get("")).json(); assert.equal(pl.cycle.stage, "prompt"); assert(pl.cycle.approved); ok("approval moves the stage to prompt");
const dec = T("edition_decisions")[0]; T("edition_prompts").push({ id: crypto.randomUUID(), edition_id: E, version: 1, members: [A, D], members_hash: hashOf(E), approval_decision_id: dec.id, created_at: new Date().toISOString() });
pl = await (await get("")).json(); assert.equal(pl.cycle.stage, "production"); assert.equal(pl.cycle.standing.readiness, "READY FOR PRODUCTION"); ok("a current prompt moves the stage to production: READY FOR PRODUCTION");
T("stories").find((story) => story.id === A)!.verification_status = "in_progress";
pl = await (await get("")).json(); assert.equal(pl.cycle.stage, "prompt"); assert.equal(pl.cycle.promptMade, false);
ok("a later claim-register change makes the saved prompt stale and returns the cycle to the prompt gate");
T("stories").find((story) => story.id === A)!.verification_status = "verified";
assert.equal((await call({ action: "mark-stage", id: cyc.id, stage: "review", done: true })).status, 409); ok("final review cannot be marked before production");
assert.equal((await call({ action: "mark-stage", id: cyc.id, stage: "production", done: true })).status, 200); pl = await (await get("")).json(); assert.equal(pl.cycle.standing.readiness, "READY FOR FINAL REVIEW"); ok("production done: READY FOR FINAL REVIEW");
let pb = await call({ action: "publish", id: cyc.id }); assert.equal(pb.status, 409); assert.equal((await pb.json()).error, "stages_incomplete"); ok("publishing with final review not marked asks for confirmation");
assert.equal((await call({ action: "mark-stage", id: cyc.id, stage: "review", done: true })).status, 200); pl = await (await get("")).json(); assert.equal(pl.cycle.standing.readiness, "READY TO PUBLISH"); assert.equal(pl.cycle.standing.status, "ON SCHEDULE"); ok("review done: READY TO PUBLISH, ON SCHEDULE");
// editing members after approval makes the approval stale
T("edition_developments").push({ edition_id: E, story_id: Cc, position: 3 });
assert.equal((await call({ action: "publish", id: cyc.id })).status, 409); assert.equal(T("edition_cycles")[0].status, "open"); ok("a stale approval (members changed) blocks publishing");
T("edition_developments").pop();
failNext = { table: "edition_cycles", method: "PATCH", status: 400 }; pb = await call({ action: "publish", id: cyc.id }); assert.equal(pb.status, 409); assert.equal((await pb.json()).error, "refused"); assert.equal(T("cycle_stories").length, 0); ok("a database refusal is reported as refused; nothing marked");
pb = await call({ action: "publish", id: cyc.id }); assert.equal(pb.status, 200); assert.equal(T("edition_cycles")[0].status, "published"); assert(T("edition_cycles")[0].actual_published_at);
assert.deepEqual(T("cycle_stories").filter((m) => m.mark === "published").map((m) => m.story_id).sort(), [A, D].sort()); ok("published: cycle closed with actual time; members marked published");
assert.equal((await call({ action: "publish", id: cyc.id })).status, 200); assert.equal(T("cycle_stories").length, 2); ok("publishing again is harmless (idempotent, no duplicate marks)");
const ex = await call({ action: "mark-story", id: cyc.id, storyId: B, mark: "held_over" }); assert.equal(ex.status, 409); assert.equal((await call({ action: "skip", id: cyc.id, reason: "too late" })).status, 409); ok("a published cycle cannot be edited or skipped");
const marksBefore = T("cycle_stories").length;
// repair path: a publish whose marks failed
T("cycle_stories").length = 0; assert.equal((await (await call({ action: "publish", id: cyc.id })).json()).marked, 2); assert.equal(T("cycle_stories").length, marksBefore); ok("a publish whose marks failed to save can be repaired by publishing again");

console.log("Next edition: no gaps, no duplicates");
pl = await (await get("")).json(); assert.equal(pl.previous.id, cyc.id); assert.equal(pl.nextContinuousStart, cyc.coverage_end); ok("previous edition and its coverage window are shown; the next continuous window starts at its cutoff");
const pub2 = new Date(NOW + 12 * H).toISOString();
assert.equal((await call({ action: "plan", publishAt: pub2, mode: "continuous", label: "Next" })).status, 200); const c2 = T("edition_cycles")[1];
assert.equal(c2.coverage_start, cyc.coverage_end); assert.equal(c2.previous_cycle_id, cyc.id); ok("continuous mode: next window starts exactly where the previous ended (no gap, no overlap)");
pl = await (await get("")).json(); const s2 = (id: string) => pl.cycle.stories.find((s: any) => s.id === id);
assert(!s2(A) || s2(A).candidate === false); assert(s2(A)?.cls === "ALREADY_PUBLISHED" || !s2(A)); ok("an already published story is not offered again");
assert.equal(s2(B)?.cls, "NEW"); ok("the story that was late-breaking last cycle is a NEW candidate in the next window");
await call({ action: "mark-story", id: c2.id, storyId: Cc, mark: "held_over", note: "needs a second source" }); assert(T("cycle_stories").some((m) => m.story_id === Cc && m.mark === "held_over")); ok("a story can be held over with a note");
assert.equal((await call({ action: "mark-story", id: c2.id, storyId: Cc, mark: "published" })).status, 400); ok("published marks cannot be set by hand");
assert.equal((await call({ action: "skip", id: c2.id, reason: "no" })).status, 400); ok("skipping needs a reason");
assert.equal((await call({ action: "skip", id: c2.id, reason: "Missed this edition" })).status, 200); assert.equal(T("edition_cycles")[1].status, "skipped"); ok("a missed edition can be marked skipped");
assert.equal((await call({ action: "plan", publishAt: new Date(NOW + 24 * H).toISOString(), mode: "continuous" })).status, 200); const c3 = T("edition_cycles")[2];
assert.equal(c3.coverage_start, cyc.coverage_end); assert(Date.parse(c3.coverage_end) - Date.parse(c3.coverage_start) > 12 * H); ok("after a skipped edition the next window folds the missed period in (no gap)");
await call({ action: "skip", id: c3.id, reason: "testing rolling" });

console.log("Rolling, custom, overlap, preview");
const rp = async (hrs: number) => (await call({ action: "plan", publishAt: new Date(NOW + 6 * H).toISOString(), mode: "rolling", hours: hrs, end: "now" }));
let rr = await rp(6); assert.equal(rr.status, 409); const rj = await rr.json(); assert.equal(rj.error, "overlap"); assert(rj.overlaps[0].minutes > 0); ok("a rolling window that overlaps an earlier edition needs explicit acknowledgement (shows the overlap)");
rr = await call({ action: "plan", publishAt: new Date(NOW + 6 * H).toISOString(), mode: "rolling", hours: 6, end: "now", acknowledgeOverlap: true }); assert.equal(rr.status, 200); const c4 = T("edition_cycles")[3]; assert.equal(Date.parse(c4.coverage_end) - Date.parse(c4.coverage_start), 6 * H); assert.equal(c4.mode, "rolling"); ok("acknowledged overlap: rolling 6-hour window saved");
await call({ action: "skip", id: c4.id, reason: "done testing" });
assert.equal((await call({ action: "plan", publishAt: new Date(NOW + 6 * H).toISOString(), mode: "rolling", hours: 0 })).status, 400); assert.equal((await call({ action: "plan", publishAt: new Date(NOW + 6 * H).toISOString(), mode: "custom", from: "x", to: "y" })).status, 400); ok("bad rolling or custom input refused");
assert.equal((await call({ action: "plan", publishAt: new Date(NOW + 6 * H).toISOString(), mode: "custom", from: at(2), to: at(-8), acknowledgeOverlap: true })).status, 400); ok("a coverage window ending after publication is refused");
const pv = await (await get("preview=1&mode=rolling&hours=24")).json(); assert.equal(pv.window.hours, 24); assert(pv.stories.length >= 1 && pv.stories.every((s: any) => s.cls && s.reason)); ok("preview: last 24 hours classifies stories without saving anything");
assert.equal((await get("preview=1&mode=rolling&hours=999999")).status, 400); assert.equal((await get("preview=1&mode=custom&from=2026-01-01T00:00:00Z&to=2025-01-01T00:00:00Z")).status, 400); assert.equal((await get("preview=1&mode=nope")).status, 400); ok("preview refuses bad windows");
const edge = story("Echo office issues boundary notice for residents", at(0).length ? 3 : 3);
const edgeIso = T("retrieved_sources").filter((s) => T("story_source_links").some((l) => l.story_id === edge && l.source_id === s.id))[0].published_at;
T("retrieved_sources").filter((s) => T("story_source_links").some((l) => l.story_id === edge && l.source_id === s.id)).forEach((s) => (s.published_at = edgeIso));
const ends = await (await get(`preview=1&mode=custom&from=${encodeURIComponent(new Date(Date.parse(edgeIso) - 2 * H).toISOString())}&to=${encodeURIComponent(edgeIso)}`)).json();
assert(!ends.stories.some((s: any) => s.id === edge && s.cls === "NEW")); const starts = await (await get(`preview=1&mode=custom&from=${encodeURIComponent(edgeIso)}&to=${encodeURIComponent(new Date(Date.parse(edgeIso) + 2 * H).toISOString())}`)).json(); assert(starts.stories.some((s: any) => s.id === edge && s.cls === "NEW")); ok("boundary: a story reported exactly at a window's end is outside it and exactly at the start is inside it");
console.log("Failure handling");
failNext = { table: "edition_cycles", method: "GET", status: 500 }; assert.equal((await get("")).status, 502); ok("a database failure is reported as an error, never as an empty planner");
assert.equal((await fn(new Request("https://x/", { method: "PUT", headers: { cookie } }))).status, 405); assert.equal((await call({ action: "nope" })).status, 400); ok("bad method and unknown action rejected");
console.log("\nALL PLANNER API CHECKS PASSED");

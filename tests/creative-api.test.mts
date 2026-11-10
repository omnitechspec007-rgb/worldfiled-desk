// Creative Desk API tests against a simulated Supabase. The simulation emulates the migration-005 rules (one open cycle,
// closed cycles locked, publish needs a current approval); the real SQL is tested on real Postgres in tests/db/migration005.test.mjs.
import assert from "node:assert";

process.env.EDITOR_PASSPHRASE = "blue lantern river 42";
process.env.SESSION_SECRET = "z".repeat(40);
process.env.SUPABASE_URL = "https://abc.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test";
const root = new URL("../netlify/", import.meta.url).pathname;
const session = await import(`${root}lib/session.mts`);
const cfn = (await import(`${root}functions/creative-config.mts`)).default;
const pfn = (await import(`${root}functions/edition-prompt.mts`)).default;
const { membersKey } = await import(`${root}lib/editions.mts`);
const cookie = session.makeSessionCookie().split(";")[0];
const ok = (m: string) => console.log("PASS " + m);

let tables: Record<string, any[]> = {}; let missing = new Set<string>(); let failNext: { table: string; method: string; status: number } | null = null; let seq = 0;
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
    // Synthetic, current claim registers isolate the creative workflow tests from claim-edge cases.
    // Claim-clearance and claim-verification suites exercise unsupported, stale and contradictory evidence.
    if (table === "claims") out = T("stories").filter((st) => matches({ story_id: st.id }, p)).map((st) => ({
      id: "claim-" + st.id, story_id: st.id,
      claim_evidence: [{ id: "evidence-" + st.id, passage: "Checked synthetic supporting passage for creative workflow test.", extraction_status: "extracted", is_contradiction: false, created_at: new Date(Date.now() - 60000).toISOString(), retrieved_sources: { registry_id: T("story_source_links").filter((l) => l.story_id === st.id).map((l) => T("retrieved_sources").find((s) => s.id === l.source_id)).filter(Boolean).map((s) => s.registry_id)[0] } }],
      verification_results: [{ id: "decision-" + st.id, outcome: "SUPPORTED", reviewer_notes: "Synthetic editor decision for creative workflow test.", created_at: new Date().toISOString() }]
    }));
    return new Response(JSON.stringify(out), { status: 200 });
  }
  if (m === "POST") {
    const body = JSON.parse(init.body); const list = Array.isArray(body) ? body : [body]; const created: any[] = [];
    for (const item of list) {
      if (table === "system_settings") { const ex = rows.find((r) => r.key === item.key); if (ex) { Object.assign(ex, item); created.push(ex); continue; } }
      if (table === "edition_decisions") item.members_hash = hashOf(item.edition_id);
      if (table === "edition_prompts") { if (item.members_hash !== hashOf(item.edition_id)) return REFUSE(); item.approval_decision_id = null; }
      const row = { id: crypto.randomUUID(), created_at: new Date(Date.now() + seq++).toISOString(), updated_at: new Date().toISOString(), status: table === "edition_cycles" ? "open" : table === "editions" ? "draft" : undefined, stage_done: table === "edition_cycles" ? {} : undefined, ...item };
      rows.push(row); created.push(row);
    }
    return prefer.includes("return=representation") ? new Response(JSON.stringify(created), { status: 201 }) : new Response(null, { status: 201 });
  }
  if (m === "PATCH") {
    for (const r of rows.filter((r) => matches(r, p))) {
      const patch = JSON.parse(init.body);
      Object.assign(r, patch, { updated_at: new Date().toISOString() });
    }
    return new Response(null, { status: 204 });
  }
  return new Response("{}", { status: 405 });
}
globalThis.fetch = (async (input: any, init: any = {}) => { const u = new URL(String(input)); if (u.hostname !== "abc.supabase.co") throw new Error("unexpected fetch " + u); return postgrest(u, init); }) as any;
const call = (fn: any, body: any, c: string | null = cookie) => fn(new Request("https://x/", { method: "POST", headers: { origin: "https://x", "content-type": "application/json", ...(c ? { cookie: c } : {}) }, body: JSON.stringify(body) }));
const get = (fn: any, q: string, c: string | null = cookie) => fn(new Request("https://x/?" + q, { method: "GET", headers: c ? { cookie: c } : {} }));

// ---------- seed ----------
const H = 3600_000; const NOW = Date.now(); const at = (h: number) => new Date(NOW - h * H).toISOString();
const reg = (name: string, official = false) => { let r = T("source_registry").find((x) => x.name === name); if (!r) { r = { id: crypto.randomUUID(), name, country_scope: "Europe · test", reliability_note: official ? "tier:primary" : "" }; T("source_registry").push(r); } return r; };
function story(headline: string, category: string, srcs: [string, string, string, boolean?][]) {
  // Synthetic fixture: claim and story-level clearance are both complete.
  const st = { id: crypto.randomUUID(), headline, category, created_at: at(2), editorial_status: "pending", verification_status: "verified" };
  T("stories").push(st);
  srcs.forEach(([outlet, title, extract, official], i) => { const rs = { id: crypto.randomUUID(), registry_id: reg(outlet, !!official).id, title, url: `https://${outlet.toLowerCase().replace(/\W/g, "")}.example/${st.id.slice(0, 6)}/${i}`, published_at: at(5), retrieved_at: at(1), extract }; T("retrieved_sources").push(rs); T("story_source_links").push({ story_id: st.id, source_id: rs.id }); });
  return st.id;
}
const jp = story("Japan orders new emergency preparedness plan with stockpiles for families", "Government and institutional decisions", [["Tokyo Gazette", "Japan updates national preparedness and stockpile directive", "Government ministry orders households and local councils to stockpile water and food for disasters.", true], ["Tokyo Times", "Tokyo tightens emergency readiness rules", "Families must keep supplies; shelters and early warning expanded in Japan."]]);
const al = story("Prosecutors accuse Nigeria minister Adewale Ogunlesi of procurement fraud", "Public policy", [["Lagos Gazette", "Prosecutors accuse Nigeria minister Adewale Ogunlesi of procurement fraud", "The minister denied the allegations, officials in Nigeria said.", true]]);
const rt = story("Central bank in Brazil raises interest rates as inflation climbs", "Business and economic developments", [["Brasilia Gazette", "Brazil raises interest rates to fight inflation", "The central bank decision affects mortgages, prices and wages.", true], ["Brasilia Times", "Brazilian central bank hikes rate", "Inflation and currency pressure drive the rate rise in Brazil."]]);
// Explicitly permit the synthetic test passages; production defaults remain metadata-only.
for (const source of T("retrieved_sources")) T("source_content_policies").push({ source_id: source.registry_id, policy: "extraction_allowed" });
const E = crypto.randomUUID(); T("editions").push({ id: E, title: "Roundup", status: "draft", structure: "news_roundup", narrative_angle: "" });
[jp, al, rt].forEach((s, i) => T("edition_developments").push({ edition_id: E, story_id: s, position: i + 1 }));
const hashNow = () => hashOf(E);
T("edition_decisions").push({ id: crypto.randomUUID(), edition_id: E, decision: "approved", decided_by: "ed", members_hash: hashNow(), created_at: new Date(Date.now() + seq++).toISOString() });
const decide = (sid: string, decision: string) => T("editorial_decisions").push({ id: crypto.randomUUID(), story_id: sid, decision, decided_by: "ed", created_at: new Date(Date.now() + seq++).toISOString() });

console.log("Creative setup API");
assert.equal((await get(cfn, "", null)).status, 401); assert.equal((await call(cfn, { action: "save-voice" }, null)).status, 401); ok("creative setup requires sign-in");
let cv = await (await get(cfn, "")).json();
assert.equal(cv.configured, false); assert.equal(cv.voice.voiceName, "Laomedeia"); assert.equal(cv.voice.status, "REFERENCE_ONLY"); assert.equal(cv.approval, "NOT_APPROVED"); assert.equal(cv.voice.licence.status, "UNVERIFIED"); assert.equal(cv.voice.lastTested, null); ok("default: Laomedeia is a reference profile, untested, unapproved, licence unverified");
assert(cv.capabilities.every((c: any) => c.tested === false) && cv.profiles.length === 8 && cv.laomedeiaReference.medianPitchHz === 187); ok("capability registry marks nothing tested; eight delivery profiles; reference measurements present");
let r = await call(cfn, { action: "save-voice", voice: { ...cv.voice, engine: "" } }); assert.equal(r.status, 400); assert.equal(T("system_settings").length, 0); ok("invalid voice refused, nothing saved");
r = await call(cfn, { action: "approve-voice", listened: true }); assert.equal(r.status, 409); ok("a voice that is not marked tested cannot be approved");
assert.equal((await call(cfn, { action: "approve-voice" })).status, 400); ok("approval needs the listening confirmation");
r = await call(cfn, { action: "save-voice", voice: { ...cv.voice, status: "TESTED_BY_EDITOR", lastTested: "2026-10-30" } }); assert.equal(r.status, 200); assert(T("audit_events").some((a) => a.event_type === "creative_voice_saved")); ok("voice saved (tested by editor, with a date) and audited");
r = await call(cfn, { action: "approve-voice", listened: true, note: "Sounds right" }); let j = await r.json(); assert.equal(r.status, 200); assert.equal(j.approval, "APPROVED"); ok("listening approval recorded for this exact engine + voice");
cv = await (await get(cfn, "")).json(); assert.equal(cv.approval, "APPROVED"); assert.equal(cv.configured, true);
r = await call(cfn, { action: "save-voice", voice: { ...cv.voice, engine: "Another engine", status: "NOT_YET_TESTED" } }); j = await r.json(); assert.equal(r.status, 200); assert.equal(j.approval, "VOID_VOICE_CHANGED"); assert(/no longer applies/.test(j.note)); ok("changing the engine voids the approval and says so (no silent carry-over)");
r = await call(cfn, { action: "save-voice", voice: { ...j.voice, engine: v0engine(cv) } }); assert.equal((await r.json()).approval, "APPROVED"); ok("returning to the exact approved voice restores that approval (it belongs to the voice, not the editor session)");
assert.equal((await call(cfn, { action: "save-tools", toolsConfirmed: ["paid_tts"] })).status, 400); assert.equal((await call(cfn, { action: "save-tools", toolsConfirmed: ["nope"] })).status, 400); assert.equal((await call(cfn, { action: "save-tools", toolsConfirmed: ["ffmpeg", "natural_earth"] })).status, 200); ok("paid services can never be marked available; unknown tools refused; free tools can be confirmed");
assert.equal((await call(cfn, { action: "save-lexicon", entry: { name: "Ogunlesi", status: "CONFIRMED_HUMAN", pronunciation: "", source: "" } })).status, 400); ok("a confirmed pronunciation without a respelling and source is refused");
assert.equal((await call(cfn, { action: "save-lexicon", entry: { name: "Ogunlesi", status: "PROPOSED", pronunciation: "oh-goon-LAY-see" } })).status, 200); assert.equal((await call(cfn, { action: "save-lexicon", entry: { name: "ogunlesi", status: "UNCONFIRMED" } })).status, 200); assert.equal(T("system_settings").find((s) => s.key === "pronunciation_lexicon").value.entries.length, 1); ok("lexicon entry saved; the same name replaces rather than duplicates");
function v0engine(c: any) { return c.voice.engine === "Another engine" ? "Google AI Studio (manual generation)" : c.voice.engine; }

console.log("Edition prompt with the saved setup");
let pv = await (await get(pfn, `editionId=${E}`)).json();
assert(pv.creative.format.key === "global_roundup" && pv.creative.scenes.length >= 5 && pv.creative.runtime.total <= 91 && pv.creative.voice.approval); ok("preview shows the programme format, per-scene delivery and treatment, runtime and voice status");
assert(pv.creative.pronunciationCheckRequired.some((p: any) => p.name === "Adewale" || p.name === "Ogunlesi")); ok("preview lists names that need a pronunciation check before generating");
const g1 = await (await call(pfn, { editionId: E, deliverable: "script_storyboard", durationSeconds: 90 })).json();
assert(g1.saved && g1.version === 1); const row1 = T("edition_prompts")[0];
assert(/^[0-9a-f]{64}$/.test(row1.rationale.creative.config_hash) && row1.rationale.creative.voice.engine && row1.rationale.creative.scenes.length >= 5); ok("a saved prompt records the voice snapshot, scenes and config hash in its history record");
assert(/PRONUNCIATION CHECK REQUIRED/.test(g1.prompt) && /Ogunlesi/.test(g1.prompt) && g1.creative.pronunciationCheckRequired.includes("Ogunlesi")); ok("the uncertain name appears in the prompt and in the reply");
assert(/Voice: Laomedeia/.test(g1.prompt) && /Controls verified for this engine by the editor: none/.test(g1.prompt) && /you confirmed this is available/.test(g1.prompt)); ok("the prompt shows the saved configuration actually used (voice, no verified controls, confirmed tools)");
let hist = await (await get(pfn, "history=1")).json(); assert(hist.prompts[0].current === true); ok("history: current");
await call(cfn, { action: "save-lexicon", entry: { name: "Unrelatedname", status: "PROPOSED", pronunciation: "x" } }); hist = await (await get(pfn, "history=1")).json(); assert(hist.prompts[0].current === true); ok("a lexicon entry for a name this prompt does not use does not invalidate it");
await call(cfn, { action: "save-lexicon", entry: { name: "Ogunlesi", status: "CONFIRMED_HUMAN", pronunciation: "oh-goon-LAY-see", source: "checked with a Nigerian broadcaster guide" } });
hist = await (await get(pfn, "history=1")).json(); assert.equal(hist.prompts[0].current, false); assert(hist.prompts[0].reasons.some((x: string) => /pronunciation entry/.test(x))); ok("confirming a name this prompt uses makes the older prompt NOT current (it is kept as history)");
let one = await (await get(pfn, `id=${g1.id}`)).json(); assert.equal(one.valid, false); assert.equal(one.prompt, null); assert(/kept as history/.test(one.withheld)); assert.equal(T("edition_prompts").length, 1); ok("opening the stale prompt withholds its text, shows why, and deletes nothing");
const g2 = await (await call(pfn, { editionId: E, deliverable: "script_storyboard", durationSeconds: 90, parentId: g1.id })).json();
assert.equal(g2.version, 2); assert(!g2.creative.pronunciationCheckRequired.includes("Ogunlesi") && g2.creative.pronunciationCheckRequired.includes("Adewale") && /oh-goon-LAY-see/.test(g2.prompt)); hist = await (await get(pfn, "history=1")).json(); assert(hist.prompts.find((p: any) => p.version === 2).current === true && hist.prompts.find((p: any) => p.version === 1).current === false); ok("a new version uses the confirmed pronunciation and is current; version 1 stays stale history");
await call(cfn, { action: "save-voice", voice: { ...(await (await get(cfn, "")).json()).voice, voiceName: "Different voice" } });
hist = await (await get(pfn, "history=1")).json(); assert(hist.prompts.every((p: any) => p.current === false) && hist.prompts[0].reasons.some((x: string) => /voice setup/.test(x))); ok("changing the voice makes every earlier prompt not current");
await call(cfn, { action: "save-voice", voice: { ...(await (await get(cfn, "")).json()).voice, voiceName: "Laomedeia" } });
const g3 = await (await call(pfn, { editionId: E, deliverable: "narrated_video", durationSeconds: 120, format: "global_roundup", sound: "minimal", visual: "typographic" })).json();
assert(g3.saved && /No music bed/.test(g3.prompt) && g3.creative.format.key === "global_roundup"); ok("editor options (format, sound, visual) are applied");
const legacy = { id: crypto.randomUUID(), edition_id: E, version: 9, members: [jp, al, rt], members_hash: hashNow(), approval_decision_id: T("edition_decisions")[0].id, rationale: { structure: "news_roundup" }, prompt_text: "x".repeat(300), title: "legacy", structure: "news_roundup", deliverable: "script_storyboard", created_at: new Date(Date.now() + 99999).toISOString() };
T("edition_prompts").push(legacy); hist = await (await get(pfn, "history=1")).json(); assert(hist.prompts.find((p: any) => p.version === 9).current === true); ok("a prompt saved before this feature (no config hash) is left as it was");
decide(al, "rejected"); hist = await (await get(pfn, "history=1")).json(); assert(hist.prompts.every((p: any) => p.current === false)); ok("existing invalidation still works: a rejected member makes prompts not current");
assert.equal((await call(pfn, { editionId: E })).status, 409); ok("and a new prompt is refused while a member is rejected");
console.log("\nALL CREATIVE API CHECKS PASSED");

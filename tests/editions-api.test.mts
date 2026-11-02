// Edition Desk API tests against a simulated Supabase (PostgREST-style). The simulation emulates the migration-004
// triggers; the real SQL is tested separately on a real Postgres (tests/db/migration004.test.mjs).
import assert from "node:assert";

process.env.EDITOR_PASSPHRASE = "blue lantern river 42";
process.env.SESSION_SECRET = "z".repeat(40);
process.env.SUPABASE_URL = "https://abc.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test";
const root = new URL("../netlify/", import.meta.url).pathname;
const session = await import(`${root}lib/session.mts`);
const edFn = (await import(`${root}functions/editions.mts`)).default;
const epFn = (await import(`${root}functions/edition-prompt.mts`)).default;
const { membersKey } = await import(`${root}lib/editions.mts`);
const cookie = session.makeSessionCookie().split(";")[0];
let n = 0; const ok = (m: string) => console.log("PASS " + m); void n;

const UNIQUE: Record<string, string[]> = { edition_developments: ["edition_id", "story_id"], edition_prompts: ["edition_id", "version"] };
let tables: Record<string, any[]> = {}; let failNext: { table: string; method: string; status: number } | null = null; let missing = new Set<string>(); let seq = 0;
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
      if (table === "edition_decisions") item.members_hash = hashOf(item.edition_id);
      if (table === "edition_prompts") {
        const dec = latestOf(T("edition_decisions").filter((d) => d.edition_id === item.edition_id));
        if (dec?.decision !== "approved" || dec.members_hash !== hashOf(item.edition_id) || item.members_hash !== hashOf(item.edition_id)) return new Response("{}", { status: 400 });
        for (const id of T("edition_developments").filter((d) => d.edition_id === item.edition_id).map((d) => d.story_id)) {
          const sd = latestOf(T("editorial_decisions").filter((d) => d.story_id === id)); if (sd && ["rejected", "needs_research"].includes(sd.decision)) return new Response("{}", { status: 400 });
        }
        if (String(item.prompt_text).length > 200000) return new Response("{}", { status: 400 });
        item.approval_decision_id = dec.id;
      }
      const keys = UNIQUE[table] ?? [];
      if (keys.length && rows.find((r) => keys.every((k) => r[k] === item[k]))) return new Response("{}", { status: 409 });
      const row = { id: crypto.randomUUID(), created_at: new Date(Date.now() + seq++).toISOString(), updated_at: new Date().toISOString(), status: table === "editions" ? "draft" : undefined, ...item };
      rows.push(row); created.push(row);
    }
    return prefer.includes("return=representation") ? new Response(JSON.stringify(created), { status: 201 }) : new Response(null, { status: 201 });
  }
  if (m === "DELETE") { tables[table] = rows.filter((r) => !matches(r, p)); return new Response(null, { status: 204 }); }
  if (m === "PATCH") { for (const r of rows.filter((r) => matches(r, p))) Object.assign(r, JSON.parse(init.body), { updated_at: new Date().toISOString() }); return new Response(null, { status: 204 }); }
  return new Response("{}", { status: 405 });
}
globalThis.fetch = (async (input: any, init: any = {}) => { const u = new URL(String(input)); if (u.hostname !== "abc.supabase.co") throw new Error("unexpected fetch " + u); return postgrest(u, init); }) as any;
const call = (fn: any, body: any, c: string | null = cookie) => fn(new Request("https://x/", { method: "POST", headers: { "content-type": "application/json", ...(c ? { cookie: c } : {}) }, body: JSON.stringify(body) }));
const get = (fn: any, q: string, c: string | null = cookie) => fn(new Request("https://x/?" + q, { method: "GET", headers: c ? { cookie: c } : {} }));

// ---------- seed: recent stories with sources ----------
const H = 3600_000; const at = (h: number) => new Date(Date.now() - h * H).toISOString();
const reg = (name: string, official = false) => { let r = T("source_registry").find((x) => x.name === name); if (!r) { r = { id: crypto.randomUUID(), name, country_scope: "Europe · test", reliability_note: official ? "tier:primary" : "" }; T("source_registry").push(r); } return r; };
function story(headline: string, category: string, srcs: [string, string, string, boolean?][]) {
  const st = { id: crypto.randomUUID(), headline, category, created_at: at(2), editorial_status: "pending" }; T("stories").push(st);
  srcs.forEach(([outlet, title, extract, official], i) => {
    const rs = { id: crypto.randomUUID(), registry_id: reg(outlet, !!official).id, title, url: `https://${outlet.toLowerCase().replace(/\W/g, "")}.example/${st.id.slice(0, 6)}/${i}`, published_at: at(5), retrieved_at: at(1), extract };
    T("retrieved_sources").push(rs); T("story_source_links").push({ story_id: st.id, source_id: rs.id });
  });
  return st.id;
}
const jp = story("Japan orders new emergency preparedness plan with stockpiles for families", "Government and institutional decisions", [["Tokyo Gazette", "Japan updates national preparedness and stockpile directive", "Government ministry orders households and local councils to stockpile water and food for disasters.", true], ["Tokyo Times", "Tokyo tightens emergency readiness rules", "Families must keep supplies; shelters and early warning expanded in Japan."]]);
const fi = story("Finland publishes civil defence guide on household resilience and shelters", "Public policy", [["Helsinki Gazette", "Finland issues civil defence guidance for every household", "Agency tells citizens to prepare emergency supplies; shelters and resilience plan updated.", true], ["Helsinki Times", "Finnish residents get preparedness booklet", "Authorities say crisis plan and readiness for disruption has been rewritten in Finland."]]);
const cl = story("Chile launches earthquake early warning and evacuation programme", "Public policy", [["Santiago Gazette", "Chile expands early warning and evacuation drills nationwide", "The government programme improves disaster readiness and shelters in Chile."], ["Santiago Times", "Chile rolls out emergency alert system", "Authorities in Chile say preparedness for earthquakes and tsunami evacuation will be tested."]]);
const rt = story("Central bank in Brazil raises interest rates as inflation climbs", "Business and economic developments", [["Brasilia Gazette", "Brazil raises interest rates to fight inflation", "The central bank decision affects mortgages, prices and wages."], ["Brasilia Times", "Brazilian central bank hikes rate", "Inflation and currency pressure drive the rate rise in Brazil."]]);
const sp = story("Telescope finds exoplanet atmosphere with water signal, researchers say", "Scientific discoveries", [["Canberra Gazette", "Telescope detects water in exoplanet atmosphere", "Astronomers report a new finding from the space telescope."], ["Canberra Times", "Astronomers find water vapour on distant planet", "Researchers say the telescope study is a breakthrough."]]);
const old = story("Spain republishes old earthquake preparedness guide", "Public policy", [["Madrid Gazette", "Spain preparedness guide", "Old"]]); T("retrieved_sources").filter((r) => r.title === "Spain preparedness guide").forEach((r) => (r.published_at = at(24 * 40)));
const decide = (sid: string, decision: string) => T("editorial_decisions").push({ id: crypto.randomUUID(), story_id: sid, decision, decided_by: "ed", created_at: new Date(Date.now() + seq++).toISOString() });

console.log("Edition Desk API");
assert.equal((await get(edFn, "", null)).status, 401); assert.equal((await call(edFn, { action: "save" }, null)).status, 401); assert.equal((await get(epFn, "history=1", null)).status, 401); assert.equal((await call(epFn, { editionId: "x" }, null)).status, 401); ok("edition desk and edition prompt require sign-in");
let d = await (await get(edFn, "")).json();
assert(d.developments.length >= 5 && d.developments.every((x: any) => x.recommendation && x.evidenceStrength && x.curiosityScore >= 0 && x.hypothesisNote)); ok("desk lists developments with curiosity assessment, evidence strength and recommendation");
const prep = d.suggestions.find((s: any) => s.ids.includes(jp) && s.ids.includes(fi)); assert(prep && prep.structure === "multi_country" && prep.coherence.verdict === "COHERENT" && prep.coherence.components.length === 7); ok("a coherent multi-country edition is suggested with transparent coherence components");
assert(!prep.ids.includes(rt) && !prep.ids.includes(sp)); ok("unrelated stories are not forced into the edition");
assert(d.ineligible.some((x: any) => x.id === old && /freshness window/.test(x.reason))); ok("stories outside the freshness window are listed as excluded with a reason");
assert.equal(d.saved.installed, true); assert(/not verified/.test(d.note)); ok("desk states the connection is an inference, not verified");
decide(rt, "rejected"); d = await (await get(edFn, "")).json(); assert(d.ineligible.some((x: any) => x.id === rt && /Rejected/.test(x.reason)) && !d.developments.some((x: any) => x.id === rt)); ok("a story the editor rejected leaves the pool, with the reason shown");

console.log("Coherence check and saving");
const ids3 = [jp, fi, cl];
const ev = await (await get(edFn, `ids=${ids3.join(",")}`)).json(); assert(ev.evaluation.coherence.verdict === "COHERENT" && ev.evaluation.check.belongTogether && ev.evaluation.sequence.length === 3 && ev.developments.length === 3); ok("coherence check answers the required questions for a chosen set");
const mixed = await (await get(edFn, `ids=${jp},${sp}`)).json(); assert(["WEAK", "INCOHERENT"].includes(mixed.evaluation.coherence.verdict)); assert(mixed.evaluation.check.weaklyConnected.length >= 1 || mixed.evaluation.check.recommendations.length >= 1); ok("an unrelated pair is reported as WEAK or INCOHERENT, never silently dropped (still returned in full)");
assert.equal((await get(edFn, "ids=nope")).status, 400); assert.equal((await get(edFn, `ids=${jp},${jp}`)).status, 400); assert.equal((await get(edFn, `ids=${crypto.randomUUID()}`)).status, 404); ok("bad, duplicate and unknown ids are rejected");
const ovr = await (await get(edFn, `ids=${ids3.join(",")}&structure=single_country`)).json(); assert(ovr.evaluation.structureOverride === true && ovr.evaluation.suggestedStructure === "multi_country"); ok("editor's structure override is recorded, with the suggestion kept");
assert.equal((await call(edFn, { action: "save", title: "", ids: ids3 })).status, 400); assert.equal((await call(edFn, { action: "save", title: "x", ids: [] })).status, 400); assert.equal(T("editions").length, 0); ok("empty title or members refused; nothing saved");
const sv = await (await call(edFn, { action: "save", title: "How three places prepare", ids: ids3, angle: "Ask why" })).json(); assert(sv.saved && sv.id); const eid = sv.id;
assert.equal(T("edition_developments").filter((x) => x.edition_id === eid).length, 3); assert.equal(T("editions")[0].coherence.verdict, "COHERENT"); assert(T("audit_events").some((a) => a.event_type === "edition_created" && a.entity_id === eid)); ok("edition saved with ordered members, recorded coherence and an audit event");
const det = await (await get(edFn, `id=${eid}`)).json(); assert.equal(det.ids.length, 3); assert.equal(det.membersKey, membersKey(det.ids)); assert.equal(det.approval.current, false); assert(det.evaluation.coherence); ok("detail shows live evaluation and that it is not approved");

console.log("Approval");
assert.equal((await call(edFn, { action: "decide", id: eid, decision: "approved" })).status, 400); assert.equal(T("edition_decisions").length, 0); ok("approval without acknowledgement is refused");
const weakSv = await (await call(edFn, { action: "save", title: "Mixed bag", ids: [jp, sp] })).json();
assert.equal((await call(edFn, { action: "decide", id: weakSv.id, decision: "approved", acknowledged: true })).status, 400); ok("approving a WEAK/INCOHERENT edition requires a written reason");
assert.equal((await call(edFn, { action: "decide", id: weakSv.id, decision: "approved", acknowledged: true, notes: "Editor accepts the weak link deliberately." })).status, 200); ok("…and is allowed with a reason (the editor decides)");
assert.equal((await call(edFn, { action: "decide", id: eid, decision: "publish", acknowledged: true })).status, 400); assert.equal((await call(edFn, { action: "decide", id: "bad", decision: "approved", acknowledged: true })).status, 400); ok("unknown decision and bad id rejected");
console.log("Edition Prompt Architect");
assert.equal((await call(epFn, { editionId: eid })).status, 409); assert.equal((await get(epFn, `editionId=${eid}`)).status, 409); assert.equal(T("edition_prompts").length, 0); ok("unapproved edition: no prompt and no preview");
decide(jp, "approved"); decide(fi, "approved"); decide(cl, "approved");
assert.equal((await call(edFn, { action: "decide", id: eid, decision: "approved", acknowledged: true, notes: "Reviewed" })).status, 200);
assert.equal(T("edition_decisions").find((x) => x.edition_id === eid).members_hash, membersKey(ids3)); assert(T("audit_events").some((a) => a.event_type === "edition_decision")); ok("approval saved, stamped with the exact member list, audited");
const pv = await (await get(epFn, `editionId=${eid}`)).json(); assert(pv.developments.length === 3 && pv.deliverables.length === 3 && pv.verdict === "COHERENT"); ok("preview lists each development's evidence and saves nothing");
const g1r = await call(epFn, { editionId: eid, deliverable: "script_storyboard", durationSeconds: 90, angle: "Compare the approaches" }); const g1 = await g1r.json();
assert.equal(g1r.status, 200); assert(g1.saved && g1.version === 1); const row1 = T("edition_prompts")[0];
assert.equal(row1.members_hash, membersKey(ids3)); assert.equal(row1.approval_decision_id, T("edition_decisions").find((x) => x.edition_id === eid).id); assert(row1.evidence_hash.length === 64); ok("prompt saved as version 1, tied to the exact members, approval and evidence hash");
const urlJp = T("retrieved_sources").find((r) => T("story_source_links").some((l) => l.story_id === jp && l.source_id === r.id)).url;
assert(g1.prompt.includes(urlJp) && /D1-S1/.test(g1.prompt) && /D2-S1/.test(g1.prompt) && /D3-S1/.test(g1.prompt) && g1.prompt.includes("Compare the approaches") && g1.prompt.includes("THE WORLD, FILED.")); ok("integrated prompt carries each development's real source links, namespaced refs, angle and brand");
assert(row1.evidence_snapshot.developments.length === 3 && row1.evidence_snapshot.developments.every((x: any) => x.pack.sources.every((s: any) => s.snippet.length <= 400 && !("full_text" in s)))); ok("stored evidence: per-development, snippets capped, no full text");
assert(T("audit_events").some((a) => a.event_type === "edition_prompt_created" && a.entity_id === eid)); ok("generation is audited");
const g2 = await (await call(epFn, { editionId: eid, deliverable: "narrated_video", durationSeconds: 120, parentId: g1.id, conflictNotes: ["Sources differ on the date."] })).json(); assert.equal(g2.version, 2); assert(/Sources differ on the date/.test(g2.prompt) && /\[CONFLICTING\]/.test(g2.prompt)); assert.equal(T("edition_prompts")[1].parent_id, g1.id); ok("second version keeps history, links its parent, and carries the editor's conflict note");
assert.equal(T("edition_prompts")[0].prompt_text, g1.prompt); ok("earlier version is preserved unchanged");
const g3 = await (await call(epFn, { editionId: eid, deliverable: "nonsense", durationSeconds: 5000 })).json(); assert.equal(g3.saved, true); ok("unknown options fall back to safe defaults");
let hist = await (await get(epFn, "history=1")).json(); assert(hist.prompts.length === 3 && hist.prompts.every((h: any) => h.current && h.title)); ok("history lists versions, all current");
assert((await (await get(epFn, `id=${g1.id}`)).json()).prompt.includes(urlJp)); ok("a current prompt can be opened and copied");

console.log("Invalidation");
decide(fi, "rejected");
let o = await (await get(epFn, `id=${g1.id}`)).json(); assert.equal(o.prompt, null); assert(/rejected or sent back/.test(o.reasons.join(" "))); assert.equal(T("edition_prompts").length, 3); ok("a member rejected after generation: prompt kept as history, text withheld, reason shown");
hist = await (await get(epFn, "history=1")).json(); assert(hist.prompts.every((h: any) => h.current === false)); ok("history marks them no longer current");
assert.equal((await call(epFn, { editionId: eid })).status, 409); assert.equal(T("edition_prompts").length, 3); ok("no new prompt while a member is rejected");
assert.equal((await call(edFn, { action: "decide", id: eid, decision: "approved", acknowledged: true, notes: "again" })).status, 409); ok("cannot re-approve an edition that contains a rejected development");
decide(fi, "approved");
o = await (await get(epFn, `id=${g1.id}`)).json(); assert(o.prompt && o.valid); ok("once the member is re-approved the same unchanged prompt is valid again (nothing changed in its basis)");
const rsrc = T("retrieved_sources").find((r) => T("story_source_links").some((l) => l.story_id === cl && l.source_id === r.id)); const oldTitle = rsrc.extract; rsrc.extract += " UPDATED: the programme was expanded again.";
o = await (await get(epFn, `id=${g1.id}`)).json(); assert.equal(o.prompt, null); assert.equal(o.validity.evidenceCurrent, false); assert(/evidence/.test(o.reasons.join(" "))); ok("materially updated evidence: the earlier prompt is detected as possibly invalid and withheld");
const g4 = await (await call(epFn, { editionId: eid })).json(); assert(g4.saved && /UPDATED/.test(g4.prompt)); assert((await (await get(epFn, `id=${g4.id}`)).json()).valid); ok("a regenerated prompt reflects the updated evidence and is valid");
rsrc.extract = oldTitle;
const sv2 = await (await call(edFn, { action: "save", id: eid, title: "How three places prepare", ids: [jp, fi] })).json(); assert(sv2.saved && /approve the edition again/i.test(sv2.note ?? "")); assert.equal(T("edition_developments").filter((x) => x.edition_id === eid).length, 2); ok("removing a development is an explicit editor action and warns that approval no longer applies");
const det2 = await (await get(edFn, `id=${eid}`)).json(); assert.equal(det2.approval.current, false); assert.equal(det2.approval.membersChangedSinceApproval, true); ok("approval is shown as no longer current after the member list changed");
assert.equal((await call(epFn, { editionId: eid })).status, 409); assert((await (await call(epFn, { editionId: eid })).json()).error === "members_changed"); ok("no prompt until the changed edition is approved again");
o = await (await get(epFn, `id=${g4.id}`)).json(); assert.equal(o.prompt, null); assert.equal(o.validity.membersCurrent, false); ok("older prompts for the previous member list are withheld");
assert.equal((await call(edFn, { action: "decide", id: eid, decision: "approved", acknowledged: true, notes: "Two stories remain" })).status, 200);
const g5 = await (await call(epFn, { editionId: eid })).json(); assert(g5.saved && T("edition_prompts").at(-1).members.length === 2); ok("after fresh approval a new prompt is written for the new member list");
await call(edFn, { action: "decide", id: eid, decision: "rejected", notes: "No" }); assert.equal((await call(epFn, { editionId: eid })).status, 409); assert.equal((await (await get(epFn, `id=${g5.id}`)).json()).prompt, null); ok("edition rejected: no new prompt, saved ones withheld");

console.log("Failure honesty and NOT INSTALLED");
await call(edFn, { action: "decide", id: eid, decision: "approved", acknowledged: true, notes: "Back" }); const cnt = T("edition_prompts").length;
failNext = { table: "edition_prompts", method: "POST", status: 400 }; const refused = await call(epFn, { editionId: eid }); assert.equal(refused.status, 409); assert.equal(T("edition_prompts").length, cnt); ok("a database refusal is reported honestly and nothing is saved");
failNext = { table: "edition_prompts", method: "POST", status: 500 }; assert.equal((await call(epFn, { editionId: eid })).status, 502); assert.equal(T("edition_prompts").length, cnt); ok("a database failure is never reported as saved");
failNext = { table: "editions", method: "POST", status: 500 }; assert.equal((await call(edFn, { action: "save", title: "t", ids: ids3 })).status, 502); ok("a failed edition save is reported as failed");
missing = new Set(["edition_prompts"]); const uns = await (await call(epFn, { editionId: eid })).json(); assert(uns.saved === false && uns.notInstalled && uns.prompt.length > 1000); assert((await (await get(epFn, "history=1")).json()).notInstalled); missing = new Set(); ok("before migration 004 (prompt table): prompt still works but is clearly marked NOT saved");
missing = new Set(["editions"]); const d2 = await (await get(edFn, "")).json(); assert.equal(d2.saved.installed, false); assert(d2.suggestions.length >= 1); assert.equal((await call(edFn, { action: "save", title: "t", ids: ids3 })).status, 409); missing = new Set(); ok("before migration 004: the desk still suggests editions; saving says NOT INSTALLED and saves nothing");
assert.equal((await get(epFn, "id=zzz")).status, 400); assert.equal((await get(epFn, "editionId=zzz")).status, 400); ok("bad ids rejected");
console.log("\nAll edition API checks passed");

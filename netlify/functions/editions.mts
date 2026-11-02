// Edition Desk API (all routes need the editor session).
//   GET                          desk: developments (with curiosity assessment), suggested editions, weak connections, unmatched, saved editions
//   GET ?ids=a,b,c[&structure=]  coherence check for any chosen set (nothing saved)
//   GET ?id=EID                  one saved edition: members, live evaluation, approval validity, decisions
//   POST {action:"save", id?, title, ids[], structure?, angle?}   create or update an edition (assessment recomputed on the server)
//   POST {action:"decide", id, decision, notes?, acknowledged}    human decision (approval needs acknowledged:true)
//   POST {action:"archive", id}
// Nothing is ever silently removed from a selection: the evaluation reports weak members; only the editor removes them.
import { isAuthenticated } from "../lib/session.mts";
import { db, DbError } from "../lib/db.mts";
import { evaluateEdition, suggestEditions, membersKey, STRUCTURE_LABEL, type Structure, type Dev } from "../lib/editions.mts";
import { loadPool, loadStories, memberIds, latestEditionDecision, latestDecisions, UUID, MAX_MEMBERS } from "../lib/edition-data.mts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const STRUCTS = Object.keys(STRUCTURE_LABEL) as Structure[];

const devSummary = (d: Dev, decision: string | null) => ({
  id: d.id, headline: d.headline, category: d.category, decision,
  type: d.a.typeLabel, recommendation: d.a.recommendation, recommendationWhy: d.a.recommendationWhy,
  curiosityScore: d.a.curiosityScore, evidenceStrength: d.a.evidenceStrength, corroborated: d.a.corroborated,
  whatChanged: d.a.whatChanged, whyInteresting: d.a.whyInteresting, audienceQuestion: d.a.audienceQuestion, surprisingElement: d.a.surprisingElement,
  humanConsequences: d.a.humanConsequences, possibleImplications: d.a.possibleImplications, missingEvidence: d.a.missingEvidence,
  sensationalismFlags: d.a.sensationalismFlags, hypothesisNote: d.a.hypothesisNote,
  themes: d.a.themes.map((t: any) => t.label ?? t.id ?? String(t)), locations: d.a.locations, geographicInterest: d.a.geographicInterest, outlets: d.outlets.size,
});
const evalSummary = (e: ReturnType<typeof evaluateEdition>) => ({ ...e, pairs: e.pairs.map((p) => ({ a: p.a, b: p.b, score: p.score, duplicate: p.duplicate, duplicateWhy: p.duplicateWhy, signals: p.signals })) });

export default async (req: Request) => {
  if (!isAuthenticated(req)) return json({ error: "unauthorized" }, 401);
  try {
    if (req.method === "GET") {
      const u = new URL(req.url);
      if (u.searchParams.get("ids")) return await evaluate(u);
      if (u.searchParams.get("id")) return await detail(u.searchParams.get("id")!);
      return await desk();
    }
    if (req.method === "POST") {
      let b: any;
      try { b = JSON.parse(await req.text()); } catch { return json({ error: "bad_request" }, 400); }
      if (b.action === "save") return await save(b);
      if (b.action === "decide") return await decide(b);
      if (b.action === "archive") return await archive(b);
      return json({ error: "bad_request" }, 400);
    }
    return json({ error: "method_not_allowed" }, 405);
  } catch (e) {
    if (e instanceof DbError) return json({ error: "database", detail: e.message }, e.status);
    return json({ error: "server_error" }, 500);
  }
};

async function savedEditions() {
  try {
    const rows = await db<any[]>("editions?status=eq.draft&select=id,title,theme,structure,coherence,created_at,updated_at&order=updated_at.desc&limit=40");
    const out = [];
    for (const r of rows) {
      const dec = await latestEditionDecision(r.id);
      const ids = await memberIds(r.id);
      out.push({ id: r.id, title: r.title, theme: r.theme, structure: r.structure, structureLabel: STRUCTURE_LABEL[r.structure as Structure] ?? r.structure, verdict: r.coherence?.verdict ?? null, score: r.coherence?.score ?? null, members: ids.length, updatedAt: r.updated_at, decision: dec?.decision ?? null, approvalCurrent: dec?.decision === "approved" && dec.members_hash === membersKey(ids) });
    }
    return { installed: true, editions: out };
  } catch (e) {
    if (e instanceof DbError && e.upstream === 404) return { installed: false, editions: [] };
    throw e;
  }
}

async function desk() {
  const now = Date.now();
  const { pool, skipped, decisions } = await loadPool(now);
  const sug = suggestEditions(pool.map((l) => l.dev), { now });
  const stripped = (s: any) => ({ ...evalSummary(s), key: s.key, rank: s.rank, excluded: s.excluded });
  const saved = await savedEditions();
  return json({
    generatedAt: new Date(now).toISOString(),
    note: "Suggestions use fixed, visible rules on headlines and feed snippets only. The connection between developments is an editorial inference for you to judge; it is not verified.",
    developments: pool.map((l) => devSummary(l.dev, decisions.get(l.dev.id)?.decision ?? null)).sort((a, b) => b.curiosityScore - a.curiosityScore),
    suggestions: sug.editions.map(stripped),
    weakConnections: sug.weakConnections.map(stripped),
    unmatched: sug.unmatched,
    ineligible: [...sug.ineligible, ...skipped],
    saved,
  });
}

function parseIds(raw: string): string[] | null {
  const ids = raw.split(",").map((x) => x.trim()).filter(Boolean);
  if (!ids.length || ids.length > MAX_MEMBERS || ids.some((i) => !UUID.test(i)) || new Set(ids).size !== ids.length) return null;
  return ids;
}

async function evaluateIds(ids: string[], structure?: string, conflictNotes: string[] = []) {
  const loaded = await loadStories(ids);
  const missing = ids.filter((i) => !loaded.has(i));
  if (missing.length) return { missing };
  const ev = evaluateEdition(ids.map((i) => loaded.get(i)!.dev), { conflictNotes, now: Date.now() });
  // The editor may override the suggested structure; the override is recorded, never hidden.
  const override = structure && STRUCTS.includes(structure as Structure) && structure !== ev.structure ? (structure as Structure) : null;
  const out: any = evalSummary(ev);
  if (override) { out.suggestedStructure = ev.structure; out.structure = override; out.structureLabel = STRUCTURE_LABEL[override]; out.structureOverride = true; }
  return { ev, out, loaded };
}

async function evaluate(u: URL) {
  const ids = parseIds(u.searchParams.get("ids")!);
  if (!ids) return json({ error: "bad_request" }, 400);
  const r = await evaluateIds(ids, u.searchParams.get("structure") ?? undefined);
  if ("missing" in r) return json({ error: "not_found", detail: "Some developments are no longer available.", missing: r.missing }, 404);
  const decs = await latestDecisions(ids);
  return json({ evaluation: r.out, developments: ids.map((i) => devSummary(r.loaded.get(i)!.dev, decs.get(i)?.decision ?? null)) });
}

async function detail(id: string) {
  if (!UUID.test(id)) return json({ error: "bad_request" }, 400);
  const rows = await db<any[]>(`editions?id=eq.${id}&select=*`);
  const e = rows[0];
  if (!e) return json({ error: "not_found" }, 404);
  const ids = await memberIds(id);
  const dec = await latestEditionDecision(id);
  const decisions = await db<any[]>(`edition_decisions?edition_id=eq.${id}&select=id,decision,notes,decided_by,created_at,members_hash&order=created_at.desc,id.desc&limit=20`);
  const r = await evaluateIds(ids, e.structure);
  const memberDecs = await latestDecisions(ids);
  const blocked = ids.filter((i) => ["rejected", "needs_research"].includes(memberDecs.get(i)?.decision ?? ""));
  return json({
    id, title: e.title, theme: e.theme, structure: e.structure, structureLabel: STRUCTURE_LABEL[e.structure as Structure], angle: e.narrative_angle, status: e.status,
    ids, membersKey: membersKey(ids), updatedAt: e.updated_at,
    approval: { decision: dec?.decision ?? null, notes: dec?.notes ?? null, decidedAt: dec?.created_at ?? null, current: dec?.decision === "approved" && dec.members_hash === membersKey(ids) && blocked.length === 0, membersChangedSinceApproval: dec?.decision === "approved" && dec.members_hash !== membersKey(ids), blockedMembers: blocked },
    decisions,
    evaluation: "out" in r ? r.out : null,
    developments: "loaded" in r ? ids.map((i) => devSummary(r.loaded.get(i)!.dev, memberDecs.get(i)?.decision ?? null)) : [],
    missing: "missing" in r ? r.missing : [],
    savedAssessment: { coherence: e.coherence, curiosity: e.curiosity },
  });
}

async function save(b: any) {
  const ids = Array.isArray(b.ids) ? parseIds(b.ids.map(String).join(",")) : null;
  const title = typeof b.title === "string" ? b.title.trim().slice(0, 300) : "";
  if (!ids || !title) return json({ error: "bad_request", detail: "A title and 1 to 12 distinct developments are required." }, 400);
  const id = typeof b.id === "string" && UUID.test(b.id) ? b.id : null;
  const angle = typeof b.angle === "string" ? b.angle.trim().slice(0, 1000) : "";
  const r = await evaluateIds(ids, typeof b.structure === "string" ? b.structure : undefined);
  if ("missing" in r) return json({ error: "not_found", detail: "Some developments are no longer available.", missing: r.missing }, 404);
  const structure = r.out.structure as Structure;
  const coherence = { score: r.ev.coherence.score, verdict: r.ev.coherence.verdict, components: r.ev.coherence.components, structureOverride: !!r.out.structureOverride, suggestedStructure: r.ev.structure, weak: r.ev.check.weaklyConnected, evaluatedAt: new Date().toISOString() };
  const curiosity = { ...r.ev.metrics, theme: r.ev.theme, hypothesis: "Editorial hypothesis, not measured audience behaviour." };
  const body = { title, theme: r.ev.theme, structure, narrative_angle: angle, coherence, curiosity };
  let eid = id;
  try {
    if (eid) {
      const exists = await db<any[]>(`editions?id=eq.${eid}&select=id`);
      if (!exists[0]) return json({ error: "not_found" }, 404);
      await db(`editions?id=eq.${eid}`, { method: "PATCH", prefer: "return=minimal", body });
      const old = await memberIds(eid);
      if (membersKey(old) !== membersKey(ids)) await db(`edition_developments?edition_id=eq.${eid}`, { method: "DELETE", prefer: "return=minimal" });
      if (membersKey(old) !== membersKey(ids)) await db("edition_developments", { method: "POST", prefer: "return=minimal", body: ids.map((s, i) => ({ edition_id: eid, story_id: s, position: i + 1 })) });
    } else {
      const rows = await db<any[]>("editions", { method: "POST", prefer: "return=representation", body: { ...body, created_by: "editor" } });
      eid = (Array.isArray(rows) ? rows[0] : rows).id;
      await db("edition_developments", { method: "POST", prefer: "return=minimal", body: ids.map((s, i) => ({ edition_id: eid, story_id: s, position: i + 1 })) });
    }
  } catch (e) {
    if (e instanceof DbError && e.upstream === 404) return json({ error: "not_installed", detail: "Editions are not installed yet (migration 004). Nothing was saved." }, 409);
    throw e;
  }
  await db("audit_events", { method: "POST", prefer: "return=minimal", body: { event_type: id ? "edition_updated" : "edition_created", entity_type: "edition", entity_id: eid, actor: "editor", detail: { members: ids.length, structure, verdict: coherence.verdict, structure_override: coherence.structureOverride } } });
  return json({ saved: true, id: eid, membersKey: membersKey(ids), verdict: coherence.verdict, note: id && !!(await latestEditionDecision(eid!)) ? "If you changed the developments, any earlier approval no longer applies; approve the edition again." : undefined });
}

async function decide(b: any) {
  const id = String(b.id ?? "");
  if (!UUID.test(id)) return json({ error: "bad_request" }, 400);
  const decision = String(b.decision ?? "");
  if (!["approved", "rejected", "needs_changes"].includes(decision)) return json({ error: "bad_request" }, 400);
  const notes = typeof b.notes === "string" ? b.notes.trim().slice(0, 2000) : "";
  const rows = await db<any[]>(`editions?id=eq.${id}&select=id,coherence`);
  if (!rows[0]) return json({ error: "not_found" }, 404);
  const ids = await memberIds(id);
  if (decision === "approved") {
    if (b.acknowledged !== true) return json({ error: "acknowledgement_required", detail: "Approval needs you to confirm you reviewed the coherence check." }, 400);
    const r = await evaluateIds(ids);
    if ("missing" in r) return json({ error: "not_found", detail: "A development is no longer available.", missing: r.missing }, 404);
    const verdict = r.ev.coherence.verdict;
    if (verdict !== "COHERENT" && verdict !== "SINGLE DEVELOPMENT" && notes.length < 10) return json({ error: "reason_required", detail: `The coherence check says ${verdict}. Write a short reason (at least 10 characters) to approve it anyway.` }, 400);
    const memberDecs = await latestDecisions(ids);
    const blocked = ids.filter((i) => ["rejected", "needs_research"].includes(memberDecs.get(i)?.decision ?? ""));
    if (blocked.length) return json({ error: "member_blocked", detail: "A development in this edition was rejected or sent back for research. Remove it or re-approve it first.", blocked }, 409);
  }
  try {
    await db("edition_decisions", { method: "POST", prefer: "return=minimal", body: { edition_id: id, decision, decided_by: "editor", notes: notes || null } });
  } catch (e) {
    if (e instanceof DbError && e.upstream === 404) return json({ error: "not_installed", detail: "Editions are not installed yet (migration 004)." }, 409);
    throw e;
  }
  await db("audit_events", { method: "POST", prefer: "return=minimal", body: { event_type: "edition_decision", entity_type: "edition", entity_id: id, actor: "editor", detail: { decision, members_key: membersKey(ids), acknowledged: decision === "approved" } } });
  return json({ saved: true, decision, membersKey: membersKey(ids) });
}

async function archive(b: any) {
  const id = String(b.id ?? "");
  if (!UUID.test(id)) return json({ error: "bad_request" }, 400);
  await db(`editions?id=eq.${id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "archived" } });
  await db("audit_events", { method: "POST", prefer: "return=minimal", body: { event_type: "edition_archived", entity_type: "edition", entity_id: id, actor: "editor", detail: {} } });
  return json({ archived: true });
}

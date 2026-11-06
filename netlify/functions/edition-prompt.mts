// Edition Prompt Architect API: ONE integrated Claude production prompt for an approved edition.
//   GET  ?editionId=ID    readiness preview (nothing saved)
//   POST {editionId,...}  generate and save as the next version in the edition's prompt history
//   GET  ?history=1       saved edition prompts (no text) with validity
//   GET  ?id=ID           one saved prompt; the text is withheld if it is no longer valid (history is kept)
// Gates: this function checks approval, member list, member decisions; the database trigger checks them again at insert time.
import { isAuthenticated } from "../lib/session.mts";
import { db, DbError } from "../lib/db.mts";
import { buildEditionPrompt, EditionPromptTooLarge, MAX_EDITION_PROMPT_CHARS } from "../lib/edition-prompt.mts";
import { buildTextEditionPrompt } from "../lib/text-edition-prompt.mts";
import { evaluateEdition, membersKey, STRUCTURE_LABEL, type Structure } from "../lib/editions.mts";
import { DELIVERABLES, type Deliverable } from "../lib/production-tools.mts";
import { PackTooLarge, classCounts } from "../lib/evidence-pack.mts";
import { BRAND_VERSION, brandChecklist } from "../lib/brand.mts";
import type { StyleRuleIn } from "../lib/prompt-architect.mts";
import { loadCreative } from "../lib/creative-data.mts";
import { FORMATS, configHash, approvalState, selectFormat, type SoundOpt } from "../lib/presenter.mts";
import { buildBlueprint } from "../lib/blueprint.mts";
import { UUID, loadStories, memberIds, latestEditionDecision, latestDecisions, packsFor, promptValidity } from "../lib/edition-data.mts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

const FORMAT_KEYS = Object.keys(FORMATS);
const opts = (src: { format?: unknown; sound?: unknown; visual?: unknown; durationSeconds?: unknown }) => ({
  format: typeof src.format === "string" && FORMAT_KEYS.includes(src.format) ? src.format : null,
  sound: (src.sound === "minimal" ? "minimal" : "subtle") as SoundOpt,
  visual: (src.visual === "typographic" ? "typographic" : "adaptive") as "adaptive" | "typographic",
});
/** A saved prompt is stale if the voice setup, tool confirmations or the pronunciation entries for ITS names changed after it was written. Prompts saved before this feature carry no hash and are left as they were. */
async function creativeStale(r: any): Promise<string | null> {
  const h = r.rationale?.creative?.config_hash; if (!h) return null;
  const { settings, lex } = await loadCreative();
  return configHash(settings, r.rationale.creative.names ?? [], lex) === h ? null : "The presenter or voice setup, the tool confirmations or a pronunciation entry used by this prompt changed after it was written.";
}

async function approvedRules(): Promise<{ rules: StyleRuleIn[]; installed: boolean }> {
  try {
    const rows = await db<any[]>("style_rules?status=eq.APPROVED&select=rule_key,version,category,statement&order=version.desc");
    const best = new Map<string, StyleRuleIn>();
    for (const r of rows) if (!best.has(r.rule_key)) best.set(r.rule_key, r);
    return { rules: [...best.values()], installed: true };
  } catch (e) {
    if (e instanceof DbError && e.upstream === 404) return { rules: [], installed: false };
    throw e;
  }
}

export default async (req: Request) => {
  if (!isAuthenticated(req)) return json({ error: "unauthorized" }, 401);
  try {
    const u = new URL(req.url);
    if (req.method === "GET") {
      if (u.searchParams.get("history")) return await history();
      const id = u.searchParams.get("id");
      if (id) return await one(id);
      const eid = u.searchParams.get("editionId");
      if (!eid || !UUID.test(eid)) return json({ error: "bad_request" }, 400);
      return await preview(eid, req);
    }
    if (req.method === "POST") return await generate(req);
    return json({ error: "method_not_allowed" }, 405);
  } catch (e) {
    if (e instanceof DbError) return json({ error: "database", detail: e.message }, e.status);
    if (e instanceof PackTooLarge || e instanceof EditionPromptTooLarge) return json({ error: "too_large", detail: (e as Error).message }, 413);
    return json({ error: "server_error" }, 500);
  }
};

/** Everything that must be true before a prompt may be written. Returns a reason string if not. */
async function readiness(editionId: string) {
  const rows = await db<any[]>(`editions?id=eq.${editionId}&select=id,title,structure,narrative_angle,edition_kind`);
  const ed = rows[0];
  if (!ed) return { fail: json({ error: "not_found" }, 404) };
  const ids = await memberIds(editionId);
  if (!ids.length) return { fail: json({ error: "empty_edition", detail: "This edition has no developments." }, 409) };
  const dec = await latestEditionDecision(editionId);
  if (dec?.decision !== "approved") return { fail: json({ error: "not_approved", detail: "The edition has no current human approval." }, 409) };
  if (dec.members_hash !== membersKey(ids)) return { fail: json({ error: "members_changed", detail: "The developments changed after approval. Approve the edition again." }, 409) };
  const decs = await latestDecisions(ids);
  const blocked = ids.filter((i) => ["rejected", "needs_research"].includes(decs.get(i)?.decision ?? ""));
  if (blocked.length) return { fail: json({ error: "member_blocked", detail: "A development in this edition was rejected or sent back for research.", blocked }, 409) };
  const loaded = await loadStories(ids);
  const missing = ids.filter((i) => !loaded.has(i));
  if (missing.length) return { fail: json({ error: "not_found", detail: "A development is no longer available.", missing }, 404) };
  return { ed, ids, dec, loaded };
}

async function preview(editionId: string, req: Request) {
  const r = await readiness(editionId);
  if ("fail" in r) return r.fail;
  const ev = evaluateEdition(r.ids.map((i) => r.loaded.get(i)!.dev), { now: Date.now(), structure: r.ed.structure as Structure });
  const members = packsFor(r.ids, r.loaded);
  if (r.ed.edition_kind === "text") return json({ editionId, editionKind: "text", title: r.ed.title, structure: r.ed.structure, structureLabel: STRUCTURE_LABEL[r.ed.structure as Structure], developments: members.map((m, i) => ({ ref: "D" + (i + 1), headline: m.dev.headline, sources: m.pack.sources.length, omitted: m.pack.omitted_sources.count, classes: classCounts(m.pack) })), textBriefing: { targetWords: "1500-2200", targetReadMinutes: "5-8", targetStories: "12-18", note: "Editorial targets, never quotas. Use fewer stories or words when the evidence does not support more." }, deliverables: [{ key: "text_briefing", label: "Written daily news briefing" }], maxPromptChars: MAX_EDITION_PROMPT_CHARS });
  const u = new URL(req.url); const secs = ([60, 90, 120] as const).includes(Number(u.searchParams.get("durationSeconds")) as any) ? (Number(u.searchParams.get("durationSeconds")) as 60 | 90 | 120) : 90;
  const o = opts({ format: u.searchParams.get("format"), sound: u.searchParams.get("sound"), visual: u.searchParams.get("visual") });
  const cr = await loadCreative(); const format = selectFormat(ev, members, o.format);
  const bp = buildBlueprint({ members, ev, secs, format, voice: cr.settings.voice, lex: cr.lex, toolsConfirmed: cr.settings.toolsConfirmed, sound: o.sound, visualMode: o.visual, deliverable: "script_storyboard", now: Date.now() });
  return json({
    creative: {
      format: { key: format.key, label: format.label, why: format.why, overridden: format.overridden }, formats: Object.entries(FORMATS).map(([k, v]) => ({ key: k, label: v.label, description: v.description })),
      voice: { engine: cr.settings.voice.engine, voice: cr.settings.voice.voiceName, status: cr.settings.voice.status, approval: approvalState(cr.settings.voice), licence: cr.settings.voice.licence.status, configured: cr.configured },
      runtime: { total: bp.allocation.total, ceiling: secs, shorter: bp.allocation.shorterThanCeiling, warnings: bp.allocation.warnings, words: bp.totalWords },
      scenes: bp.scenes.map((x) => ({ n: x.n, kind: x.kind, ref: x.devRef, title: x.title, seconds: x.seconds, delivery: x.delivery.label, pace: `${x.delivery.paceLo} to ${x.delivery.paceHi}`, composition: x.visual.compositionId, treatment: x.visual.treatment, intensity: x.intensity, tier: x.tier })),
      pronunciationCheckRequired: bp.pronunciation.filter((p) => p.state === "CHECK_REQUIRED").map((p) => ({ name: p.name, note: p.note })),
    },
    editionId, title: r.ed.title, structure: r.ed.structure, structureLabel: STRUCTURE_LABEL[r.ed.structure as Structure],
    verdict: ev.coherence.verdict, score: ev.coherence.score, mapUseful: ev.check.mapUseful, mapWhy: ev.check.mapWhy,
    developments: members.map((m, i) => ({ ref: `D${i + 1}`, headline: m.dev.headline, sources: m.pack.sources.length, omitted: m.pack.omitted_sources.count, classes: classCounts(m.pack) })),
    deliverables: DELIVERABLES.map((d) => ({ key: d.key, label: d.label })),
    maxPromptChars: MAX_EDITION_PROMPT_CHARS,
  });
}

async function generate(req: Request) {
  let b: any;
  try { b = JSON.parse(await req.text()); } catch { return json({ error: "bad_request" }, 400); }
  const editionId = String(b.editionId ?? "");
  if (!UUID.test(editionId)) return json({ error: "bad_request" }, 400);
  const deliverable = DELIVERABLES.some((d) => d.key === b.deliverable) ? (b.deliverable as Deliverable) : "script_storyboard";
  const duration = ([60, 90, 120] as const).includes(b.durationSeconds) ? (b.durationSeconds as 60 | 90 | 120) : 90;
  const parentId = typeof b.parentId === "string" && UUID.test(b.parentId) ? b.parentId : null;
  const r = await readiness(editionId);
  if ("fail" in r) return r.fail;
  const notes = Array.isArray(b.conflictNotes) ? b.conflictNotes.map((x: unknown) => (typeof x === "string" ? x : "")).slice(0, r.ids.length) : [];
  const members = packsFor(r.ids, r.loaded, notes);
  const structure = r.ed.structure as Structure;
  const evaluation = evaluateEdition(members.map((m) => m.dev), { conflictNotes: notes.filter(Boolean), now: Date.now(), structure });
  const ev = evaluation;
  const { rules, installed: rulesInstalled } = await approvedRules();
  const cr = await loadCreative(); const o = opts(b);
  const out = r.ed.edition_kind === "text"
    ? buildTextEditionPrompt({ title: r.ed.title, members, evaluation, angle: typeof b.angle === "string" && b.angle.trim() ? b.angle : r.ed.narrative_angle ?? "", conflictNotes: notes.filter(Boolean), approvedRules: rules })
    : buildEditionPrompt({
        title: r.ed.title, members, evaluation, deliverable, durationSeconds: duration,
        angle: typeof b.angle === "string" && b.angle.trim() ? b.angle : r.ed.narrative_angle ?? "",
        conflictNotes: notes.filter(Boolean), approvedRules: rules,
        creative: { voice: cr.settings.voice, toolsConfirmed: cr.settings.toolsConfirmed, lex: cr.lex, format: o.format, sound: o.sound, visual: o.visual },
      });
  const reply = {
    structure: { key: structure, label: STRUCTURE_LABEL[structure] },
    coherence: { verdict: ev.coherence.verdict, score: ev.coherence.score },
    roles: out.roles, rationale: out.rationale, tools: out.tools,
    evidenceClasses: members.map((m, i) => ({ ref: `D${i + 1}`, ...classCounts(m.pack) })),
    brandChecklist: brandChecklist(), brandVersion: BRAND_VERSION, prompt: out.prompt,
    creative: r.ed.edition_kind === "text" ? null : { format: (out as any).format, runtime: (out.rationale as any).creative.runtime, voiceApproval: approvalState(cr.settings.voice), pronunciationCheckRequired: (out.rationale as any).creative.pronunciation_check_required, voiceConfigured: cr.configured },
  };
  let version = 1;
  try {
    const last = await db<any[]>(`edition_prompts?edition_id=eq.${editionId}&select=version&order=version.desc&limit=1`);
    version = (last[0]?.version ?? 0) + 1;
  } catch (e) {
    if (e instanceof DbError && e.upstream === 404) return json({ ...reply, saved: false, notInstalled: true, note: "Edition Prompt History is not installed yet (migration 004). This prompt was NOT saved." });
    throw e;
  }
  if (version > 50) return json({ error: "version_limit", detail: "This edition already has 50 saved prompt versions." }, 409);
  try {
    const rows = await db<any[]>("edition_prompts", {
      method: "POST", prefer: "return=representation",
      body: {
        edition_id: editionId, edition_kind: r.ed.edition_kind ?? "video", version, parent_id: parentId, members: r.ids, members_hash: membersKey(r.ids), evidence_hash: out.evidenceHash,
        structure, title: r.ed.title, deliverable, roles: out.roles, rationale: out.rationale, coherence: { score: ev.coherence.score, verdict: ev.coherence.verdict, components: ev.coherence.components },
        tools: out.tools, evidence_snapshot: out.snapshot, style_rule_ids: [], brand_spec_version: BRAND_VERSION, prompt_text: out.prompt, created_by: "editor",
      },
    });
    const saved = Array.isArray(rows) ? rows[0] : rows;
    await db("audit_events", { method: "POST", prefer: "return=minimal", body: { event_type: "edition_prompt_created", entity_type: "edition", entity_id: editionId, actor: "editor", detail: { version, edition_kind: r.ed.edition_kind ?? "video", structure, deliverable, developments: r.ids.length, prompt_id: saved?.id ?? null, approved_style_rules: rules.length, rules_installed: rulesInstalled } } });
    return json({ ...reply, saved: true, id: saved?.id ?? null, version });
  } catch (e) {
    if (e instanceof DbError && e.upstream === 400) return json({ error: "refused_by_database", detail: "The database refused this record (an approval is no longer current, the members changed, or a size limit was exceeded). Nothing was saved." }, 409);
    if (e instanceof DbError && e.upstream === 409) return json({ error: "version_conflict", detail: "Another prompt was saved at the same moment. Please try again." }, 409);
    throw e;
  }
}

async function history() {
  let rows: any[];
  try {
    rows = await db<any[]>("edition_prompts?select=id,edition_id,edition_kind,version,structure,title,deliverable,members,members_hash,approval_decision_id,rationale,created_at&order=created_at.desc&limit=40");
  } catch (e) {
    if (e instanceof DbError && e.upstream === 404) return json({ notInstalled: true, prompts: [] });
    throw e;
  }
  const out = [];
  for (const r of rows) {
    const v = await promptValidity(r, Date.now(), false);
    // history list checks approval, members and member decisions only (cheap); the full evidence check runs when a prompt is opened
    const stale = await creativeStale(r);
    out.push({ id: r.id, editionId: r.edition_id, title: r.title, editionKind: r.edition_kind ?? "video", version: r.version, structure: r.structure, deliverable: r.deliverable, developments: (r.members ?? []).length, createdAt: r.created_at, current: v.approvalCurrent && v.membersCurrent && v.storiesOk && !stale, reasons: stale ? [...v.reasons, stale] : v.reasons });
  }
  return json({ prompts: out });
}

async function one(id: string) {
  if (!UUID.test(id)) return json({ error: "bad_request" }, 400);
  const rows = await db<any[]>(`edition_prompts?id=eq.${id}&select=*`);
  const r = rows[0];
  if (!r) return json({ error: "not_found" }, 404);
  const v0 = await promptValidity(r, Date.now());
  const stale = await creativeStale(r);
  const v = stale ? { ...v0, current: false, reasons: [...v0.reasons, stale] } : v0;
  return json({
    id: r.id, editionId: r.edition_id, title: r.title, editionKind: r.edition_kind ?? "video", version: r.version, structure: r.structure, deliverable: r.deliverable, createdAt: r.created_at, brandVersion: r.brand_spec_version,
    developments: (r.members ?? []).length, coherence: r.coherence, roles: r.roles, rationale: r.rationale, tools: r.tools,
    valid: v.current, validity: { approvalCurrent: v.approvalCurrent, membersCurrent: v.membersCurrent, storiesOk: v.storiesOk, evidenceCurrent: v.evidenceCurrent }, reasons: v.reasons,
    prompt: v.current ? r.prompt_text : null,
    withheld: v.current ? undefined : "This prompt may no longer be valid and is kept as history only: " + v.reasons.join(" ") + " Re-approve or adjust the edition and generate a new version.",
  });
}

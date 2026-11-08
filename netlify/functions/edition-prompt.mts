// Edition Prompt Architect API: ONE integrated Claude production prompt for an approved edition.
//   GET  ?editionId=ID    readiness preview (nothing saved)
//   POST {editionId,...}  generate and save as the next version in the edition's prompt history
//   GET  ?history=1       saved edition prompts (no text) with validity
//   GET  ?id=ID           one saved prompt; the text is withheld if it is no longer valid (history is kept)
// Gates: approval, member list, member decisions and current claim clearance are checked before prompt use or generation; the database trigger rechecks approval and membership at insert time.
import { hasSameOrigin, isAuthenticated } from "../lib/session.mts";
import { db, DbError } from "../lib/db.mts";
import { buildEditionPrompt, EditionPromptTooLarge, MAX_EDITION_PROMPT_CHARS } from "../lib/edition-prompt.mts";
import { buildTextEditionPrompt } from "../lib/text-edition-prompt.mts";
import { buildVerificationBrief, VerificationBriefTooLarge } from "../lib/verification-brief.mts";
import { evaluateEdition, membersKey, STRUCTURE_LABEL, type Structure } from "../lib/editions.mts";
import { DELIVERABLES, type Deliverable } from "../lib/production-tools.mts";
import { PackTooLarge, classCounts } from "../lib/evidence-pack.mts";
import { BRAND_VERSION, brandChecklist } from "../lib/brand.mts";
import type { StyleRuleIn } from "../lib/prompt-architect.mts";
import { loadCreative } from "../lib/creative-data.mts";
import { FORMATS, configHash, approvalState, selectFormat, type SoundOpt } from "../lib/presenter.mts";
import { buildBlueprint } from "../lib/blueprint.mts";
import { UUID, MAX_MEMBERS, loadStories, memberIds, latestEditionDecision, latestDecisions, editionClaimClearance, editionClaimClearanceByStory, packsFor, promptValidity } from "../lib/edition-data.mts";

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
  if (req.method === "POST" && !hasSameOrigin(req)) return json({ error: "origin_mismatch" }, 403);
  try {
    const u = new URL(req.url);
    if (req.method === "GET") {
      if (u.searchParams.get("history")) return await history();
      const id = u.searchParams.get("id");
      if (id) return await one(id);
      const mode = u.searchParams.get("mode");
      if (mode === "verification_brief") {
        const ids = parseStoryIds(u.searchParams.get("ids"));
        if (!ids) return json({ error: "bad_request", detail: "Choose 1 to 18 distinct research developments." }, 400);
        return await createVerificationBrief(ids, u.searchParams.get("title") ?? "", u.searchParams.get("angle") ?? "", []);
      }
      if (mode === "workflow_status") {
        const statusId = u.searchParams.get("editionId");
        if (!statusId || !UUID.test(statusId)) return json({ error: "bad_request" }, 400);
        return await workflowStatus(statusId);
      }
      const eid = u.searchParams.get("editionId");
      if (!eid || !UUID.test(eid)) return json({ error: "bad_request" }, 400);
      return await preview(eid, req);
    }
    if (req.method === "POST") return await generate(req);
    return json({ error: "method_not_allowed" }, 405);
  } catch (e) {
    if (e instanceof DbError) return json({ error: "database", detail: e.message }, e.status);
    if (e instanceof PackTooLarge || e instanceof EditionPromptTooLarge || e instanceof VerificationBriefTooLarge) return json({ error: "too_large", detail: (e as Error).message }, 413);
    console.error("Edition Prompt API failure", e instanceof Error ? { name: e.name, message: e.message } : "unknown error");
    return json({ error: "server_error" }, 500);
  }
};

const STRICT_STORY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseStoryIds(raw: unknown): string[] | null {
  const ids = Array.isArray(raw) ? raw.map((x) => typeof x === "string" ? x.trim() : "") :
    typeof raw === "string" ? raw.split(",").map((x) => x.trim()) : [];
  if (!ids.length || ids.length > MAX_MEMBERS || ids.some((id) => !STRICT_STORY_UUID.test(id)) || new Set(ids).size !== ids.length) return null;
  return ids;
}

/** Research-only brief. Does not require an editorial decision or factual clearance and is never saved to prompt history. */
async function createVerificationBrief(ids: string[], title: string, angle: string, conflictNotes: string[]) {
  // Internal research may inspect historical source leads even when current feed health is poor.
  // Those records are labelled with their status in the prompt; they are never used for production.
  const loaded = await loadStories(ids, Date.now(), true);
  const missing = ids.filter((id) => !loaded.has(id));
  if (missing.length) return json({
    error: "research_material_unavailable",
    detail: "One or more selected developments no longer have retrievable source links. Refresh the research results before preparing a verification brief.",
    missing,
  }, 409);
  const members = packsFor(ids, loaded, conflictNotes);
  const out = buildVerificationBrief({ title, angle, members });
  return json({
    kind: "verification_brief",
    saved: false,
    publicNewsOutput: false,
    storyCount: out.storyCount,
    sourceCount: out.sourceCount,
    directoryReviewedOn: out.directoryReviewedOn,
    note: "Internal verification assignment only. This is not a news draft, report, script or publication approval. Nothing was saved.",
    prompt: out.prompt,
  });
}

/** Reports both independent gates so the UI can explain the next action before production is attempted. */
async function workflowStatus(editionId: string) {
  const rows = await db<any[]>(`editions?id=eq.${editionId}&select=id,title,edition_kind`);
  const ed = rows[0];
  if (!ed) return json({ error: "not_found" }, 404);
  const ids = await memberIds(editionId);
  if (!ids.length) return json({
    editionId, storyEditorialReview: { ready: false, awaitingApproval: [], rejectedOrReturned: [] }, editorialApproval: { current: false }, factualVerification: { ready: false, blocked: [{ reason: "The edition has no selected developments." }] },
    verifiedClaimsByStory: {}, verificationBriefAllowed: false, productionPromptAllowed: false, blockers: ["Select at least one development."],
  });
  const decision = await latestEditionDecision(editionId);
  const decisions = await latestDecisions(ids);
  const blockedMembers = ids.filter((id) => ["rejected", "needs_research"].includes(decisions.get(id)?.decision ?? ""));
  const awaitingStoryApproval = ids.filter((id) => decisions.get(id)?.decision !== "approved");
  const editionApprovalCurrent = decision?.decision === "approved" && decision.members_hash === membersKey(ids);
  const loaded = await loadStories(ids);
  const missingStories = ids.filter((id) => !loaded.has(id));
  let factual = { ready: false, blocked: [] as { storyId?: string; claimId?: string; reason: string }[] };
  try {
    factual = await editionClaimClearance(ids);
  } catch (error) {
    factual = { ready: false, blocked: [{ reason: error instanceof DbError && error.upstream === 404
      ? "Claim-verification tables are not installed. Evidence clearance cannot be confirmed."
      : "The current claim-verification state could not be loaded. Production must remain blocked." }] };
  }
  const verifiedClaimsByStory = Object.fromEntries(ids.map((storyId) => {
    const story = loaded.get(storyId);
    const claims = story?.verificationStatus === "verified"
      ? (story.claimRegister ?? []).filter((claim) => claim.currentSupported).map((claim) => ({
          claimId: claim.claimId,
          statement: claim.statement,
          sources: claim.evidence
            .filter((evidence) =>
              evidence.extractionStatus === "extracted"
              && !evidence.isContradiction
              && evidence.sourceEnabled === true
              && evidence.retrievalStatus === "healthy"
            )
            .map((evidence) => ({ publisher: evidence.publisher, url: evidence.sourceUrl, title: evidence.sourceTitle })),
        }))
      : [];
    return [storyId, claims];
  }));
  const blockers: string[] = [];
  if (awaitingStoryApproval.length) blockers.push(`${awaitingStoryApproval.length} selected development(s) still need explicit approval in Editorial Review.`);
  if (!editionApprovalCurrent) blockers.push("The exact selected edition does not have a current human approval.");
  if (!factual.ready) blockers.push("One or more developments have incomplete, unresolved or stale factual verification.");
  if (blockedMembers.length) blockers.push("One or more developments were rejected or returned for more research.");
  if (missingStories.length) blockers.push("One or more developments no longer have source material attached.");
  return json({
    editionId,
    editionKind: ed.edition_kind ?? "video",
    storyEditorialReview: { ready: awaitingStoryApproval.length === 0, awaitingApproval: awaitingStoryApproval, rejectedOrReturned: blockedMembers },
    editorialApproval: { current: editionApprovalCurrent, decision: decision?.decision ?? null, membersCurrent: decision?.members_hash === membersKey(ids) },
    factualVerification: { ready: factual.ready, blocked: factual.blocked },
    verifiedClaimsByStory,
    verificationBriefAllowed: ids.length > 0 && missingStories.length === 0,
    productionPromptAllowed: blockers.length === 0,
    blockers,
    note: "Verification preparation may happen before approvals. Public-facing news prompts require story-level Editorial Review approval, approval of the exact edition membership, and complete current factual verification.",
  });
}

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
  const awaitingStoryApproval = ids.filter((i) => decs.get(i)?.decision !== "approved");
  if (awaitingStoryApproval.length) return { fail: json({
    error: "story_editorial_approval_required",
    detail: "Every development must first receive explicit human approval in Editorial Review. That decision clears it for drafting only; it does not verify factual claims.",
    awaitingApproval: awaitingStoryApproval,
  }, 409) };
  const clearance = await editionClaimClearance(ids);
  if (!clearance.ready) return { fail: json({ error: "verification_blocked", detail: "Prompt generation is blocked because one or more edition stories have incomplete or unresolved factual verification.", blockedClaims: clearance.blocked }, 409) };
  const loaded = await loadStories(ids);
  const missing = ids.filter((i) => !loaded.has(i));
  if (missing.length) return { fail: json({ error: "not_found", detail: "A development is no longer available.", missing }, 404) };
  return { ed, ids, dec, loaded };
}

async function preview(editionId: string, req: Request) {
  const r = await readiness(editionId);
  if ("fail" in r) return r.fail;
  const requestUrl = new URL(req.url);
  if (requestUrl.searchParams.get("deliverable") === "static_roundup_6s") {
    return json({
      editionId,
      editionKind: r.ed.edition_kind ?? "video",
      deliverable: "static_roundup_6s",
      exportReady: r.ed.edition_kind !== "text",
      approval: { decision: r.dec.decision, membersHash: r.dec.members_hash, current: true },
      factualClearance: { ready: true, stories: r.ids.length },
      note: "Server-side preflight passed: this exact saved edition has current human approval and current factual clearance. This is an export preflight, not a public publishing action."
    });
  }
  const ev = evaluateEdition(r.ids.map((i) => r.loaded.get(i)!.dev), { now: Date.now(), structure: r.ed.structure as Structure });
  const members = packsFor(r.ids, r.loaded);
  if (r.ed.edition_kind === "text") return json({ editionId, editionKind: "text", title: r.ed.title, structure: r.ed.structure, structureLabel: STRUCTURE_LABEL[r.ed.structure as Structure], developments: members.map((m, i) => ({ ref: "D" + (i + 1), headline: m.dev.headline, sources: m.pack.sources.length, omitted: m.pack.omitted_sources.count, classes: classCounts(m.pack) })), textBriefing: { targetWords: "1500-2200", targetReadMinutes: "5-8", targetStories: "12-18", note: "Editorial targets, never quotas. Use fewer stories or words when the evidence does not support more." }, deliverables: [{ key: "text_briefing", label: "Written daily news briefing" }], maxPromptChars: MAX_EDITION_PROMPT_CHARS });
  const u = new URL(req.url); const secs = ([60, 90, 120, 480, 600, 720] as const).includes(Number(u.searchParams.get("durationSeconds")) as any) ? (Number(u.searchParams.get("durationSeconds")) as 60 | 90 | 120 | 480 | 600 | 720) : 90;
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
  if (b.mode === "verification_brief") {
    const ids = parseStoryIds(b.ids);
    if (!ids) return json({ error: "bad_request", detail: "Choose 1 to 18 distinct research developments." }, 400);
    const notes = Array.isArray(b.conflictNotes) ? b.conflictNotes.map((x: unknown) => typeof x === "string" ? x : "").slice(0, ids.length) : [];
    return await createVerificationBrief(ids, typeof b.title === "string" ? b.title : "", typeof b.angle === "string" ? b.angle : "", notes);
  }
  const editionId = String(b.editionId ?? "");
  if (!UUID.test(editionId)) return json({ error: "bad_request" }, 400);
  const deliverable = DELIVERABLES.some((d) => d.key === b.deliverable) ? (b.deliverable as Deliverable) : "script_storyboard";
  const duration = ([60, 90, 120, 480, 600, 720] as const).includes(b.durationSeconds) ? (b.durationSeconds as 60 | 90 | 120 | 480 | 600 | 720) : 90;
  const parentId = typeof b.parentId === "string" && UUID.test(b.parentId) ? b.parentId : null;
  const r = await readiness(editionId);
  if ("fail" in r) return r.fail;
  const notes = Array.isArray(b.conflictNotes) ? b.conflictNotes.map((x: unknown) => (typeof x === "string" ? x : "")).slice(0, r.ids.length) : [];
  const members = packsFor(r.ids, r.loaded, notes);
  const structure = r.ed.structure as Structure;
  const evaluation = evaluateEdition(members.map((m) => m.dev), { conflictNotes: notes.filter(Boolean), now: Date.now(), structure });
  const ev = evaluation;
  const { rules, installed: rulesInstalled } = await approvedRules();
  const cr = r.ed.edition_kind === "text" ? null : await loadCreative(); const o = opts(b);
  const out = r.ed.edition_kind === "text"
    ? buildTextEditionPrompt({ title: r.ed.title, members, evaluation, angle: typeof b.angle === "string" && b.angle.trim() ? b.angle : r.ed.narrative_angle ?? "", conflictNotes: notes.filter(Boolean), approvedRules: rules })
    : buildEditionPrompt({
        title: r.ed.title, members, evaluation, deliverable, durationSeconds: duration,
        angle: typeof b.angle === "string" && b.angle.trim() ? b.angle : r.ed.narrative_angle ?? "",
        conflictNotes: notes.filter(Boolean), approvedRules: rules,
        creative: { voice: cr!.settings.voice, toolsConfirmed: cr!.settings.toolsConfirmed, lex: cr!.lex, format: o.format, sound: o.sound, visual: o.visual },
      });
  const savedDeliverable = r.ed.edition_kind === "text" ? "text_briefing" : deliverable;
  const reply = {
    structure: { key: structure, label: STRUCTURE_LABEL[structure] },
    coherence: { verdict: ev.coherence.verdict, score: ev.coherence.score },
    roles: out.roles, rationale: out.rationale, tools: out.tools,
    evidenceClasses: members.map((m, i) => ({ ref: `D${i + 1}`, ...classCounts(m.pack) })),
    brandChecklist: brandChecklist(), brandVersion: BRAND_VERSION, prompt: out.prompt,
    creative: r.ed.edition_kind === "text" ? null : { format: (out as any).format, runtime: (out.rationale as any).creative.runtime, voiceApproval: approvalState(cr!.settings.voice), pronunciationCheckRequired: (out.rationale as any).creative.pronunciation_check_required, voiceConfigured: cr!.configured },
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
        structure, title: r.ed.title, deliverable: savedDeliverable, roles: out.roles, rationale: out.rationale, coherence: { score: ev.coherence.score, verdict: ev.coherence.verdict, components: ev.coherence.components },
        tools: out.tools, evidence_snapshot: out.snapshot, style_rule_ids: [], brand_spec_version: BRAND_VERSION, prompt_text: out.prompt, created_by: "editor",
      },
    });
    const saved = Array.isArray(rows) ? rows[0] : rows;
    await db("audit_events", { method: "POST", prefer: "return=minimal", body: { event_type: "edition_prompt_created", entity_type: "edition", entity_id: editionId, actor: "editor", detail: { version, edition_kind: r.ed.edition_kind ?? "video", structure, deliverable: savedDeliverable, developments: r.ids.length, prompt_id: saved?.id ?? null, approved_style_rules: rules.length, rules_installed: rulesInstalled } } });
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
  // Batch the current claim-register check across all prompt members. Reusing a saved prompt must
  // not remain marked current after a claim/evidence change invalidates story-level clearance.
  const currentIdsByEdition = new Map<string, string[]>();
  for (const r of rows) if (!currentIdsByEdition.has(r.edition_id)) currentIdsByEdition.set(r.edition_id, await memberIds(r.edition_id));
  const allCurrentIds = [...new Set([...currentIdsByEdition.values()].flat())];
  const clearanceByStory = await editionClaimClearanceByStory(allCurrentIds);
  const loadedCurrent = await loadStories(allCurrentIds);
  const out = [];
  for (const r of rows) {
    const currentIds = currentIdsByEdition.get(r.edition_id) ?? [];
    const blocked = currentIds.flatMap((id) => clearanceByStory.get(id)?.blocked ?? [{ storyId: id, reason: "Claim-register clearance could not be confirmed." }]);
    const claimClearance = currentIds.length
      ? { ready: blocked.length === 0, blocked }
      : { ready: false, blocked: [{ storyId: "", reason: "The edition has no stories." }] };
    const v = await promptValidity(r, Date.now(), false, claimClearance, currentIds);
    const sourcesLoaded = currentIds.length > 0 && currentIds.every((id) => loadedCurrent.has(id));
    const evidenceCurrent = sourcesLoaded && evidenceHash(packsFor(currentIds, loadedCurrent)) === r.evidence_hash;
    const stale = await creativeStale(r);
    const reasons = [
      ...v.reasons,
      ...(!sourcesLoaded ? ["One or more story/source records are no longer available for this prompt."] : !evidenceCurrent ? ["Source metadata, source health or the verified claim register changed after this prompt was written."] : []),
      ...(stale ? [stale] : []),
    ];
    out.push({ id: r.id, editionId: r.edition_id, title: r.title, editionKind: r.edition_kind ?? "video", version: r.version, structure: r.structure, deliverable: r.deliverable, developments: (r.members ?? []).length, createdAt: r.created_at, current: v.current && evidenceCurrent && !stale, reasons });
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
    valid: v.current, validity: { approvalCurrent: v.approvalCurrent, membersCurrent: v.membersCurrent, storiesOk: v.storiesOk, claimClearanceCurrent: v.claimClearanceCurrent, evidenceCurrent: v.evidenceCurrent }, reasons: v.reasons,
    prompt: v.current ? r.prompt_text : null,
    withheld: v.current ? undefined : "This prompt may no longer be valid and is kept as history only: " + v.reasons.join(" ") + " Re-approve or adjust the edition and generate a new version.",
  });
}

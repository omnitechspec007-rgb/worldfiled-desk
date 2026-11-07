// Shared loading for the Edition Desk functions: stories with their sources, latest human decisions,
// edition member lists, and the "is this saved prompt still valid?" check.
import { db, DbError } from "./db.mts";
import { buildDev, membersKey, type Dev } from "./editions.mts";
import { buildEvidencePack, type EvStory, type EvSource } from "./evidence-pack.mts";
import { evidenceHash, type EditionMember } from "./edition-prompt.mts";
import { hasContradictionReconciliation } from "./claim-clearance.mts";
import { canRetrieveMetadata, loadContentPolicies, policyForSource, type ContentPolicyRow } from "./source-policy.mts";
import type { StoryInput } from "./scoring.mts";

export const UUID = /^[0-9a-f-]{36}$/i;
export const SCORE_WINDOW_HOURS = 72; // same windows as the research pipeline's rank stage
export const OFFICIAL_SCORE_WINDOW_HOURS = 14 * 24;
export const MAX_MEMBERS = 18;
const EMBED = "story_source_links(retrieved_sources(title,url,published_at,retrieved_at,extract,source_registry(id,name,country_scope,reliability_note)))";
const FIELDS = `id,headline,category,created_at,${EMBED}`;
const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

export type Loaded = { dev: Dev; story: EvStory; hasPrimary: boolean };

function toLoaded(st: any, now: number, policies: ContentPolicyRow[]): Loaded | null {
  const sources: EvSource[] = (st.story_source_links ?? [])
    .map((l: any) => l.retrieved_sources)
    .filter(Boolean)
    .filter((s: any) => canRetrieveMetadata(policyForSource(policies, s.source_registry?.id ?? "")))
    .map((s: any) => ({
      outlet: s.source_registry?.name ?? "Unknown",
      region: (s.source_registry?.country_scope ?? "").split(" · ")[0] || "Unknown",
      tier: /tier:primary/.test(s.source_registry?.reliability_note ?? "") ? ("primary" as const) : ("reporting" as const),
      url: s.url as string,
      title: (s.title ?? "") as string,
      summary: (s.extract ?? null) as string | null,
      publishedAt: (s.published_at ?? null) as string | null,
      retrievedAt: (s.retrieved_at ?? null) as string | null,
    }));
  if (!sources.length) return null;
  const input: StoryInput = { id: st.id, headline: st.headline, category: st.category, createdAt: st.created_at, sources };
  return { dev: buildDev(input, sources, now), story: { headline: st.headline, category: st.category, sources }, hasPrimary: sources.some((s) => s.tier === "primary") };
}

export async function loadStories(ids: string[], now = Date.now()): Promise<Map<string, Loaded>> {
  const out = new Map<string, Loaded>();
  const policies = await loadContentPolicies();
  for (const part of chunk(ids, 30)) {
    const rows = await db<any[]>(`stories?id=in.(${part.join(",")})&select=${FIELDS}`);
    for (const r of rows) { const l = toLoaded(r, now, policies); if (l) out.set(r.id, l); }
  }
  return out;
}

/** Recent stories. `fresh` = inside the pipeline's freshness window and not rejected: only these feed the SUGGESTIONS.
 *  Older and rejected stories are still returned (flagged) so the editor can browse and select by hand. */
export async function loadPool(now = Date.now(), limit = 150) {
  const [rows, policies] = await Promise.all([
    db<any[]>(`stories?select=${FIELDS}&order=created_at.desc&limit=${limit}`),
    loadContentPolicies(),
  ]);
  const all = rows.map((r) => toLoaded(r, now, policies)).filter(Boolean) as Loaded[];
  const decisions = await latestDecisions(all.map((l) => l.dev.id));
  const pool: Loaded[] = [];
  const skipped: { id: string; headline: string; reason: string }[] = [];
  const flags = new Map<string, { fresh: boolean; why: string | null; ageHours: number | null }>();
  for (const l of all) {
    const ageH = l.dev.newest ? (now - l.dev.newest) / 3_600_000 : Infinity;
    const dec = decisions.get(l.dev.id)?.decision;
    const ageHours = Number.isFinite(ageH) ? Math.round(ageH) : null;
    if (dec === "rejected") { skipped.push({ id: l.dev.id, headline: l.dev.headline, reason: "Rejected by the editor" }); flags.set(l.dev.id, { fresh: false, why: "Rejected by the editor", ageHours }); }
    else if (!(ageH <= SCORE_WINDOW_HOURS || (l.hasPrimary && ageH <= OFFICIAL_SCORE_WINDOW_HOURS))) { skipped.push({ id: l.dev.id, headline: l.dev.headline, reason: "Older than the freshness window (72 hours, or 14 days for official sources)" }); flags.set(l.dev.id, { fresh: false, why: "Older than the freshness window", ageHours }); }
    else { pool.push(l); flags.set(l.dev.id, { fresh: true, why: null, ageHours }); }
  }
  return { pool, all, skipped, decisions, flags };
}

export async function latestDecisions(ids: string[]) {
  const m = new Map<string, { id: string; decision: string; created_at: string }>();
  for (const part of chunk(ids, 30)) {
    if (!part.length) continue;
    for (const d of await db<any[]>(`editorial_decisions?story_id=in.(${part.join(",")})&select=id,story_id,decision,created_at&order=created_at.desc,id.desc`)) if (!m.has(d.story_id)) m.set(d.story_id, d);
  }
  return m;
}

export async function memberIds(editionId: string): Promise<string[]> {
  const rows = await db<any[]>(`edition_developments?edition_id=eq.${editionId}&select=story_id,position&order=position.asc`);
  return rows.map((r) => r.story_id);
}
export async function latestEditionDecision(editionId: string) {
  const r = await db<any[]>(`edition_decisions?edition_id=eq.${editionId}&select=id,decision,notes,members_hash,decided_by,created_at&order=created_at.desc,id.desc&limit=1`);
  return r[0] ?? null;
}

/** Evidence packs for the members, in order, each with its own D#- ref namespace. */
export function packsFor(ids: string[], loaded: Map<string, Loaded>, conflictNotes: string[] = []): EditionMember[] {
  return ids.map((id, i) => {
    const l = loaded.get(id)!;
    return { dev: l.dev, pack: buildEvidencePack(l.story, { refPrefix: `D${i + 1}-`, conflictNote: conflictNotes[i] ?? null }) };
  });
}


export type ClaimClearance = { ready: boolean; blocked: { storyId: string; claimId?: string; reason: string }[] };
/** A publishable edition requires a complete claim register for every member story. */
export function assessClaimClearance(rows: any[], storyIds: string[]): ClaimClearance {
  const blocked: ClaimClearance["blocked"] = [];
  const byStory = new Map<string, any[]>();
  for (const row of rows) byStory.set(row.story_id, [...(byStory.get(row.story_id) ?? []), row]);
  for (const storyId of storyIds) {
    const claims = byStory.get(storyId) ?? [];
    if (!claims.length) { blocked.push({ storyId, reason: "No material claims have been recorded." }); continue; }
    for (const claim of claims) {
      const latest = [...(claim.verification_results ?? [])].sort((a,b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")) || String(b.id ?? "").localeCompare(String(a.id ?? "")))[0];
      const evidence = claim.claim_evidence ?? [];
      const extracted = evidence.filter((e:any) => e.passage && e.extraction_status === "extracted");
      const support = extracted.some((e:any) => !e.is_contradiction);
      const contradiction = extracted.some((e:any) => e.is_contradiction);
      const latestEvidenceAt = Math.max(0, ...evidence.map((e:any) => Date.parse(e.created_at ?? "") || 0));
      const decisionAt = Date.parse(latest?.created_at ?? "") || 0;
      if (!latest) blocked.push({ storyId, claimId: claim.id, reason: "No editor decision recorded." });
      else if (latest.outcome !== "SUPPORTED") blocked.push({ storyId, claimId: claim.id, reason: "Latest decision is " + latest.outcome + "." });
      else if (!support) blocked.push({ storyId, claimId: claim.id, reason: "No extracted supporting passage." });
      else if (decisionAt < latestEvidenceAt) blocked.push({ storyId, claimId: claim.id, reason: "Evidence was added or changed after the latest editor decision; review this claim again." });
      else if (contradiction && !hasContradictionReconciliation(latest.reviewer_notes)) blocked.push({ storyId, claimId: claim.id, reason: "Contradictory evidence needs a specific editor reconciliation rationale, not a general note." });
    }
  }
  return { ready: blocked.length === 0, blocked };
}

/** The editor's explicit story-level completeness acknowledgement is part of clearance. */
export function assessStoryVerificationStatus(stories: any[], storyIds: string[]): ClaimClearance {
  const byId = new Map(stories.map((story) => [story.id, story.verification_status]));
  const blocked = storyIds
    .filter((storyId) => byId.get(storyId) !== "verified")
    .map((storyId) => ({
      storyId,
      reason: byId.has(storyId)
        ? "The editor has not explicitly marked this material-claim register complete."
        : "The story record is missing; claim-register clearance cannot be confirmed.",
    }));
  return { ready: blocked.length === 0, blocked };
}

export async function editionClaimClearance(storyIds: string[]): Promise<ClaimClearance> {
  if (!storyIds.length) return { ready: false, blocked: [{ storyId: "", reason: "The edition has no stories." }] };
  const [claims, stories, policies] = await Promise.all([
    db<any[]>(`claims?story_id=in.(${storyIds.join(",")})&select=id,story_id,claim_evidence(id,source_id,passage,extraction_status,is_contradiction,created_at,retrieved_sources(registry_id)),verification_results(id,outcome,reviewer_notes,created_at)`),
    db<any[]>(`stories?id=in.(${storyIds.join(",")})&select=id,verification_status`),
    loadContentPolicies(),
  ]);
  const policyAwareClaims = claims.map((claim) => ({
    ...claim,
    claim_evidence: (claim.claim_evidence ?? []).filter((e: any) =>
      typeof e.retrieved_sources?.registry_id === "string" &&
      canRetrieveMetadata(policyForSource(policies, e.retrieved_sources.registry_id))
    ),
  }));
  const claimClearance = assessClaimClearance(policyAwareClaims, storyIds);
  const statusClearance = assessStoryVerificationStatus(stories, storyIds);
  const blocked = [...statusClearance.blocked, ...claimClearance.blocked];
  return { ready: blocked.length === 0, blocked };
}

export type Validity = { current: boolean; reasons: string[]; approvalCurrent: boolean; membersCurrent: boolean; storiesOk: boolean; evidenceCurrent: boolean | null };
/** Decide whether a saved edition prompt is still valid. Kept history is never deleted; this only controls reuse. */
export async function promptValidity(p: any, now = Date.now(), checkEvidence = true): Promise<Validity> {
  const reasons: string[] = [];
  const dec = await latestEditionDecision(p.edition_id);
  const approvalCurrent = dec?.decision === "approved" && dec.id === p.approval_decision_id;
  if (!approvalCurrent) reasons.push("The edition's approval is no longer current (it was rejected, sent back for changes, or approved again later).");
  const ids = await memberIds(p.edition_id);
  const membersCurrent = membersKey(ids) === p.members_hash;
  if (!membersCurrent) reasons.push("The edition's developments or their order changed after this prompt was written.");
  const decs = await latestDecisions(p.members ?? []);
  const rej = (p.members as string[]).filter((id) => ["rejected", "needs_research"].includes(decs.get(id)?.decision ?? ""));
  const storiesOk = rej.length === 0;
  if (!storiesOk) reasons.push(`${rej.length} development${rej.length > 1 ? "s were" : " was"} rejected or sent back for research after this prompt was written.`);
  let evidenceCurrent: boolean | null = null;
  if (membersCurrent && checkEvidence) {
    const loaded = await loadStories(ids, now);
    if (ids.every((id) => loaded.has(id))) {
      evidenceCurrent = evidenceHash(packsFor(ids, loaded)) === p.evidence_hash;
      if (!evidenceCurrent) reasons.push("The retrieved evidence for one or more developments has changed since this prompt was written.");
    } else { evidenceCurrent = false; reasons.push("A development in this edition is no longer available in the database."); }
  }
  return { current: reasons.length === 0, reasons, approvalCurrent, membersCurrent, storiesOk, evidenceCurrent };
}
export { DbError };

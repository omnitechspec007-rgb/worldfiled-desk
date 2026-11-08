// Shared loading for the Edition Desk functions: stories with their sources, latest human decisions,
// edition member lists, and the "is this saved prompt still valid?" check.
import { db, DbError } from "./db.mts";
import { buildDev, membersKey, type Dev } from "./editions.mts";
import { buildEvidencePack, type ClaimRegisterEntry, type EvStory, type EvSource } from "./evidence-pack.mts";
import { evidenceHash, type EditionMember } from "./edition-prompt.mts";
import { hasContradictionReconciliation } from "./claim-clearance.mts";
import type { StoryInput } from "./scoring.mts";

export const UUID = /^[0-9a-f-]{36}$/i;
export const SCORE_WINDOW_HOURS = 72; // same windows as the research pipeline's rank stage
export const OFFICIAL_SCORE_WINDOW_HOURS = 14 * 24;
export const MAX_MEMBERS = 18;
const EMBED = "story_source_links(retrieved_sources(title,url,published_at,retrieved_at,content_status,extract,source_registry(name,country_scope,reliability_note,enabled,retrieval_status)))";
const FIELDS = `id,headline,category,created_at,verification_status,${EMBED}`;
const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

export type Loaded = { dev: Dev; story: EvStory; hasPrimary: boolean; verificationStatus: string; claimRegister: ClaimRegisterEntry[] };

function toLoaded(st: any, now: number, includeInactiveSources = false, claimRegister: ClaimRegisterEntry[] = []): Loaded | null {
  const sources: EvSource[] = (st.story_source_links ?? [])
    .map((l: any) => l.retrieved_sources)
    .filter(Boolean)
    // Public production uses active healthy sources only. Internal verification assignments
    // may inspect historical leads too, but their state is carried into the evidence pack.
    .filter((s: any) => includeInactiveSources || (s.source_registry?.enabled === true && s.source_registry?.retrieval_status === "healthy"))
    .map((s: any) => ({
      outlet: s.source_registry?.name ?? "Unknown",
      region: (s.source_registry?.country_scope ?? "").split(" · ")[0] || "Unknown",
      tier: /tier:primary/.test(s.source_registry?.reliability_note ?? "") ? ("primary" as const) : ("reporting" as const),
      url: s.url as string,
      title: (s.title ?? "") as string,
      summary: (s.extract ?? null) as string | null,
      publishedAt: (s.published_at ?? null) as string | null,
      retrievedAt: (s.retrieved_at ?? null) as string | null,
      contentStatus: (s.content_status ?? null) as string | null,
      enabled: typeof s.source_registry?.enabled === "boolean" ? s.source_registry.enabled : undefined,
      retrievalStatus: typeof s.source_registry?.retrieval_status === "string" ? s.source_registry.retrieval_status : null,
    }));
  if (!sources.length) return null;
  const input: StoryInput = { id: st.id, headline: st.headline, category: st.category, createdAt: st.created_at, sources };
  return { dev: buildDev(input, sources, now), story: { headline: st.headline, category: st.category, sources }, hasPrimary: sources.some((s) => s.tier === "primary"), verificationStatus: typeof st.verification_status === "string" ? st.verification_status : "unverified", claimRegister };
}

async function claimRegistersByStory(ids: string[]): Promise<Map<string, ClaimRegisterEntry[]>> {
  const out = new Map<string, ClaimRegisterEntry[]>();
  for (const id of ids) out.set(id, []);
  for (const part of chunk(ids, 30)) {
    let rows: any[];
    try {
      rows = await db<any[]>("claims?story_id=in.(" + part.join(",") + ")&select=id,story_id,claim_text,category,claim_evidence(id,source_id,passage,passage_location,is_contradiction,extraction_status,created_at,retrieved_sources(id,title,url,publisher,published_at,content_status,source_registry(name,publisher,enabled,retrieval_status))),verification_results(id,outcome,reviewer_notes,created_at)");
    } catch (error) {
      // Keep the research-only verification assignment available before claim tables are installed.
      // Public production separately fails closed through editionClaimClearance().
      if (error instanceof DbError && error.upstream === 404) return out;
      throw error;
    }
    for (const row of rows) {
      const evidence = row.claim_evidence ?? [];
      const latest = [...(row.verification_results ?? [])].sort((a: any, b: any) =>
        String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")) || String(b.id ?? "").localeCompare(String(a.id ?? ""))
      )[0];
      const extracted = evidence.filter((e: any) => e.passage && e.extraction_status === "extracted");
      const hasSupport = extracted.some((e: any) =>
        !e.is_contradiction
        && e.retrieved_sources?.source_registry?.enabled === true
        && e.retrieved_sources?.source_registry?.retrieval_status === "healthy"
      );
      const hasContradiction = extracted.some((e: any) => e.is_contradiction);
      const latestEvidenceAt = Math.max(0, ...evidence.map((e: any) => Date.parse(e.created_at ?? "") || 0));
      const decidedAtMs = Date.parse(latest?.created_at ?? "") || 0;
      const currentSupported = latest?.outcome === "SUPPORTED" && hasSupport && decidedAtMs >= latestEvidenceAt && (!hasContradiction || hasContradictionReconciliation(latest.reviewer_notes));
      const entry: ClaimRegisterEntry = {
        claimId: row.id, statement: row.claim_text, category: row.category ?? null, outcome: latest?.outcome ?? null,
        reviewerNotes: latest?.reviewer_notes ?? null, decidedAt: latest?.created_at ?? null, currentSupported,
        evidence: evidence.map((e: any) => ({
          sourceId: e.source_id ?? null, sourceTitle: e.retrieved_sources?.title ?? null, sourceUrl: e.retrieved_sources?.url ?? null,
          publisher: e.retrieved_sources?.source_registry?.publisher ?? e.retrieved_sources?.source_registry?.name ?? e.retrieved_sources?.publisher ?? null,
          publishedAt: e.retrieved_sources?.published_at ?? null, contentDepth: e.retrieved_sources?.content_status ?? null,
          sourceEnabled: typeof e.retrieved_sources?.source_registry?.enabled === "boolean" ? e.retrieved_sources.source_registry.enabled : null,
          retrievalStatus: typeof e.retrieved_sources?.source_registry?.retrieval_status === "string" ? e.retrieved_sources.source_registry.retrieval_status : null,
          passage: e.passage ?? null, passageLocation: e.passage_location ?? null, extractionStatus: e.extraction_status ?? "unknown",
          isContradiction: e.is_contradiction === true, createdAt: e.created_at ?? null,
        })),
      };
      out.set(row.story_id, [...(out.get(row.story_id) ?? []), entry]);
    }
  }
  return out;
}

/**
 * includeInactiveSources is for internal verification research only. Public production
 * leaves it false and fails closed if no currently healthy/enabled source remains.
 */
export async function loadStories(ids: string[], now = Date.now(), includeInactiveSources = false): Promise<Map<string, Loaded>> {
  const out = new Map<string, Loaded>();
  const registers = await claimRegistersByStory(ids);
  for (const part of chunk(ids, 30)) {
    const rows = await db<any[]>("stories?id=in.(" + part.join(",") + ")&select=" + FIELDS);
    for (const r of rows) {
      const l = toLoaded(r, now, includeInactiveSources, registers.get(r.id) ?? []);
      if (l) out.set(r.id, l);
    }
  }
  return out;
}

/** Recent stories. `fresh` = inside the pipeline's freshness window and not rejected: only these feed the SUGGESTIONS.
 *  Older and rejected stories are still returned (flagged) so the editor can browse and select by hand. */
export async function loadPool(now = Date.now(), limit = 150) {
  const rows = await db<any[]>(`stories?select=${FIELDS}&order=created_at.desc&limit=${limit}`);
  const all = rows.map((r) => toLoaded(r, now)).filter(Boolean) as Loaded[];
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
    const pack = buildEvidencePack(l.story, { refPrefix: `D${i + 1}-`, conflictNote: conflictNotes[i] ?? null });
    pack.claim_register = l.claimRegister;
    return { dev: l.dev, pack };
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
      const support = extracted.some((e:any) =>
        !e.is_contradiction
        && e.retrieved_sources?.source_registry?.enabled === true
        && e.retrieved_sources?.source_registry?.retrieval_status === "healthy"
      );
      const contradiction = extracted.some((e:any) => e.is_contradiction);
      const latestEvidenceAt = Math.max(0, ...evidence.map((e:any) => Date.parse(e.created_at ?? "") || 0));
      const decisionAt = Date.parse(latest?.created_at ?? "") || 0;
      if (!latest) blocked.push({ storyId, claimId: claim.id, reason: "No editor decision recorded." });
      else if (latest.outcome !== "SUPPORTED") blocked.push({ storyId, claimId: claim.id, reason: "Latest decision is " + latest.outcome + "." });
      else if (!support) blocked.push({ storyId, claimId: claim.id, reason: "No extracted supporting passage from a currently enabled, healthy source." });
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

export async function editionClaimClearanceByStory(storyIds: string[]): Promise<Map<string, ClaimClearance>> {
  const unique = [...new Set(storyIds)];
  const claims: any[] = [];
  const stories: any[] = [];
  for (const part of chunk(unique, 30)) {
    const [claimRows, storyRows] = await Promise.all([
      db<any[]>(`claims?story_id=in.(${part.join(",")})&select=id,story_id,claim_evidence(id,passage,extraction_status,is_contradiction,created_at,retrieved_sources(source_registry(enabled,retrieval_status))),verification_results(id,outcome,reviewer_notes,created_at)`),
      db<any[]>(`stories?id=in.(${part.join(",")})&select=id,verification_status`),
    ]);
    claims.push(...claimRows);
    stories.push(...storyRows);
  }
  return new Map(unique.map((storyId) => {
    const claimClearance = assessClaimClearance(claims, [storyId]);
    const statusClearance = assessStoryVerificationStatus(stories, [storyId]);
    const blocked = [...statusClearance.blocked, ...claimClearance.blocked];
    return [storyId, { ready: blocked.length === 0, blocked }] as [string, ClaimClearance];
  }));
}

export async function editionClaimClearance(storyIds: string[]): Promise<ClaimClearance> {
  if (!storyIds.length) return { ready: false, blocked: [{ storyId: "", reason: "The edition has no stories." }] };
  const byStory = await editionClaimClearanceByStory(storyIds);
  const unique = [...new Set(storyIds)];
  const blocked = unique.flatMap((storyId) => byStory.get(storyId)?.blocked ?? [{ storyId, reason: "Claim-register clearance could not be confirmed." }]);
  return { ready: blocked.length === 0, blocked };
}

export type Validity = { current: boolean; reasons: string[]; approvalCurrent: boolean; membersCurrent: boolean; storiesOk: boolean; evidenceCurrent: boolean | null; claimClearanceCurrent: boolean };
/** Decide whether a saved edition prompt is still valid. Kept history is never deleted; this only controls reuse. */
export async function promptValidity(p: any, now = Date.now(), checkEvidence = true, preloadedClaimClearance?: ClaimClearance, currentMemberIds?: string[]): Promise<Validity> {
  const reasons: string[] = [];
  const dec = await latestEditionDecision(p.edition_id);
  const approvalCurrent = dec?.decision === "approved" && dec.id === p.approval_decision_id;
  if (!approvalCurrent) reasons.push("The edition's approval is no longer current (it was rejected, sent back for changes, or approved again later).");
  const ids = currentMemberIds ?? await memberIds(p.edition_id);
  const membersCurrent = membersKey(ids) === p.members_hash;
  if (!membersCurrent) reasons.push("The edition's developments or their order changed after this prompt was written.");
  const claimClearance = preloadedClaimClearance ?? await editionClaimClearance(ids);
  const claimClearanceCurrent = claimClearance.ready;
  if (!claimClearanceCurrent) reasons.push("One or more story claim registers are no longer complete or current; re-check them before reusing this prompt.");
  const decs = await latestDecisions(ids);
  const rejectedOrReturned = ids.filter((id) => ["rejected", "needs_research"].includes(decs.get(id)?.decision ?? ""));
  const awaitingStoryApproval = ids.filter((id) => decs.get(id)?.decision !== "approved");
  const storiesOk = rejectedOrReturned.length === 0 && awaitingStoryApproval.length === 0;
  if (rejectedOrReturned.length) reasons.push(`${rejectedOrReturned.length} development${rejectedOrReturned.length > 1 ? "s were" : " was"} rejected or sent back for research after this prompt was written.`);
  if (awaitingStoryApproval.length) reasons.push(`${awaitingStoryApproval.length} development${awaitingStoryApproval.length > 1 ? "s do" : " does"} not have a current explicit story-level Editorial Review approval.`);
  let evidenceCurrent: boolean | null = null;
  if (membersCurrent && checkEvidence) {
    const loaded = await loadStories(ids, now);
    if (ids.every((id) => loaded.has(id))) {
      evidenceCurrent = evidenceHash(packsFor(ids, loaded)) === p.evidence_hash;
      if (!evidenceCurrent) reasons.push("The retrieved evidence for one or more developments has changed since this prompt was written.");
    } else { evidenceCurrent = false; reasons.push("A development in this edition is no longer available in the database."); }
  }
  return { current: reasons.length === 0, reasons, approvalCurrent, membersCurrent, storiesOk, evidenceCurrent, claimClearanceCurrent };
}
export { DbError };

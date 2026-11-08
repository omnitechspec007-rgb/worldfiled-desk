// Human claim verification API. All writes require the signed editor session.
import { createHash } from "node:crypto";
import { hasSameOrigin, isAuthenticated } from "../lib/session.mts";
import { db, DbError } from "../lib/db.mts";
import { assessClaimClearance } from "../lib/edition-data.mts";
import { formatReviewerNotes } from "../lib/claim-clearance.mts";
import { canRetrieveMetadata, canUsePassageEvidence, loadContentPolicies, policyForSource } from "../lib/source-policy.mts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OUTCOMES = ["SUPPORTED", "PARTIALLY_SUPPORTED", "CONTRADICTED", "INSUFFICIENT_EVIDENCE", "UNVERIFIED", "NOT_APPLICABLE"];
const hash = (s: string) => createHash("sha256").update(s.trim().toLowerCase()).digest("hex");
const clean = (s: unknown) => typeof s === "string" ? s.trim() : "";
const exceeds = (s: unknown, max: number) => typeof s === "string" && s.trim().length > max;

async function accessibleClaimClearance(storyId: string) {
  const [claims, policies] = await Promise.all([
    db<any[]>(`claims?story_id=eq.${storyId}&select=id,story_id,claim_evidence(id,source_id,passage,extraction_status,is_contradiction,created_at,retrieved_sources(registry_id)),verification_results(id,outcome,reviewer_notes,created_at)`),
    loadContentPolicies(),
  ]);
  const safeClaims = claims.map((claim) => ({
    ...claim,
    claim_evidence: (claim.claim_evidence ?? []).filter((e: any) =>
      typeof e.retrieved_sources?.registry_id === "string" &&
      canUsePassageEvidence(policyForSource(policies.rows, e.retrieved_sources.registry_id))
    ),
  }));
  const clearance = assessClaimClearance(safeClaims, [storyId]);
  if (!policies.installed && !clearance.ready) {
    clearance.blocked.push({ storyId, reason: "Source content-access policies are not installed. No source is assumed to permit passage evidence." });
  }
  return clearance;
}

export default async (req: Request) => {
  if (!isAuthenticated(req)) return json({ error: "unauthorized" }, 401);
  if (req.method === "POST" && !hasSameOrigin(req)) return json({ error: "origin_mismatch" }, 403);
  try {
    if (req.method === "GET") {
      const u = new URL(req.url);
      const storyId = u.searchParams.get("storyId") ?? "";
      if (!UUID.test(storyId)) return json({ error: "bad_story_id" }, 400);
      const stories = await db<any[]>(`stories?id=eq.${storyId}&select=id,headline,verification_status,editorial_status`);
      if (!stories[0]) return json({ error: "not_found" }, 404);
      const [claims, sources, policies] = await Promise.all([
        db<any[]>(`claims?story_id=eq.${storyId}&select=id,claim_text,category,created_at,claim_evidence(id,source_id,passage,passage_location,is_contradiction,extraction_status,retrieved_sources(id,registry_id,title,url,publisher,content_status)),verification_results(id,outcome,determined_by,reviewer_notes,created_at)&order=created_at.asc`),
        db<any[]>(`story_source_links?story_id=eq.${storyId}&select=role,retrieved_sources(id,registry_id,title,url,publisher,published_at,content_status,source_registry(id,name,publisher))`),
        loadContentPolicies(),
      ]);
      const safeClaims = claims.map((claim) => ({
        ...claim,
        claim_evidence: (claim.claim_evidence ?? []).map((e: any) => {
          const registryId = e.retrieved_sources?.registry_id;
          const policy = typeof registryId === "string" ? policyForSource(policies.rows, registryId) : "blocked";
          const blocked = !canRetrieveMetadata(policy);
          const passageWithheld = !canUsePassageEvidence(policy);
          return passageWithheld
            ? { ...e, passage: null, passage_location: null, extraction_status: "inaccessible", policyBlocked: blocked, passageWithheld: true, contentPolicy: policy, retrieved_sources: blocked ? null : e.retrieved_sources }
            : { ...e, policyBlocked: false, passageWithheld: false, contentPolicy: policy };
        }),
      }));
      const safeSources = sources.filter((row) => {
        const registryId = row.retrieved_sources?.registry_id;
        return typeof registryId === "string" && canRetrieveMetadata(policyForSource(policies.rows, registryId));
      });
      return json({
        story: stories[0],
        claims: safeClaims,
        sources: safeSources.map((row) => ({
          ...row.retrieved_sources,
          linkRole: row.role,
          contentPolicy: policyForSource(policies.rows, row.retrieved_sources.registry_id),
        })),
        sourceContentPolicyInstalled: policies.installed,
        sourcePolicyNote: policies.installed ? null : "Source content policies are not installed. All publishers default to metadata-only; passages remain unavailable for claim verification until a human approves extraction_allowed.",
      });
    }
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    let b: any;
    try {
      const raw = await req.text();
      if (raw.length > 12000) return json({ error: "too_large", detail: "Verification requests are limited to 12 KB. Nothing was saved." }, 413);
      b = JSON.parse(raw);
    } catch { return json({ error: "bad_json" }, 400); }
    if (!b || typeof b !== "object" || Array.isArray(b)) return json({ error: "bad_request" }, 400);
    const storyId = clean(b.storyId);
    if (!UUID.test(storyId)) return json({ error: "bad_story_id" }, 400);
    const exists = await db<any[]>(`stories?id=eq.${storyId}&select=id`);
    if (!exists[0]) return json({ error: "not_found" }, 404);

    if (b.action === "add_claim") {
      const claimText = clean(b.claimText);
      const category = clean(b.category) || "factual";
      if (exceeds(b.claimText, 1200) || exceeds(b.category, 80)) return json({ error: "field_too_long", detail: "Claim text is limited to 1,200 characters and category to 80. Nothing was truncated or saved." }, 400);
      if (claimText.length < 8) return json({ error: "claim_too_short" }, 400);

      const key = req.headers.get("idempotency-key") ?? "";
      if (!UUID.test(key)) return json({ error: "idempotency_key_required", detail: "A valid Idempotency-Key UUID is required. Retry the same claim operation with the same key." }, 400);
      const canonical = JSON.stringify({ storyId, claimText, category });
      const requestHash = createHash("sha256").update(canonical).digest("hex");
      const claimHash = hash(claimText);
      const result: any = await db<any>("rpc/add_material_claim", {
        method: "POST",
        body: {
          p_idempotency_key: key,
          p_request_hash: requestHash,
          p_story_id: storyId,
          p_claim_text: claimText,
          p_claim_hash: claimHash,
          p_category: category,
        },
      });
      const status = Number(result?.status ?? 500);
      const responseBody = result?.body ?? { error: "invalid_rpc_response" };
      return json({ ...responseBody, replayed: result?.replayed === true }, status);
    }

    if (b.action === "add_evidence") {
      const claimId = clean(b.claimId), sourceId = clean(b.sourceId);
      const passage = clean(b.passage), location = clean(b.location);
      if (!UUID.test(claimId) || !UUID.test(sourceId)) return json({ error: "bad_reference" }, 400);
      if (exceeds(b.passage, 4000) || exceeds(b.location, 300)) return json({ error: "field_too_long", detail: "Evidence passage is limited to 4,000 characters and location to 300. Nothing was truncated or saved." }, 400);
      if (b.isContradiction !== undefined && typeof b.isContradiction !== "boolean") return json({ error: "invalid_contradiction_flag", detail: "isContradiction must be a boolean, not a string or inferred value." }, 400);

      const linked = await db<any[]>(`story_source_links?story_id=eq.${storyId}&source_id=eq.${sourceId}&select=source_id&limit=1`);
      if (!linked[0]) return json({ error: "source_not_linked_to_story" }, 400);
      const retrieved = await db<any[]>(`retrieved_sources?id=eq.${sourceId}&select=id,registry_id&limit=1`);
      if (!retrieved[0] || typeof retrieved[0].registry_id !== "string") {
        return json({ error: "source_registry_missing", detail: "The source has no registered publisher record, so its passage policy cannot be confirmed." }, 409);
      }
      const policies = await loadContentPolicies();
      const policy = policyForSource(policies.rows, retrieved[0].registry_id);
      if (!canUsePassageEvidence(policy)) {
        return json({
          error: policy === "blocked" ? "source_blocked_by_content_policy" : "source_not_approved_for_passage_evidence",
          detail: policy === "blocked"
            ? "This source is blocked by its reviewed content-access policy."
            : "This source is metadata-only. A human editor must approve extraction_allowed before storing a full-text passage as claim evidence.",
          contentPolicyInstalled: policies.installed,
        }, 409);
      }

      const key = req.headers.get("idempotency-key") ?? "";
      if (!UUID.test(key)) return json({ error: "idempotency_key_required", detail: "A valid Idempotency-Key UUID is required. Retry the same evidence operation with the same key." }, 400);
      const isContradiction = b.isContradiction === true;
      const canonical = JSON.stringify({ storyId, claimId, sourceId, passage, location, isContradiction });
      const requestHash = createHash("sha256").update(canonical).digest("hex");
      const passageHash = hash(passage || `source:${sourceId}:no-passage`);
      const result: any = await db<any>("rpc/add_claim_evidence", {
        method: "POST",
        body: {
          p_idempotency_key: key,
          p_request_hash: requestHash,
          p_story_id: storyId,
          p_claim_id: claimId,
          p_source_id: sourceId,
          p_passage: passage || null,
          p_passage_hash: passageHash,
          p_passage_location: location || null,
          p_is_contradiction: isContradiction,
        },
      });
      const status = Number(result?.status ?? 500);
      const responseBody = result?.body ?? { error: "invalid_rpc_response" };
      return json({ ...responseBody, replayed: result?.replayed === true }, status);
    }

    if (b.action === "decide_claim") {
      const claimId = clean(b.claimId), outcome = clean(b.outcome), notes = clean(b.notes);
      const contradictionResolution = clean(b.contradictionResolution);
      if (exceeds(b.notes, 400) || exceeds(b.contradictionResolution, 1000)) return json({ error: "field_too_long", detail: "Reviewer notes are limited to 400 characters and contradiction rationale to 1,000. Nothing was truncated or saved." }, 400);
      if (!UUID.test(claimId) || !OUTCOMES.includes(outcome)) return json({ error: "bad_decision" }, 400);
      if (outcome === "SUPPORTED" || outcome === "PARTIALLY_SUPPORTED") {
        const [claimRows, policies] = await Promise.all([
          db<any[]>(`claims?id=eq.${claimId}&story_id=eq.${storyId}&select=id,claim_evidence(passage,extraction_status,is_contradiction,retrieved_sources(registry_id))&limit=1`),
          loadContentPolicies(),
        ]);
        const accessibleSupport = (claimRows[0]?.claim_evidence ?? []).some((e: any) =>
          typeof e.retrieved_sources?.registry_id === "string" &&
          canUsePassageEvidence(policyForSource(policies.rows, e.retrieved_sources.registry_id)) &&
          e.passage && e.extraction_status === "extracted" && !e.is_contradiction
        );
        if (!accessibleSupport) return json({
          error: "no_accessible_supporting_evidence",
          detail: "A supported decision requires an extracted supporting passage from a source explicitly permitted by its current content-access policy.",
        }, 409);
      }

      const key = req.headers.get("idempotency-key") ?? "";
      if (!UUID.test(key)) return json({ error: "idempotency_key_required", detail: "A valid Idempotency-Key UUID is required. Retry the same decision using the same key." }, 400);
      const canonical = JSON.stringify({
        storyId,
        claimId,
        outcome,
        notes,
        contradictionResolution,
      });
      const requestHash = createHash("sha256").update(canonical).digest("hex");

      const result: any = await db<any>("rpc/record_claim_verification_decision", {
        method: "POST",
        body: {
          p_idempotency_key: key,
          p_request_hash: requestHash,
          p_story_id: storyId,
          p_claim_id: claimId,
          p_outcome: outcome,
          p_reviewer_notes: notes,
          p_contradiction_resolution: contradictionResolution,
        },
      });
      const status = Number(result?.status ?? 500);
      const responseBody = result?.body ?? { error: "invalid_rpc_response" };
      return json({ ...responseBody, replayed: result?.replayed === true }, status);
    }

    if (b.action === "complete_story") {
      if (b.acknowledged !== true) return json({ error: "acknowledgement_required" }, 400);
      const clearance = await accessibleClaimClearance(storyId);
      if (!clearance.ready) return json({
        error: "claim_clearance_incomplete",
        detail: "The claim register is incomplete or its passages are not currently permitted by source content policy.",
        blocked: clearance.blocked,
      }, 409);
      const key = req.headers.get("idempotency-key") ?? "";
      if (!UUID.test(key)) return json({ error: "idempotency_key_required", detail: "A valid Idempotency-Key UUID is required. Retry the same clearance request with the same key." }, 400);
      const canonical = JSON.stringify({ storyId, acknowledged: true });
      const requestHash = createHash("sha256").update(canonical).digest("hex");
      const result: any = await db<any>("rpc/complete_story_verification", {
        method: "POST",
        body: {
          p_idempotency_key: key,
          p_request_hash: requestHash,
          p_story_id: storyId,
          p_acknowledged: true,
        },
      });
      const status = Number(result?.status ?? 500);
      const responseBody = result?.body ?? { error: "invalid_rpc_response" };
      return json({ ...responseBody, replayed: result?.replayed === true }, status);
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    if (e instanceof DbError) return json({ error: "database", detail: e.message }, e.status);
    return json({ error: "server_error" }, 500);
  }
};

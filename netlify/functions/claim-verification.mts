// Human claim verification API. All writes require the signed editor session.
import { createHash } from "node:crypto";
import { hasSameOrigin, isAuthenticated } from "../lib/session.mts";
import { db, DbError } from "../lib/db.mts";
import { formatReviewerNotes, hasContradictionReconciliation } from "../lib/claim-clearance.mts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OUTCOMES = ["SUPPORTED", "PARTIALLY_SUPPORTED", "CONTRADICTED", "INSUFFICIENT_EVIDENCE", "UNVERIFIED", "NOT_APPLICABLE"];
const hash = (s: string) => createHash("sha256").update(s.trim().toLowerCase()).digest("hex");
const clean = (s: unknown) => typeof s === "string" ? s.trim() : "";
const exceeds = (s: unknown, max: number) => typeof s === "string" && s.trim().length > max;

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
      const claims = await db<any[]>(`claims?story_id=eq.${storyId}&select=id,claim_text,category,created_at,claim_evidence(id,source_id,passage,passage_location,is_contradiction,extraction_status,retrieved_sources(id,title,url,publisher,content_status,source_registry(name,publisher))),verification_results(id,outcome,determined_by,reviewer_notes,created_at)&order=created_at.asc`);
      const sources = await db<any[]>(`story_source_links?story_id=eq.${storyId}&select=role,retrieved_sources(id,title,url,publisher,published_at,content_status,source_registry(name,publisher))`);
      return json({ story: stories[0], claims, sources: sources.filter(x=>x.retrieved_sources).map(x=>({ ...x.retrieved_sources, linkRole:x.role })) });
    }
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    let b: any;
    try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
    const storyId = clean(b.storyId, 36);
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

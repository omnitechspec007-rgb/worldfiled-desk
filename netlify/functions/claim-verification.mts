// Human claim verification API. All writes require the signed editor session.
import { createHash } from "node:crypto";
import { isAuthenticated } from "../lib/session.mts";
import { db, DbError } from "../lib/db.mts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OUTCOMES = ["SUPPORTED", "PARTIALLY_SUPPORTED", "CONTRADICTED", "INSUFFICIENT_EVIDENCE", "UNVERIFIED", "NOT_APPLICABLE"];
const hash = (s: string) => createHash("sha256").update(s.trim().toLowerCase()).digest("hex");
const clean = (s: unknown, max: number) => typeof s === "string" ? s.trim().slice(0, max) : "";

export default async (req: Request) => {
  if (!isAuthenticated(req)) return json({ error: "unauthorized" }, 401);
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
      const claimText = clean(b.claimText, 1200);
      const category = clean(b.category, 80) || "factual";
      if (claimText.length < 8) return json({ error: "claim_too_short" }, 400);
      const rows = await db<any[]>(`claims?on_conflict=story_id,claim_hash&select=id,claim_text,category,created_at`, { method: "POST", body: { story_id: storyId, claim_text: claimText, claim_hash: hash(claimText), category, extraction_status: "pending" }, prefer: "resolution=merge-duplicates,return=representation" });
      await db("stories?id=eq." + storyId, { method: "PATCH", body: { verification_status: "in_progress", updated_at: new Date().toISOString() }, prefer: "return=minimal" });
      return json({ claim: rows[0], note: "Claim saved. It remains unverified until sources and an editor decision are recorded." });
    }

    if (b.action === "add_evidence") {
      const claimId = clean(b.claimId, 36), sourceId = clean(b.sourceId, 36);
      const passage = clean(b.passage, 4000), location = clean(b.location, 300);
      if (!UUID.test(claimId) || !UUID.test(sourceId)) return json({ error: "bad_reference" }, 400);
      const claim = await db<any[]>(`claims?id=eq.${claimId}&story_id=eq.${storyId}&select=id`);
      if (!claim[0]) return json({ error: "claim_not_found" }, 404);
      const linked = await db<any[]>(`story_source_links?story_id=eq.${storyId}&source_id=eq.${sourceId}&select=source_id`);
      if (!linked[0]) return json({ error: "source_not_linked_to_story" }, 400);
      const source = await db<any[]>(`retrieved_sources?id=eq.${sourceId}&select=id,published_at`);
      if (!source[0]) return json({ error: "source_not_found" }, 404);
      const fingerprint = hash(passage || `source:${sourceId}:no-passage`);
      const rows = await db<any[]>(`claim_evidence?on_conflict=claim_id,source_id,passage_hash&select=id,claim_id,source_id,passage,passage_location,is_contradiction,extraction_status`, { method: "POST", body: { claim_id: claimId, source_id: sourceId, passage: passage || null, passage_hash: fingerprint, passage_location: location || null, source_published_at: source[0].published_at, extraction_status: passage ? "extracted" : "inaccessible", is_contradiction: Boolean(b.isContradiction) }, prefer: "resolution=merge-duplicates,return=representation" });
      await db("stories?id=eq." + storyId, { method: "PATCH", body: { verification_status: "in_progress", updated_at: new Date().toISOString() }, prefer: "return=minimal" });
      return json({ evidence: rows[0], note: passage ? "Evidence passage saved. The editor must assess what it supports." : "Source linked without an extracted passage. This is a lead, not supporting evidence." });
    }

    if (b.action === "decide_claim") {
      const claimId = clean(b.claimId, 36), outcome = clean(b.outcome, 40), notes = clean(b.notes, 1500);
      if (!UUID.test(claimId) || !OUTCOMES.includes(outcome)) return json({ error: "bad_decision" }, 400);
      const claim = await db<any[]>(`claims?id=eq.${claimId}&story_id=eq.${storyId}&select=id`);
      if (!claim[0]) return json({ error: "claim_not_found" }, 404);
      const evidence = await db<any[]>(`claim_evidence?claim_id=eq.${claimId}&select=id,passage,extraction_status,is_contradiction`);
      const qualifyingEvidence = evidence.some((e:any) => e.passage && e.extraction_status === "extracted");
      if (!qualifyingEvidence && outcome === "SUPPORTED") return json({ error: "supported_claim_requires_checked_passage" }, 400);
      const result = await db<any[]>(`verification_results?select=id,claim_id,outcome,determined_by,reviewer_notes,created_at`, { method: "POST", body: { claim_id: claimId, outcome, determined_by: "editor", reviewer_notes: notes || null }, prefer: "return=representation" });
      await db("stories?id=eq." + storyId, { method: "PATCH", body: { verification_status: outcome === "CONTRADICTED" ? "failed" : "in_progress", updated_at: new Date().toISOString() }, prefer: "return=minimal" });
      return json({ result: result[0], note: "Decision recorded in the verification history. Story-level clearance remains a separate step." });
    }

    if (b.action === "complete_story") {
      if (b.acknowledged !== true) return json({ error: "acknowledgement_required" }, 400);
      const claims = await db<any[]>(`claims?story_id=eq.${storyId}&select=id,claim_evidence(id,passage,extraction_status),verification_results(outcome,created_at)`);
      if (!claims.length) return json({ error: "no_material_claims_recorded" }, 400);
      const latest = (items: any[]) => [...(items ?? [])].sort((a,b)=>String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))[0];
      const unresolved = claims.filter(c => {
        const decision = latest(c.verification_results ?? []);
        const hasPassage = (c.claim_evidence ?? []).some((e:any)=>e.passage && e.extraction_status === "extracted");
        return !decision || decision.outcome !== "SUPPORTED" || !hasPassage;
      });
      if (unresolved.length) return json({ error: "claims_unresolved", unresolvedCount: unresolved.length, note: "Every recorded material claim needs an editor decision of SUPPORTED and at least one extracted evidence passage. Contradicted or incomplete claims block clearance." }, 409);
      await db("stories?id=eq." + storyId, { method: "PATCH", body: { verification_status: "verified", updated_at: new Date().toISOString() }, prefer: "return=minimal" });
      return json({ verificationStatus: "verified", note: "Story marked verified for the claims recorded. The editor confirmed the material-claim list is complete." });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    if (e instanceof DbError) return json({ error: "database", detail: e.message }, e.status);
    return json({ error: "server_error" }, 500);
  }
};

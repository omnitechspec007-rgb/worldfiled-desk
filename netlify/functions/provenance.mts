// Read-only source provenance explorer. No inference, backfill or mutation occurs here.
import { createHash } from "node:crypto";
import { hasSameOrigin, isAuthenticated } from "../lib/session.mts";
import { db, DbError } from "../lib/db.mts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

type Source = {
  id: string; name: string; publisher: string | null; country_scope: string | null;
  category: string | null; feed_url: string | null; source_type: string | null;
  retrieval_status: string; last_checked_at: string | null; last_success_at: string | null;
  last_error: string | null;
};
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const chunks = <T,>(values: T[], size: number) =>
  Array.from({ length: Math.ceil(values.length / size) }, (_, i) => values.slice(i * size, (i + 1) * size));

const RELATIONSHIPS = new Set(["same_owner","owned_by","subsidiary_of","syndicates_from","republishes","licensed_from","partner","aggregates","official_source_for","other"]);
const validUrl = (value: string) => {
  try { const url = new URL(value); return url.protocol === "https:" && Boolean(url.hostname); }
  catch { return false; }
};

export default async (req: Request) => {
  if (!isAuthenticated(req)) return json({ error: "unauthorized" }, 401);
  if (req.method === "POST" && !hasSameOrigin(req)) return json({ error: "origin_mismatch" }, 403);

  if (req.method === "POST") {
    let body: any;
    try {
      const raw = await req.text();
      if (raw.length > 7000) return json({ error: "too_large" }, 413);
      body = JSON.parse(raw);
    } catch { return json({ error: "bad_request" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.action !== "string") return json({ error: "bad_request" }, 400);

    const key = req.headers.get("idempotency-key") ?? "";
    if (!UUID.test(key)) return json({ error: "idempotency_key_required", detail: "A valid Idempotency-Key UUID is required. Retry the same operation with the same key." }, 400);
    const statusSet = new Set(["unverified","verified","disputed","rejected"]);
    const originSet = new Set(["original_reporting","wire_copy","syndicated","republished","press_release","official_document","aggregator","other","unknown"]);
    const policySet = new Set(["blocked","metadata_only","extraction_allowed"]);
    const optionalText = (field: string, max: number) => {
      const value = body[field];
      if (value !== undefined && value !== null && typeof value !== "string") throw new Error("invalid_" + field);
      const trimmed = typeof value === "string" ? value.trim() : "";
      if (trimmed.length > max) throw new Error("too_long_" + field);
      return trimmed;
    };
    const requiredUuid = (field: string) => typeof body[field] === "string" && UUID.test(body[field]);
    const optionalUuid = (field: string) => body[field] === undefined || body[field] === null || body[field] === "" || (typeof body[field] === "string" && UUID.test(body[field]));
    const validateEvidence = (value: string) => !value || (value.length <= 2000 && validUrl(value));
    let rpc = "";
    let canonical: Record<string, unknown>;
    let params: Record<string, unknown>;
    try {
      if (body.action === "create_relationship_candidate") {
        const allowed = new Set(["action","sourceId","relatedSourceId","relationshipType","evidenceUrl","reviewNotes"]);
        if (Object.keys(body).some((field) => !allowed.has(field))) return json({ error: "unexpected_field" }, 400);
        if (!requiredUuid("sourceId") || !requiredUuid("relatedSourceId") || body.sourceId === body.relatedSourceId ||
            typeof body.relationshipType !== "string" || !RELATIONSHIPS.has(body.relationshipType)) return json({ error: "invalid_relationship_candidate" }, 400);
        const evidenceUrl = optionalText("evidenceUrl", 2000);
        const reviewNotes = optionalText("reviewNotes", 1200);
        if (!validateEvidence(evidenceUrl)) return json({ error: "invalid_evidence_url", detail: "Evidence links must be valid HTTPS URLs no longer than 2,000 characters." }, 400);
        if (!evidenceUrl && !reviewNotes) return json({ error: "evidence_or_rationale_required" }, 400);
        canonical = { action: body.action, sourceId: body.sourceId, relatedSourceId: body.relatedSourceId, relationshipType: body.relationshipType, evidenceUrl, reviewNotes };
        rpc = "create_publication_relationship_candidate";
        params = {
          p_source_id: body.sourceId, p_related_source_id: body.relatedSourceId,
          p_relationship_type: body.relationshipType, p_evidence_url: evidenceUrl, p_review_notes: reviewNotes,
        };
      } else if (body.action === "review_relationship") {
        const allowed = new Set(["action","relationshipId","reviewStatus","evidenceUrl","reviewNotes"]);
        if (Object.keys(body).some((field) => !allowed.has(field))) return json({ error: "unexpected_field" }, 400);
        if (!requiredUuid("relationshipId") || typeof body.reviewStatus !== "string" || !statusSet.has(body.reviewStatus)) return json({ error: "invalid_relationship_review" }, 400);
        const evidenceUrl = optionalText("evidenceUrl", 2000);
        const reviewNotes = optionalText("reviewNotes", 1200);
        if (!validateEvidence(evidenceUrl)) return json({ error: "invalid_evidence_url" }, 400);
        if (!evidenceUrl && !reviewNotes) return json({ error: "evidence_or_rationale_required" }, 400);
        canonical = { action: body.action, relationshipId: body.relationshipId, reviewStatus: body.reviewStatus, evidenceUrl, reviewNotes };
        rpc = "review_publication_relationship";
        params = { p_relationship_id: body.relationshipId, p_review_status: body.reviewStatus, p_evidence_url: evidenceUrl, p_review_notes: reviewNotes };
      } else if (body.action === "review_article_lineage") {
        const allowed = new Set(["action","lineageId","originType","reviewStatus","upstreamRetrievedSourceId","upstreamSourceRegistryId","upstreamUrl","evidenceUrl","reviewNotes"]);
        if (Object.keys(body).some((field) => !allowed.has(field))) return json({ error: "unexpected_field" }, 400);
        if (!requiredUuid("lineageId") || typeof body.originType !== "string" || !originSet.has(body.originType) ||
            typeof body.reviewStatus !== "string" || !statusSet.has(body.reviewStatus) ||
            !optionalUuid("upstreamRetrievedSourceId") || !optionalUuid("upstreamSourceRegistryId")) return json({ error: "invalid_article_lineage_review" }, 400);
        const upstreamUrl = optionalText("upstreamUrl", 2000);
        const evidenceUrl = optionalText("evidenceUrl", 2000);
        const reviewNotes = optionalText("reviewNotes", 1200);
        if (!validateEvidence(upstreamUrl) || !validateEvidence(evidenceUrl)) return json({ error: "invalid_evidence_url" }, 400);
        if (!evidenceUrl && !reviewNotes) return json({ error: "evidence_or_rationale_required" }, 400);
        canonical = {
          action: body.action, lineageId: body.lineageId, originType: body.originType, reviewStatus: body.reviewStatus,
          upstreamRetrievedSourceId: body.upstreamRetrievedSourceId || null,
          upstreamSourceRegistryId: body.upstreamSourceRegistryId || null,
          upstreamUrl, evidenceUrl, reviewNotes,
        };
        rpc = "review_article_lineage";
        params = {
          p_lineage_id: body.lineageId, p_origin_type: body.originType, p_review_status: body.reviewStatus,
          p_upstream_retrieved_source_id: body.upstreamRetrievedSourceId || null,
          p_upstream_source_registry_id: body.upstreamSourceRegistryId || null,
          p_upstream_url: upstreamUrl, p_evidence_url: evidenceUrl, p_review_notes: reviewNotes,
        };
      } else {
        return json({ error: "unknown_provenance_action" }, 400);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      return json({ error: message.startsWith("too_long_") ? "field_too_long" : "invalid_field" }, 400);
    }

    const requestHash = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
    try {
      const result: any = await db<any>(`rpc/${rpc}`, {
        method: "POST",
        body: { p_idempotency_key: key, p_request_hash: requestHash, ...params },
      });
      const status = Number(result?.status ?? 500);
      const responseBody = result?.body ?? { error: "invalid_rpc_response" };
      return json({ ...responseBody, replayed: result?.replayed === true }, status);
    } catch (e) {
      if (e instanceof DbError) return json({ error: "database", detail: e.message, outcome: "unknown", retryWithSameKey: true }, e.status);
      return json({ error: "server_error", outcome: "unknown", retryWithSameKey: true }, 500);
    }
  }
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  try {
    const sources = await db<Source[]>(
      "source_registry?select=id,name,publisher,country_scope,category,feed_url,source_type,retrieval_status,last_checked_at,last_success_at,last_error&order=name.asc&limit=250"
    );
    const [policies, relationships, lineage, revisionRows] = await Promise.all([
      db<any[]>("source_content_policies?select=source_id,policy,policy_reason,evidence_url,reviewed_at,reviewed_by,updated_at&limit=500"),
      db<any[]>("publication_relationships?select=id,source_id,related_source_id,relationship_type,review_status,evidence_url,review_notes,reviewed_at,reviewed_by,updated_at&order=updated_at.desc&limit=500"),
      db<any[]>("article_lineage?select=id,retrieved_source_id,upstream_retrieved_source_id,upstream_source_registry_id,upstream_url,origin_type,review_status,evidence_url,review_notes,reviewed_at,reviewed_by,updated_at&order=updated_at.desc&limit=500"),
      db<any[]>("source_provenance_state?select=revision,updated_at&limit=1").catch((e) => {
        if (e instanceof DbError && e.upstream === 404) return [];
        throw e;
      }),
    ]);
    const retrievedIds = [...new Set(lineage.flatMap((item) => [item.retrieved_source_id, item.upstream_retrieved_source_id]).filter((id) => typeof id === "string" && UUID.test(id)))];
    const retrieved = new Map<string, any>();
    for (const part of chunks(retrievedIds, 50)) {
      const rows = await db<any[]>(`retrieved_sources?id=in.(${part.join(",")})&select=id,title,url,publisher,published_at,retrieved_at,content_status&limit=100`);
      for (const row of rows) retrieved.set(row.id, row);
    }
    const sourceMap = new Map(sources.map((source) => [source.id, source]));
    const policyMap = new Map(policies.map((policy) => [policy.source_id, policy]));
    return json({
      installed: true,
      revision: revisionRows[0]?.revision ?? null,
      updatedAt: revisionRows[0]?.updated_at ?? null,
      totals: {
        sources: sources.length,
        policies: policies.length,
        relationships: relationships.length,
        lineage: lineage.length,
        unreviewedRelationships: relationships.filter((r) => r.review_status === "unverified").length,
        unreviewedLineage: lineage.filter((r) => r.review_status === "unverified").length,
      },
      sources: sources.map((source) => ({
        ...source,
        contentPolicy: policyMap.get(source.id) ?? {
          policy: "metadata_only", policy_reason: null, evidence_url: null, reviewed_at: null, reviewed_by: null,
        },
      })),
      relationships: relationships.map((edge) => ({
        ...edge, source: sourceMap.get(edge.source_id) ?? null, relatedSource: sourceMap.get(edge.related_source_id) ?? null,
      })),
      lineage: lineage.map((edge) => ({
        ...edge,
        article: retrieved.get(edge.retrieved_source_id) ?? null,
        upstreamArticle: edge.upstream_retrieved_source_id ? retrieved.get(edge.upstream_retrieved_source_id) ?? null : null,
        upstreamPublisher: edge.upstream_source_registry_id ? sourceMap.get(edge.upstream_source_registry_id) ?? null : null,
      })),
    });
  } catch (e) {
    if (e instanceof DbError) {
      if (e.upstream === 404) return json({
        installed: false,
        error: "provenance_schema_not_installed",
        detail: "The source-provenance review migrations are not installed in the connected database. No data was changed.",
      });
      return json({ error: "database", detail: e.message }, e.status);
    }
    return json({ error: "server_error" }, 500);
  }
};

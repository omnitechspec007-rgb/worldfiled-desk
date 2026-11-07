// Read-only source provenance explorer. No inference, backfill or mutation occurs here.
import { isAuthenticated } from "../lib/session.mts";
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
const UUID = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const chunks = <T,>(values: T[], size: number) =>
  Array.from({ length: Math.ceil(values.length / size) }, (_, i) => values.slice(i * size, (i + 1) * size));

export default async (req: Request) => {
  if (!isAuthenticated(req)) return json({ error: "unauthorized" }, 401);
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  try {
    const sources = await db<Source[]>(
      "source_registry?select=id,name,publisher,country_scope,category,feed_url,source_type,retrieval_status,last_checked_at,last_success_at,last_error&order=name.asc&limit=250"
    );
    const sourceIds = sources.map((s) => s.id).filter((id) => UUID.test(id));
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

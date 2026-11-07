import { db, DbError } from "./db.mts";

// Content-access policy semantics shared by discovery, clustering and ranking.
// A missing policy row is deliberately metadata-only; malformed policy data fails closed.
export const CONTENT_POLICIES = ["blocked", "metadata_only", "extraction_allowed"] as const;
export type ContentPolicy = (typeof CONTENT_POLICIES)[number];

export type ContentPolicyRow = { source_id: string; policy: string };

export function policyForSource(rows: ContentPolicyRow[], sourceId: string): ContentPolicy {
  const row = rows.find((item) => item.source_id === sourceId);
  if (!row) return "metadata_only";
  return CONTENT_POLICIES.includes(row.policy as ContentPolicy) ? row.policy as ContentPolicy : "blocked";
}

export function canRetrieveMetadata(policy: ContentPolicy): boolean {
  return policy !== "blocked";
}

// This pipeline currently reads feed metadata only. Even extraction_allowed does not
// authorize a full-article fetch here; it is a policy prerequisite for a future extractor.
export function retrievalContentStatus(_policy: ContentPolicy): "metadata_only" {
  return "metadata_only";
}

export async function loadContentPolicies(): Promise<ContentPolicyRow[]> {
  try {
    return await db<ContentPolicyRow[]>("source_content_policies?select=source_id,policy&limit=1000");
  } catch (error) {
    // Before migration 012 exists, no reviewed policy rows can exist. The safe default is
    // metadata-only; any other database failure stops the caller rather than bypassing policy.
    if (error instanceof DbError && error.upstream === 404) return [];
    throw error;
  }
}

// Full-text passages may be stored as verification evidence only after an explicit
// extraction_allowed review. Metadata-only sources can still be used as discovery leads.
export function canUsePassageEvidence(policy: ContentPolicy): boolean {
  return policy === "extraction_allowed";
}

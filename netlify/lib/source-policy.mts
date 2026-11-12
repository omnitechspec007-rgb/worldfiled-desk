import { db, DbError } from "./db.mts";

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

export function canUsePassageEvidence(policy: ContentPolicy): boolean {
  return policy === "extraction_allowed";
}

/** The discovery pipeline currently stores feed metadata only; extraction_allowed is a prerequisite for a future article extractor, not a command to fetch full text. */
export function retrievalContentStatus(_policy: ContentPolicy): "metadata_only" {
  return "metadata_only";
}

export async function loadContentPolicies(): Promise<{ rows: ContentPolicyRow[]; installed: boolean }> {
  try {
    return {
      rows: await db<ContentPolicyRow[]>("source_content_policies?select=source_id,policy&limit=1000"),
      installed: true,
    };
  } catch (error) {
    // Before the explicit policy table exists, no source is authorized for stored passage evidence.
    if (error instanceof DbError && error.upstream === 404) return { rows: [], installed: false };
    throw error;
  }
}

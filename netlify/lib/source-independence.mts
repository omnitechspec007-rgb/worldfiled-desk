export type IndependenceSource = {
  outlet: string;
  sourceRegistryId?: string | null;
  retrievedSourceId?: string | null;
  ownershipStatus?: string | null;
  publisherGroupKey?: string | null;
  originType?: string | null;
  originStatus?: string | null;
  upstreamSourceRegistryId?: string | null;
  upstreamRetrievedSourceId?: string | null;
  upstreamUrl?: string | null;
};

export type IndependenceSummary = {
  namedOutlets: number;
  confirmedIndependentOrigins: number;
  confirmedSharedOrigins: number;
  status: "confirmed_independent" | "known_shared_origin" | "partially_verified" | "unknown";
  explanation: string;
};

/**
 * Conservative corroboration summary.
 * Only reviewed ownership groups AND verified original-reporting lineage count as
 * confirmed independent origins. Unknown/unreviewed records never become evidence
 * of independence. Verified wire/syndicated/republished records are treated as
 * shared-origin evidence, not another independent report.
 */
export function summarizeSourceIndependence(sources: IndependenceSource[]): IndependenceSummary {
  const namedOutlets = new Set(sources.map((s) => s.outlet.trim().toLowerCase()).filter(Boolean)).size;
  const independent = new Set<string>();
  const shared = new Set<string>();
  let unknown = 0;

  for (const source of sources) {
    const ownershipVerified = source.ownershipStatus === "verified" && !!source.publisherGroupKey?.trim();
    const originVerified = source.originStatus === "verified" && !!source.originType && source.originType !== "unknown";
    if (!ownershipVerified || !originVerified) {
      unknown++;
      continue;
    }
    if (source.originType === "original_reporting") {
      independent.add(source.publisherGroupKey!.trim());
      continue;
    }
    const upstream = source.upstreamSourceRegistryId?.trim()
      || source.upstreamRetrievedSourceId?.trim()
      || source.upstreamUrl?.trim();
    if (upstream) shared.add(upstream);
    else unknown++;
  }

  const confirmedIndependentOrigins = independent.size;
  const confirmedSharedOrigins = shared.size;
  let status: IndependenceSummary["status"] = "unknown";
  let explanation = "Publisher ownership or article origin has not been sufficiently verified. Distinct outlet names are not proof of independent reporting.";
  if (confirmedIndependentOrigins >= 2) {
    status = "confirmed_independent";
    explanation = confirmedIndependentOrigins + " verified publisher groups have verified original-reporting lineage. This supports independent reporting, but does not by itself prove every claim.";
  } else if (confirmedIndependentOrigins === 1 && (unknown > 0 || confirmedSharedOrigins > 0)) {
    status = "partially_verified";
    explanation = "At least one independent reporting origin is verified, but the remaining sources are unknown or trace to shared origins. Do not describe this as multi-outlet independent corroboration.";
  } else if (confirmedIndependentOrigins === 1 && unknown === 0) {
    status = "known_shared_origin";
    explanation = "The reviewed reports resolve to one verified publisher group. Different outlet names must not be treated as independent publisher corroboration.";
  } else if (confirmedIndependentOrigins === 0 && confirmedSharedOrigins > 0 && unknown === 0) {
    status = "known_shared_origin";
    explanation = "The reviewed article lineage traces these reports to upstream sources; outlet count must not be treated as independent corroboration.";
  }
  return { namedOutlets, confirmedIndependentOrigins, confirmedSharedOrigins, status, explanation };
}

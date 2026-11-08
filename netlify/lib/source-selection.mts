/**
 * Source eligibility for the discovery pipeline.
 * Feed health is a technical check, not proof that a publisher or its claims are reliable.
 * Fresh built-in candidates may be probed once; only explicitly enabled healthy sources
 * may flow into clustering and scoring.
 */
export type SourceHealthRow = {
  id: string;
  enabled?: boolean;
  retrieval_status?: string;
  feed_url?: unknown;
  reliability_note?: string | null;
};

export function shouldProbeSource(source: SourceHealthRow): boolean {
  if (typeof source.feed_url !== "string" || !source.feed_url.trim()) return false;
  if (source.retrieval_status === "healthy") return source.enabled === true;
  if (source.enabled === true && ["failing", "degraded"].includes(source.retrieval_status ?? "")) return true;
  if (source.enabled === false && ["failing", "degraded"].includes(source.retrieval_status ?? "")) return true;
  return source.retrieval_status === "untested"
    && source.enabled === false
    && /built-in candidate/i.test(source.reliability_note ?? "");
}

export function canUseSourceForResearch(source: SourceHealthRow): boolean {
  return source.enabled === true && source.retrieval_status === "healthy";
}

export function eligibleResearchSourceIds<T extends SourceHealthRow>(sources: T[]): Set<string> {
  return new Set(sources.filter(canUseSourceForResearch).map((source) => source.id));
}

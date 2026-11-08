export type ResearchSourceResult = {
  name: string;
  status: string;
  items?: number;
  newItems?: number;
  refreshedItems?: number;
  error?: string | null;
  policy?: string | null;
};

export type ResearchReport = {
  coverage: "complete" | "limited" | "incomplete";
  checked: number;
  total: number;
  reachable: number;
  needsAttention: number;
  policyBlocked: number;
  items: number;
  newItems: number;
  refreshedItems: number;
  sources: ResearchSourceResult[];
  note: string;
};

export function buildResearchReport(detail: Record<string, any> = {}): ResearchReport {
  const raw = detail.results && typeof detail.results === "object" ? detail.results : {};
  const sources = Object.values(raw).map((value: any) => ({
    name: String(value?.name ?? "Unnamed source"),
    status: String(value?.status ?? "unknown"),
    items: Number.isFinite(Number(value?.items)) ? Number(value.items) : 0,
    newItems: Number.isFinite(Number(value?.newItems)) ? Number(value.newItems) : 0,
    refreshedItems: Number.isFinite(Number(value?.refreshedItems)) ? Number(value.refreshedItems) : 0,
    error: typeof value?.error === "string" ? value.error : null,
    policy: typeof value?.policy === "string" ? value.policy : null,
  })).sort((a, b) => a.name.localeCompare(b.name));

  const checked = Number.isFinite(Number(detail.finished)) ? Number(detail.finished) : sources.length;
  const total = Number.isFinite(Number(detail.total)) ? Number(detail.total) : checked;
  const reachable = sources.filter((source) => source.status === "healthy").length;
  const policyBlocked = sources.filter((source) => source.status === "blocked").length;
  const needsAttention = sources.filter((source) => !["healthy", "blocked"].includes(source.status)).length;
  const coverage = checked < total
    ? "incomplete"
    : needsAttention > 0 || policyBlocked > 0
      ? "limited"
      : "complete";
  const items = sources.reduce((sum, source) => sum + source.items, 0);
  const newItems = sources.reduce((sum, source) => sum + source.newItems, 0);
  const refreshedItems = sources.reduce((sum, source) => sum + source.refreshedItems, 0);
  const note = coverage === "incomplete"
    ? `Only ${checked} of ${total} configured sources have been checked. This research coverage is incomplete.`
    : coverage === "limited"
      ? `${needsAttention} sources need attention and ${policyBlocked} were skipped by source policy. Treat this as limited coverage, not a complete view of the news.`
      : "All configured sources were checked successfully. This does not mean every news source or every event worldwide was covered.";

  return { coverage, checked, total, reachable, needsAttention, policyBlocked, items, newItems, refreshedItems, sources, note };
}

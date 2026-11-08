// Descriptive performance summaries only. Never predicts views or compares unlike platforms/formats.
export type PublicationMetric = {
  publicationId: string;
  platform: string;
  contentFormat: string;
  views: number | null;
  averageViewDurationSeconds: number | null;
  completionRate: number | null;
  shares: number | null;
  saves: number | null;
};

export type PerformanceCohort = {
  platform: string;
  contentFormat: string;
  publicationCount: number;
  sampleLabel: "too_few_to_interpret" | "early_signal" | "usable_pattern";
  metrics: {
    views: { median: number | null; measured: number };
    averageViewDurationSeconds: { median: number | null; measured: number };
    completionRate: { median: number | null; measured: number };
    shareRate: { median: number | null; measured: number };
    saveRate: { median: number | null; measured: number };
  };
  note: string;
};

function median(values: number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function valid(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function rate(numerator: number | null, denominator: number | null): number | null {
  return valid(numerator) && valid(denominator) && denominator > 0 ? numerator / denominator : null;
}

export function summarizePerformanceCohorts(
  rows: PublicationMetric[],
  minimumUsableSample = 5,
): PerformanceCohort[] {
  if (!Number.isInteger(minimumUsableSample) || minimumUsableSample < 2) {
    throw new Error("minimumUsableSample must be an integer of at least 2");
  }
  const groups = new Map<string, PublicationMetric[]>();
  for (const row of rows) {
    if (!row.publicationId || !row.platform || !row.contentFormat) continue;
    const key = JSON.stringify([row.platform, row.contentFormat]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].map(([key, group]) => {
    const [platform, contentFormat] = JSON.parse(key) as [string, string];
    const measured = (pick: (r: PublicationMetric) => number | null) =>
      group.map(pick).filter(valid);
    const views = measured((r) => r.views);
    const durations = measured((r) => r.averageViewDurationSeconds);
    const completions = measured((r) => r.completionRate).filter((v) => v <= 1);
    const shares = group.map((r) => rate(r.shares, r.views)).filter(valid);
    const saves = group.map((r) => rate(r.saves, r.views)).filter(valid);
    const count = group.length;
    const measuredPublications = views.length;
    const sampleLabel = measuredPublications >= minimumUsableSample ? "usable_pattern" : measuredPublications >= 2 ? "early_signal" : "too_few_to_interpret";
    return {
      platform, contentFormat, publicationCount: count, sampleLabel,
      metrics: {
        views: { median: median(views), measured: views.length },
        averageViewDurationSeconds: { median: median(durations), measured: durations.length },
        completionRate: { median: median(completions), measured: completions.length },
        shareRate: { median: median(shares), measured: shares.length },
        saveRate: { median: median(saves), measured: saves.length },
      },
      note: sampleLabel === "usable_pattern"
        ? "Descriptive pattern within this platform and format only, based on " + measuredPublications + " posts with view counts; not a causal finding or view prediction."
        : sampleLabel === "early_signal"
          ? "Early signal only (" + measuredPublications + " posts have view counts). Collect more comparable publications before changing editorial strategy."
          : "Too few posts with view counts (" + measuredPublications + ") to interpret. Do not rank or change editorial strategy from this sample.",
    };
  }).sort((a, b) => a.platform.localeCompare(b.platform) || a.contentFormat.localeCompare(b.contentFormat));
}

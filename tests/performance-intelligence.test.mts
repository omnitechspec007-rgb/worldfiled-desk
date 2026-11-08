import assert from "node:assert/strict";
import { summarizePerformanceCohorts, type PublicationMetric } from "../netlify/lib/performance-intelligence.mts";

const rows: PublicationMetric[] = Array.from({ length: 5 }, (_, i) => ({
  publicationId: "p" + i, platform: "youtube", contentFormat: "narrated_video",
  views: 100 + i * 100, averageViewDurationSeconds: 20 + i,
  completionRate: 0.4 + i * 0.05, shares: 5 + i, saves: 2 + i,
}));
rows.push({ publicationId: "fb1", platform: "facebook", contentFormat: "text_card", views: 500, averageViewDurationSeconds: null, completionRate: null, shares: 20, saves: 10 });
const result = summarizePerformanceCohorts(rows);
assert.equal(result.length, 2);
const yt = result.find((x) => x.platform === "youtube")!;
assert.equal(yt.sampleLabel, "usable_pattern");
assert.equal(yt.publicationCount, 5);
assert.equal(yt.metrics.views.median, 300);
assert.equal(yt.metrics.completionRate.median, 0.5);
assert.ok(Math.abs((yt.metrics.shareRate.median ?? 0) - (7 / 300)) < 1e-10);
const fb = result.find((x) => x.platform === "facebook")!;
assert.equal(fb.sampleLabel, "too_few_to_interpret");
assert.equal(fb.metrics.completionRate.measured, 0);
assert.equal(fb.metrics.shareRate.median, 0.04);
assert.match(fb.note, /Too few/);
assert.throws(() => summarizePerformanceCohorts([], 1), /at least 2/);
assert.equal(summarizePerformanceCohorts([{ ...rows[0], views: 0, shares: 1 }])[0].metrics.shareRate.median, null);
console.log("PASS performance summaries stay within platform/format, disclose sample size, and omit invalid denominators");

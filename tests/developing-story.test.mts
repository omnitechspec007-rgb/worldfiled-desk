import assert from "node:assert/strict";
import { assessDevelopingStory } from "../netlify/lib/developing-story.mts";

const prior = [
  { id: "old-1", title: "Government considers new energy rules", summary: "Ministers are reviewing proposals.", publishedAt: "2026-11-07T08:00:00Z" },
  { id: "old-2", title: "Energy plan remains under discussion", summary: "No final decision has been announced.", publishedAt: "2026-11-07T09:00:00Z" },
];

const material = assessDevelopingStory(prior, [
  { id: "old-1", title: "Government considers new energy rules", publishedAt: "2026-11-07T08:00:00Z" },
  { id: "new-1", title: "Court blocks government energy rules", summary: "A judge issued an order on 8 November.", publishedAt: "2026-11-08T10:00:00Z" },
]);
assert.equal(material.classification, "potential_material_development");
assert.equal(material.humanReviewRequired, true);
assert.ok(material.signals.some((s) => s.kind === "legal_step"));
assert.ok(material.signals.some((s) => s.kind === "outcome"));

const coverageOnly = assessDevelopingStory(prior, [
  { id: "old-1", title: "Government considers new energy rules", publishedAt: "2026-11-07T08:00:00Z" },
  { id: "new-2", title: "More analysis of government energy proposal", summary: "Experts discuss the proposal.", publishedAt: "2026-11-08T10:00:00Z" },
]);
assert.equal(coverageOnly.classification, "new_coverage_only");
assert.equal(coverageOnly.signals.length, 0);

const notNewer = assessDevelopingStory(prior, [
  { id: "old-1", title: "Government considers new energy rules", publishedAt: "2026-11-07T08:00:00Z" },
  { id: "new-3", title: "Government energy proposal explained", publishedAt: "2026-11-07T07:00:00Z" },
]);
assert.equal(notNewer.classification, "new_coverage_only");

const missingDates = assessDevelopingStory(
  [{ id: "old-4", title: "Earlier report" }],
  [{ id: "new-4", title: "Court issues a ruling" }],
);
assert.equal(missingDates.classification, "insufficient_comparison");

const missingBaseline = assessDevelopingStory([], [
  { id: "new-5", title: "Court issues a ruling", publishedAt: "2026-11-08T10:00:00Z" },
]);
assert.equal(missingBaseline.classification, "insufficient_comparison");

const repeatedRun = assessDevelopingStory(prior, prior);
assert.equal(repeatedRun.classification, "insufficient_comparison");
console.log("developing-story follow-up tests passed");

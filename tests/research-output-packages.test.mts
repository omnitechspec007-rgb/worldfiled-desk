import assert from "node:assert/strict";
import { buildResearchOutputPackages } from "../netlify/lib/research-output-packages.mts";

function story(id: number, overrides: Record<string, any> = {}) {
  return {
    id: "00000000-0000-4000-8000-" + String(id).padStart(12, "0"),
    headline: [
      "Researchers discover an unexpected deep-sea ecosystem",
      "New court ruling changes digital privacy protections",
      "Government approves major clean energy grid expansion",
      "Scientists identify rare species in protected forest",
      "Central bank changes emergency lending rules",
      "New satellite reveals rapid changes in coastal wetlands",
      "International agency publishes new disease surveillance findings",
      "Parliament approves revised consumer protection rules",
      "Researchers develop a new battery recycling process",
      "Flood authorities change regional evacuation planning",
    ][(id - 1) % 10],
    recommendation: "HIGH-POTENTIAL STORY",
    curiosityScore: 80 - (id % 5) * 4,
    evidenceStrength: { label: "MODERATE", why: "Synthetic test fixture." },
    corroborated: true,
    whatChanged: "A sourced development occurred.",
    whyInteresting: ["A potentially surprising change."],
    audienceQuestion: "What changed and who is affected?",
    humanConsequences: "The change affects people.",
    possibleImplications: null,
    type: ["scientific_discovery", "law_regulation", "government_decision", "environmental_event"][id % 4],
    themes: [],
    locations: [{ country: ["Japan", "Canada", "Brazil", "Kenya", "United Kingdom"][id % 5] }],
    sources: [
      { outlet: "Outlet " + id + " A", url: "https://a.example/" + id, publishedAt: "2026-11-10T10:00:00Z" },
      { outlet: "Outlet " + id + " B", url: "https://b.example/" + id, publishedAt: "2026-11-10T11:00:00Z" },
    ],
    sourceIndependence: { status: "unknown", confirmedIndependentOrigins: 0, confirmedSharedOrigins: 0, explanation: "Publisher ownership and article lineage are unknown." },
    fresh: true,
    notFreshWhy: null,
    ageHours: 3 + id,
    decision: null,
    sensationalismFlags: [],
    ...overrides,
  };
}

const selected = buildResearchOutputPackages(Array.from({ length: 10 }, (_, i) => story(i + 1)));
assert.equal(selected.eligibleCount, 10);
assert.deepEqual(selected.packages.map((p) => p.key), ["text_card_1", "text_card_2", "text_card_3", "text_roundup", "daily_narrated"]);
assert.equal(selected.packages.find((p) => p.key === "text_roundup")?.storyIds.length, 7);
assert.equal(selected.packages.find((p) => p.key === "daily_narrated")?.durationSeconds, 90);
assert.equal(selected.packages.find((p) => p.key === "daily_narrated")?.storyIds.length, 4);
console.log("PASS: a strong research pool produces three text cards, a quality-gated roundup and one 90-second narrated bulletin");

const quiet = buildResearchOutputPackages([story(1), story(2), story(3)]);
assert.equal(quiet.packages.filter((p) => p.format === "text_card").length, 3);
assert.equal(quiet.packages.some((p) => p.format === "text_roundup"), false);
assert.equal(quiet.packages.find((p) => p.key === "daily_narrated")?.durationSeconds, 60);
assert.equal(quiet.packages.find((p) => p.key === "daily_narrated")?.storyIds.length, 3);
console.log("PASS: a quieter run skips roundup and shortens the narrated bulletin instead of padding");

const weak = buildResearchOutputPackages([
  story(20, { evidenceStrength: { label: "WEAK", why: "Not enough evidence." } }),
  story(21, { sensationalismFlags: ["unsupported dramatic wording"] }),
]);
assert.equal(weak.eligibleCount, 0);
assert.equal(weak.packages.length, 0);
assert.equal(weak.heldCount, 2);
console.log("PASS: weak or sensational candidates do not create production packages");

const one = buildResearchOutputPackages([story(30)]);
assert.equal(one.packages.filter((p) => p.format === "text_card").length, 1);
assert.equal(one.packages.find((p) => p.key === "daily_narrated")?.durationSeconds, 60);
console.log("PASS: a single qualifying story gets one standalone card and a shorter one-story narrated package without filler");

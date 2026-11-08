import assert from "node:assert/strict";
import { buildEditorialIntelligence, type EditorialStory } from "../src/editorial-intelligence.ts";

const make = (id: number, overrides: Partial<EditorialStory> = {}): EditorialStory => ({
  id: String(id),
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
  evidenceStrength: { label: "MODERATE", why: "Synthetic fixture with moderate evidence." },
  corroborated: true,
  whatChanged: "A sourced development occurred.",
  whyInteresting: ["A potentially surprising change."],
  audienceQuestion: "What changed and who is affected?",
  humanConsequences: id % 2 ? "The change affects households." : null,
  possibleImplications: null,
  type: ["scientific_discovery", "law_regulation", "government_decision", "environmental_event", "economic_change"][id % 5],
  themes: [],
  locations: [{ country: ["Japan", "Canada", "Brazil", "Kenya", "United Kingdom"][id % 5] }],
  sources: [
    { outlet: `Outlet ${id}A`, url: `https://a.example/${id}`, publishedAt: "2026-11-07T10:00:00Z" },
    { outlet: `Outlet ${id}B`, url: `https://b.example/${id}`, publishedAt: "2026-11-07T11:00:00Z" },
  ],
  sourceIndependence: { status: "unknown", confirmedIndependentOrigins: 0, explanation: "Publisher ownership and article lineage are unknown." },
  fresh: true,
  notFreshWhy: null,
  ageHours: id % 3 === 0 ? 5 : 12,
  decision: null,
  sensationalismFlags: [],
  ...overrides,
});

const stories = Array.from({ length: 10 }, (_, i) => make(i + 1));
const result = buildEditorialIntelligence(stories);
assert.equal(result.eligibleCount, 10);
assert.equal(result.standalonePicks.length, 5);
assert.equal(result.roundupPicks.length, 7);
assert.equal(result.narrated[0].stories.length, 3);
assert.equal(result.narrated[1].stories.length, 4);
assert.equal(result.narrated[2].stories.length, 5);
assert(result.standalonePicks.every((p) => p.score >= 0 && p.score <= 100 && p.parts.reduce((n, x) => n + x.max, 0) === 100));
assert.equal(new Set(result.roundupPicks.map((p) => p.story.id)).size, 7);
console.log("PASS: separate standalone, roundup and duration-specific narrated selections are built from the same eligible pool");

const weak = make(20, { evidenceStrength: { label: "WEAK", why: "Weak." }, curiosityScore: 100 });
const shared = make(21, { sourceIndependence: { status: "known_shared_origin", confirmedIndependentOrigins: 1, explanation: "Both reports trace to the same upstream wire origin." } });
const missingDate = make(22, { sources: [{ outlet: "Only source", url: "https://source.example/story", publishedAt: null }] });
const stale = make(23, { fresh: false, notFreshWhy: "Outside the current coverage window." });
const sensational = make(24, { sensationalismFlags: ["vague attribution"] });
const guarded = buildEditorialIntelligence([weak, shared, missingDate, stale, sensational]);
assert.equal(guarded.eligibleCount, 0);
assert.equal(guarded.held.length, 5);
assert(guarded.held.find((x) => x.story.id === "20")?.reasons.some((x) => /MODERATE/.test(x)));
assert(guarded.held.find((x) => x.story.id === "21")?.reasons.some((x) => /shared upstream/.test(x)));
assert(guarded.held.find((x) => x.story.id === "22")?.reasons.some((x) => /named publisher/.test(x)));
assert(guarded.held.find((x) => x.story.id === "23")?.reasons.some((x) => /coverage window/.test(x)));
assert(guarded.held.find((x) => x.story.id === "24")?.reasons.some((x) => /Sensational/.test(x)));
console.log("PASS: weak evidence, shared origin, missing attribution, stale and sensational candidates are held regardless of curiosity score");

const unknown = make(25, { sourceIndependence: { status: "unknown", confirmedIndependentOrigins: 0, explanation: "Unknown provenance." } });
const unknownResult = buildEditorialIntelligence([unknown]);
assert.equal(unknownResult.eligibleCount, 1);
assert(unknownResult.standalonePicks[0].reasons.some((x) => /Unknown provenance/.test(x)));
assert(unknownResult.limitations.some((x) => /not a prediction of views/.test(x)));
console.log("PASS: unknown provenance stays explicitly unknown and is not given an independence bonus");

const strongEditionOnly = make(26, { recommendation: "STRONG EDITION CANDIDATE" });
const highPotential = make(27, { recommendation: "HIGH-POTENTIAL STORY" });
const split = buildEditorialIntelligence([strongEditionOnly, highPotential]);
assert.deepEqual(split.standalonePicks.map((p) => p.story.id), ["27"]);
assert(split.standaloneNotSelected.some((p) => p.story.id === "26"));
assert(split.roundupPicks.some((p) => p.story.id === "26"));
assert(split.narrated[1].stories.some((p) => p.story.id === "26"));
console.log("PASS: standalone cards require high standalone potential while strong edition candidates remain available for roundups and narrated editions");


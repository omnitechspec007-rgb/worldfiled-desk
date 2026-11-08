/**
 * WorldFiled Editorial Intelligence — deterministic production selection.
 *
 * This is an explainable editorial hypothesis, not a claim to predict audience behaviour.
 * Evidence eligibility is a hard gate: a high curiosity score cannot compensate for weak evidence.
 */
import type { Dev } from "./EditionDesk";
export type EditorialStory = Dev;

export type ScorePart = { key: string; label: string; points: number; max: number; reason: string };
export type EditorialPick = { story: EditorialStory; score: number; parts: ScorePart[]; reasons: string[] };
export type HeldStory = { story: EditorialStory; reasons: string[] };
export type NarratedPlan = { durationSeconds: 60 | 90 | 120; stories: EditorialPick[]; estimatedStoryCount: number; rationale: string };

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const validDatedSource = (s: EditorialStory["sources"][number]) =>
  !!s.outlet?.trim() && /^https?:\/\//i.test(s.url || "") &&
  typeof s.publishedAt === "string" && /^\d{4}-\d{2}-\d{2}/.test(s.publishedAt) &&
  Number.isFinite(Date.parse(s.publishedAt));

function scoreStory(story: EditorialStory): EditorialPick {
  const age = story.ageHours;
  const curiosity = clamp(Math.round(story.curiosityScore * 0.25), 0, 25);
  const significance = story.recommendation === "HIGH-POTENTIAL STORY" ? 20 : 15;
  const novelty = story.surprisingElement ? 15 : story.whyInteresting.length > 0 ? 10 : 5;
  const human = story.humanConsequences ? 15 : story.possibleImplications ? 10 : story.audienceQuestion ? 7 : 3;
  const words = story.headline.trim().split(/\s+/).filter(Boolean).length;
  const clarity = words <= 14 ? 10 : words <= 20 ? 8 : words <= 28 ? 5 : 2;
  const timeliness = age === null ? 2 : age <= 6 ? 10 : age <= 12 ? 8 : age <= 24 ? 6 : 3;
  const visualType = /scientific|technology|environmental|unusual/.test(story.type || "") ? 5 : 3;
  const parts: ScorePart[] = [
    { key: "curiosity", label: "Curiosity", points: curiosity, max: 25, reason: `Existing curiosity assessment: ${story.curiosityScore}/100, scaled to this 25-point component.` },
    { key: "significance", label: "Significance", points: significance, max: 20, reason: story.recommendation === "HIGH-POTENTIAL STORY" ? "Existing editorial assessment identifies high standalone potential." : "Existing assessment identifies a strong edition candidate; standalone significance is more cautiously weighted." },
    { key: "novelty", label: "Novelty signal", points: novelty, max: 15, reason: story.surprisingElement ? "The existing assessment identified a possible surprising element; verify it against the source." : story.whyInteresting.length ? "The existing assessment found at least one curiosity mechanism; this remains an editorial hypothesis." : "No distinct novelty or surprise signal was found." },
    { key: "human", label: "Human relevance", points: human, max: 15, reason: story.humanConsequences ? "Retrieved text contains a human-consequence signal; editor must verify its substance." : story.possibleImplications ? "Possible implications are present but remain qualified." : "Limited direct human-impact signal in retrieved material." },
    { key: "clarity", label: "Clarity", points: clarity, max: 10, reason: `${words} headline words; this is a readability heuristic, not a quality judgement.` },
    { key: "timeliness", label: "Timeliness", points: timeliness, max: 10, reason: age === null ? "No usable publication age." : `Freshness signal based on an approximate age of ${Math.round(age)} hours.` },
    { key: "visual", label: "Visual storytelling", points: visualType, max: 5, reason: /scientific|technology|environmental|unusual/.test(story.type || "") ? "This development type may support a diagram, map or visual explanation; asset availability is not assumed." : "A basic typographic treatment is likely; no external visual asset is assumed." },
  ];
  const score = parts.reduce((sum, part) => sum + part.points, 0);
  const reasons = [
    `Editorial opportunity index: ${score}/100. A transparent ranking aid, not a measured view prediction.`,
    ...parts.map((p) => `${p.label}: ${p.points}/${p.max} — ${p.reason}`),
    story.sourceIndependence?.explanation ?? "Source independence is unknown; distinct outlet names are not proof of independent reporting.",
  ];
  return { story, score, parts, reasons };
}

function eligibilityReasons(story: EditorialStory): string[] {
  const reasons: string[] = [];
  const outlets = new Set(story.sources.map((s) => s.outlet.trim().toLowerCase()).filter(Boolean));
  if (!story.fresh) reasons.push(story.notFreshWhy || "Outside the current freshness window.");
  if (["rejected", "needs_research"].includes(story.decision || "")) reasons.push("An editor has rejected this story or sent it back for research.");
  if (!["HIGH-POTENTIAL STORY", "STRONG EDITION CANDIDATE"].includes(story.recommendation)) reasons.push("The existing editorial assessment does not rate it as a strong candidate.");
  if (story.evidenceStrength.label !== "MODERATE") reasons.push("Evidence is below the current MODERATE eligibility threshold.");
  if (outlets.size < 2) reasons.push("Fewer than two distinct named outlets were retrieved; outlet count does not prove independent reporting.");
  if (story.sourceIndependence?.status === "known_shared_origin") reasons.push("Reviewed provenance identifies a shared upstream origin; copies are not independent corroboration.");
  if (story.sensationalismFlags.length) reasons.push("Sensational or vague-attribution wording requires editorial review: " + story.sensationalismFlags.join("; "));
  if (!story.sources.some(validDatedSource)) reasons.push("No source currently has all three required attribution fields: named publisher, valid publication date and traceable HTTP(S) link.");
  return reasons;
}

/** Select for editorial variety after ranking: avoid repetitive story types and countries where alternatives exist. */
function diverseOrder(items: EditorialPick[], limit: number): EditorialPick[] {
  const remaining = [...items].sort((a, b) => b.score - a.score);
  const selected: EditorialPick[] = [];
  const types = new Set<string>();
  const places = new Set<string>();
  while (remaining.length && selected.length < limit) {
    let best = 0;
    let bestValue = -Infinity;
    remaining.forEach((candidate, index) => {
      const type = candidate.story.type || "other";
      const place = candidate.story.locations?.[0]?.country || "";
      const diversity = (types.has(type) ? -9 : 4) + (place && places.has(place) ? -6 : 2);
      const value = candidate.score + diversity;
      if (value > bestValue) { best = index; bestValue = value; }
    });
    const pick = remaining.splice(best, 1)[0];
    selected.push(pick);
    types.add(pick.story.type || "other");
    const place = pick.story.locations?.[0]?.country;
    if (place) places.add(place);
  }
  return selected;
}

export function buildEditorialIntelligence(stories: EditorialStory[]) {
  const eligible: EditorialPick[] = [];
  const held: HeldStory[] = [];
  for (const story of stories) {
    const reasons = eligibilityReasons(story);
    if (reasons.length) held.push({ story, reasons });
    else eligible.push(scoreStory(story));
  }
  const ranked = [...eligible].sort((a, b) => b.score - a.score);
  // A standalone card must be strong enough to carry a story alone. Strong edition candidates may still be useful in a roundup or narrated sequence.\n  const standalonePool = ranked.filter((p) => p.story.recommendation === "HIGH-POTENTIAL STORY");\n  const standalonePicks = standalonePool.slice(0, 5);\n  const standaloneNotSelected = ranked.filter((p) => p.story.recommendation !== "HIGH-POTENTIAL STORY");
  const roundupPicks = diverseOrder(eligible, 7);
  const narrated: NarratedPlan[] = [
    { durationSeconds: 60, stories: diverseOrder(eligible, 3), estimatedStoryCount: Math.min(3, eligible.length), rationale: "Up to three developments, leaving room for a clear opening, factual context and close. The production blueprint allocates the actual speaking time." },
    { durationSeconds: 90, stories: diverseOrder(eligible, 4), estimatedStoryCount: Math.min(4, eligible.length), rationale: "Up to four developments, with enough room for a useful explanation rather than headline-speed compression." },
    { durationSeconds: 120, stories: diverseOrder(eligible, 5), estimatedStoryCount: Math.min(5, eligible.length), rationale: "Up to five developments where the evidence and story complexity justify the longer edition." },
  ];
  const chosen = new Set([...standalonePicks, ...roundupPicks, ...narrated.flatMap((p) => p.stories)].map((p) => p.story.id));
  const notSelected = eligible.filter((p) => !chosen.has(p.story.id)).map((p) => ({
    story: p.story,
    reason: "Passed the evidence and attribution screen but was not selected for the current format caps. It remains available for manual review.",
  }));
  return {
    generatedAt: new Date().toISOString(),
    eligibleCount: eligible.length,
    standalonePicks,
    roundupPicks,
    narrated,
    held,
    notSelected,
    limitations: [
      "This is an explainable editorial hypothesis, not a prediction of views or a claim that an algorithm knows every viewer's psychology.",
      "Evidence eligibility is a hard gate; curiosity, novelty or significance cannot compensate for weak evidence.",
      "Research currently relies primarily on headlines and snippets. Editors must inspect source material and verify claims.",
      "Unknown publisher ownership or article lineage is not counted as independent corroboration.",
      "The narrated story counts are selection ceilings. The production blueprint must allocate actual runtime and may produce a shorter edition.",
    ],
  };
}

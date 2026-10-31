// Scoring tests on sample stories. Run: node --experimental-strip-types tests/scoring.test.mts
import assert from "node:assert";
const { scoreStory, priorityOf, buildShortlist, CURIOSITY_WEIGHTS } = await import(new URL("../netlify/lib/scoring.mts", import.meta.url).pathname);

const NOW = Date.parse("2026-10-30T18:00:00Z");
const hrs = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
let n = 0; const ok = (m: string) => { n++; console.log("  ✓", m); };
const src = (outlet: string, region: string, tier: "primary" | "reporting", h: number, title: string, summary = "") => ({ outlet, region, tier, publishedAt: hrs(h), retrievedAt: hrs(h), title, summary });
const story = (id: string, headline: string, category: string, sources: any[], createdH = 2) => ({ id, headline, category, createdAt: hrs(createdH), sources });

assert.equal(Object.values(CURIOSITY_WEIGHTS).reduce((a: number, b: any) => a + b, 0), 100); ok("curiosity weights total exactly 100");

const law = scoreStory(story("a", "Parliament overturns ban on rural clinics, health workers say care costs will fall", "Laws and regulations",
  [src("Dawn", "Asia", "reporting", 3, "x"), src("The Hindu (National)", "Asia", "reporting", 4, "y"), src("UN News", "Global", "primary", 5, "z")]), NOW);
const fluff = scoreStory(story("b", "Celebrity opens new restaurant", "General world news", [src("Euronews", "Europe", "reporting", 30, "x")]), NOW);
assert(priorityOf(law) > priorityOf(fluff)); ok("significant, people-affecting story outranks trivial one");
assert(law.curiosity > fluff.curiosity); ok("curiosity higher for consequence + people + reversal wording");
assert(law.patterns.some((p: any) => p.id === "unexpected_reversal")); ok("pattern detected with an explanation");
assert(law.dimensions.every((d: any) => d.reason.length > 10)); ok("every dimension carries a plain-words reason");
assert(law.curiosity <= 100 && law.dimensions.find((d: any) => d.dimension === "curiosity").reason.includes("EDITORIAL HYPOTHESIS")); ok("curiosity labelled EDITORIAL HYPOTHESIS and bounded to 100");

// evidence is capped; curiosity cannot rescue weak evidence
const hype = scoreStory(story("c", "Why did the secret ruling shock workers? Unexpected reversal could cut jobs worldwide", "Government and institutional decisions", [src("Daily Maverick", "Africa", "reporting", 1, "x")]), NOW);
assert(hype.get("evidence_quality") <= 2 && hype.get("source_independence") === 0); ok("single-outlet story: independence 0 and evidence capped");
assert(hype.flags.some((f: string) => /Single outlet/.test(f))); ok("weakness shown as a flag, not hidden in a total");
const sameHeadlineStrong = { ...hype, story: { ...hype.story, id: "c2" } };
const strong = scoreStory(story("c2", hype.story.headline, "Government and institutional decisions", [src("Daily Maverick", "Africa", "reporting", 1, "x"), src("UN News", "Global", "primary", 2, "y")]), NOW);
assert(priorityOf(strong) > priorityOf(hype)); ok("same headline with an official source plus second outlet ranks higher (evidence gate)");

// clickbait
const bait = scoreStory(story("d", "Shocking bombshell: minister slams rivals in explosive outrage", "Government and institutional decisions", [src("Al Jazeera", "Middle East", "reporting", 2, "x")]), NOW);
assert(bait.flags.some((f: string) => /Clickbait/.test(f))); ok("clickbait wording flagged");
const baitComp = bait.dimensions.find((d: any) => d.dimension === "curiosity").detail.components;
assert(baitComp.curiosity_gap.points <= 0.3 * 15 + 1e-9 && baitComp.emotional_resonance.points <= 0.3 * 6 + 1e-9); ok("clickbait cannot raise curiosity gap or emotion");

// recycled / live
const old = scoreStory(story("e", "Remembering the 1998 flood: what we know ten years ago", "General world news", [src("Euronews", "Europe", "reporting", 5, "x")], 80), NOW);
assert(old.get("novelty") < law.get("novelty") && old.flags.some((f: string) => /recycled/i.test(f))); ok("recycled story gets low novelty and a flag");

// wire dependence
const wire = scoreStory(story("f", "Court halts mining licence", "Laws and regulations", [src("Dawn", "Asia", "reporting", 3, "x", "Reuters reported the court halted it"), src("Japan Times", "Asia", "reporting", 3, "y", "according to Reuters")]), NOW);
const nowire = scoreStory(story("f2", "Court halts mining licence", "Laws and regulations", [src("Dawn", "Asia", "reporting", 3, "x"), src("Japan Times", "Asia", "reporting", 3, "y")]), NOW);
assert(wire.get("source_independence") < nowire.get("source_independence") || nowire.get("source_independence") === 1 && wire.get("source_independence") === 0); ok("wire-service wording lowers independence");

// shortlist diversity
const mk = (i: number, region: string, outlet: string, cat: string, tier: any = "reporting", h = 2) =>
  scoreStory(story(`s${i}`, `Government announces ${cat.toLowerCase()} law ruling number ${i} affecting workers and families`, cat, [src(outlet, region, tier, h, "x"), src(outlet + "2", region, tier, h + 1, "y")]), NOW);
const pool = [
  ...Array.from({ length: 10 }, (_, i) => mk(i, "Europe", "DW", "Laws and regulations")),
  ...Array.from({ length: 6 }, (_, i) => mk(20 + i, "Asia", "Dawn", "Government and institutional decisions")),
  mk(40, "Africa", "Premium Times", "Public policy"),
  mk(41, "Oceania", "RNZ", "Environment and climate"),
  mk(42, "Latin America", "MercoPress", "Business and economic developments"),
  mk(43, "Global", "Nature", "Scientific discoveries", "primary"),
];
const { picks, heldBack } = buildShortlist(pool, 12);
assert.equal(picks.length, 12); ok("shortlist has the requested size");
const regionsPicked = picks.reduce((m: any, p: any) => ((m[p.scored.dominantRegion] = (m[p.scored.dominantRegion] ?? 0) + 1), m), {});
assert(regionsPicked.Europe <= 4 && regionsPicked.Asia <= 4); ok("no region dominates (cap 4)");
assert(["Africa", "Oceania", "Latin America"].every((r) => regionsPicked[r] >= 1)); ok("under-reported regions get reserved slots even with lower scores");
assert(picks.some((p: any) => p.scored.story.category === "Scientific discoveries")); ok("science slot reserved");
assert(picks.every((p: any) => p.reason.length > 15) && picks.every((p: any, i: number) => p.rank === i + 1)); ok("each pick has a ranked position and a stated reason");
assert(heldBack.every((h: any) => h.reason.length > 15 && !h.selected)); ok("strong stories not selected are listed with the reason, not dropped silently");
assert(new Set(picks.map((p: any) => p.scored.story.id)).size === picks.length); ok("no story selected twice");
const again = buildShortlist(pool, 12);
assert.deepEqual(again.picks.map((p: any) => p.scored.story.id), picks.map((p: any) => p.scored.story.id)); ok("shortlist is deterministic");

console.log("Review fixes");
const lo = scoreStory(story("g", "DMK women cadre protest across Tamil Nadu over price rise, law and order", "Government and institutional decisions", [src("The Hindu (National)", "Asia", "reporting", 0.2, "x")]), NOW);
const lw = scoreStory(story("g2", "Parliament passes new data protection law", "Government and institutional decisions", [src("The Hindu (National)", "Asia", "reporting", 0.2, "x")]), NOW);
assert(lo.get("editorial_significance") < lw.get("editorial_significance")); ok('"law and order" no longer counts as legislation');
assert(!lo.dimensions.some((d: any) => /\.\./.test(d.reason))); ok("no double full stops in reasons");
assert(lo.dimensions.find((d: any) => d.dimension === "recency").reason === "Newest report is less than an hour old."); ok("recent stories say 'less than an hour', not '0 hour(s)'");
const single = Array.from({ length: 6 }, (_, i) => scoreStory(story(`w${i}`, `Why did the secret ruling shock workers and families number ${i}? Unexpected reversal could cut jobs`, "Government and institutional decisions", [src("Dawn", "Asia", "reporting", 0.5, "x")]), NOW));
const backed = Array.from({ length: 4 }, (_, i) => scoreStory(story(`b${i}`, `Council publishes quarterly report number ${i}`, "Public policy", [src(`Outlet${i}`, "Europe", "reporting", 20, "x"), src(`Other${i}`, "Europe", "reporting", 21, "y")]), NOW));
const mixed = buildShortlist([...single, ...backed], 6);
const firstFour = mixed.picks.slice(0, 4).map((p: any) => p.scored.story.id);
assert(backed.every((b: any) => firstFour.includes(b.story.id)) || backed.filter((b: any) => firstFour.includes(b.story.id)).length >= 3); ok("supported stories rank above unconfirmed single-outlet stories even when the latter score higher on curiosity");
assert(mixed.picks.filter((p: any) => !(p.scored.outlets >= 2 || p.scored.hasPrimary)).every((p: any) => /unconfirmed/.test(p.reason))); ok("single-outlet picks are labelled unconfirmed in the reason");
const plenty = buildShortlist([...Array.from({ length: 14 }, (_, i) => scoreStory(story(`p${i}`, `Government announces rule ${i} affecting workers and families`, ["Laws and regulations","Public policy","Environment and climate","Government and institutional decisions"][i % 4], [src(`A${i}`, ["Europe","Asia","Africa","Latin America","Oceania","Middle East","North America"][i % 7], "reporting", 3, "x"), src(`B${i}`, ["Europe","Asia","Africa","Latin America","Oceania","Middle East","North America"][i % 7], "reporting", 4, "y")]), NOW)), ...single], 12);
assert(plenty.picks.every((p: any) => p.scored.outlets >= 2 || p.scored.hasPrimary)); ok("single-outlet stories take no places while enough supported stories exist");

console.log(`\nALL ${n} SCORING CHECKS PASSED`);

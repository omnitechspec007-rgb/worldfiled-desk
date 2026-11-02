// Curiosity opportunity detector: eight scenarios from the editorial direction. Pure functions, no network.
import { scoreStory, type StoryInput } from "../netlify/lib/scoring.mts";
import { assessDevelopment } from "../netlify/lib/curiosity.mts";
import type { EvSource } from "../netlify/lib/evidence-pack.mts";

let pass = 0, fail = 0;
const check = (n: string, v: boolean) => { console.log((v ? "PASS " : "FAIL ") + n); v ? pass++ : fail++; };
const NOW = Date.parse("2026-10-31T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();

type S = { outlet: string; region?: string; tier?: "primary" | "reporting"; title: string; summary?: string; ago?: number; country?: string };
function dev(id: string, headline: string, category: string, sources: S[], createdAgo = 3) {
  const input: StoryInput = {
    id, headline, category, createdAt: hoursAgo(createdAgo),
    sources: sources.map((s) => ({ outlet: s.outlet, region: s.region ?? "Europe", tier: s.tier ?? "reporting", publishedAt: hoursAgo(s.ago ?? 4), retrievedAt: hoursAgo(1), title: s.title, summary: s.summary ?? null })),
  };
  const ev: EvSource[] = sources.map((s) => ({ outlet: s.outlet, region: s.region ?? "Europe", outletCountry: s.country, tier: s.tier ?? "reporting", url: `https://${s.outlet.toLowerCase().replace(/\W/g, "")}.example/${id}`, title: s.title, summary: s.summary ?? null, publishedAt: hoursAgo(s.ago ?? 4), retrievedAt: hoursAgo(1) }));
  const scored = scoreStory(input, NOW);
  return { scored, a: assessDevelopment(scored, ev, NOW) };
}

// 1. New law with significant human consequences
const law = dev("law", "New law bans cash rent deposits and caps rent rises for millions of tenants", "Laws and regulations", [
  { outlet: "Gov Gazette", tier: "primary", title: "Housing Act signed: rent rises capped, deposits limited", summary: "The act takes effect in March and affects tenants and landlords across the country." },
  { outlet: "Daily Post", title: "New housing law will cut rent for families, landlords object", summary: "Tenants, families and landlords react to the new rent rules." },
]);
check("new law: typed as law/regulation with the law question set", law.a.type === "law_regulation" && law.a.keyQuestions.includes("What happens if people or organisations do not comply?"));
check("new law: strong recommendation (supported + consequential)", ["HIGH-POTENTIAL STORY", "STRONG EDITION CANDIDATE"].includes(law.a.recommendation));
check("new law: human consequences detected", !!law.a.humanConsequences);

// 2. Scientific discovery challenging an assumption
const sci = dev("sci", "Study overturns belief that deep ocean trenches are lifeless, researchers report", "Scientific discoveries", [
  { outlet: "Science Desk", title: "Researchers find thriving life in ocean trench, challenging the assumption it is barren", summary: "A study in a journal found new species and contradicts earlier belief." },
  { outlet: "Nature Wire", title: "New species found in deepest trench in study", summary: "Scientists say the finding changes what is known." },
], 3);
check("discovery: typed as scientific discovery with the science question set", sci.a.type === "scientific_discovery" && sci.a.keyQuestions.includes("What did researchers previously believe?"));
check("discovery: belief-challenged / surprise detected", sci.scored.patterns.some((p) => p.id === "belief_challenged" || p.id === "discovery") && !!sci.a.surprisingElement);
check("discovery: states that preliminary-vs-established is unknown", sci.a.missingEvidence.some((m) => /preliminary or established/.test(m)));

// 3. Unusual but low-impact event
const odd = dev("odd", "Village sets record for the largest pumpkin pie", "General world news", [{ outlet: "Local Times", title: "Record pumpkin pie baked at village fair", summary: "Organisers said it was the largest ever." }, { outlet: "County News", title: "Villagers bake record pie", summary: "A fair was held on Saturday." }]);
check("unusual low-impact: not a high-potential story", !["HIGH-POTENTIAL STORY", "STRONG EDITION CANDIDATE"].includes(odd.a.recommendation));

// 4. Important quiet policy change
const quiet = dev("quiet", "Regulator amends clause on pension fund disclosure rules", "Public policy", [
  { outlet: "Financial Regulator", tier: "primary", title: "Amendment to pension disclosure regulation published", summary: "A small rule change on how pension funds report fees, affecting savers." },
  { outlet: "Money Weekly", title: "Quiet rule change on pension fees", summary: "Savers and workers may see lower fees; the amendment was little-noticed." },
]);
check("quiet policy change: kept as worthwhile, not rejected for lacking drama", ["HIGH-POTENTIAL STORY", "STRONG EDITION CANDIDATE"].includes(quiet.a.recommendation));
check("quiet policy change: 'small development, large implication' pattern found", quiet.scored.patterns.some((p) => p.id === "small_large"));

// 5. Sensational claim with weak evidence
const sens = dev("sens", "SHOCKING: Insiders say explosive bombshell will destroy the economy, sources say", "General world news", [{ outlet: "Rumour Mill", title: "Shocking bombshell: sources say economy will collapse", summary: "Reportedly insiders believe it." }]);
check("sensational + weak evidence: never high-priority", !["HIGH-POTENTIAL STORY", "STRONG EDITION CANDIDATE"].includes(sens.a.recommendation));
check("sensational + weak evidence: flagged and curiosity capped", sens.a.sensationalismFlags.length >= 1 && sens.a.curiosityScore < 35);

// 6. Recycled old story presented as new
const old = dev("old", "Looking back: what we know, ten years ago the dam failed", "General world news", [{ outlet: "Retro News", title: "Anniversary: remembering the dam failure ten years ago", summary: "A look back at what happened years ago.", ago: 70 }, { outlet: "History Daily", title: "Throwback: the dam disaster explained", summary: "Revisiting the event years ago.", ago: 70 }], 60);
check("recycled story: marked not timely or low, never promoted", ["RELEVANT BUT NOT TIMELY", "LOW EDITORIAL CURIOSITY"].includes(old.a.recommendation));

// 7. High curiosity but insufficient evidence
const gap = dev("gap", "Why did the minister quietly reverse the ban? Unexpected U-turn unexplained", "Government and institutional decisions", [{ outlet: "One Paper", title: "Why did the minister reverse the ban? Unexpected U-turn leaves questions", summary: "Officials did not explain; the government backtracks." }]);
check("high curiosity, single outlet: needs more evidence, not a priority", gap.a.recommendation === "INTERESTING BUT NEEDS MORE EVIDENCE" && !gap.a.corroborated);
check("high curiosity, single outlet: evidence strength reported separately as WEAK/LIMITED", gap.a.curiosityScore > 20 && gap.a.evidenceStrength.label !== "MODERATE");

// 8. Low sensationalism but high public importance
const imp = dev("imp", "Central bank raises interest rate by 0.25 points, mortgages and wages affected", "Business and economic developments", [
  { outlet: "Central Bank", tier: "primary", title: "Monetary policy decision: rate raised to 4.5 percent", summary: "The committee voted to raise rates; mortgage and loan costs will change." },
  { outlet: "Business Times", title: "Rate rise: what it means for mortgages and savers", summary: "Households with mortgages will pay more." },
]);
check("calm but important: supported and rated worthwhile", ["HIGH-POTENTIAL STORY", "STRONG EDITION CANDIDATE"].includes(imp.a.recommendation) && imp.a.sensationalismFlags.length === 0);

const RANK: Record<string, number> = { "HIGH-POTENTIAL STORY": 5, "STRONG EDITION CANDIDATE": 4, "INTERESTING BUT NEEDS MORE EVIDENCE": 3, "HOLD FOR FUTURE DEVELOPMENTS": 2, "RELEVANT BUT NOT TIMELY": 1, "LOW EDITORIAL CURIOSITY": 0 };
// structure checks
for (const d of [law, sci, odd, quiet, sens, old, gap, imp]) {
  check(`assessment (${d.a.storyId}) has every required field`, !!(d.a.mainDevelopment && d.a.whatChanged && d.a.whyInteresting.length && d.a.audienceQuestion && d.a.missingEvidence.length && d.a.recommendation && d.a.recommendationWhy && d.a.evidenceStrength && d.a.hypothesisNote));
}
check("curiosity is always labelled an editorial hypothesis", [law, sci, gap].every((d) => /EDITORIAL HYPOTHESIS/.test(d.a.hypothesisNote)));
check("evidence strength and curiosity are separate fields", gap.a.curiosityScore !== gap.a.evidenceStrength.score);
check("quiet-but-important is rated at least as high as the sensational weak story", RANK[quiet.a.recommendation] > RANK[sens.a.recommendation]);
const allRecs = [law, sci, odd, quiet, sens, old, gap, imp].map((d) => d.a.recommendation);
check("the six recommendation labels are all valid values", allRecs.every((r) => ["HIGH-POTENTIAL STORY", "STRONG EDITION CANDIDATE", "INTERESTING BUT NEEDS MORE EVIDENCE", "LOW EDITORIAL CURIOSITY", "RELEVANT BUT NOT TIMELY", "HOLD FOR FUTURE DEVELOPMENTS"].includes(r)));

// hold: provisional developments
const hold = dev("hold", "Parliament considering draft bill; talks expected to continue, plans pending", "Laws and regulations", [{ outlet: "Capital News", title: "Draft bill under review, talks pending", summary: "The proposal could change; it may be amended and is expected to go to a vote." }]);
check("provisional/draft development: held for future developments", hold.a.recommendation === "HOLD FOR FUTURE DEVELOPMENTS");

if (process.env.SHOW) for (const d of [law, sci, odd, quiet, sens, old, gap, imp, hold]) console.log(d.a.storyId.padEnd(6), String(d.a.curiosityScore).padEnd(6), d.a.evidenceStrength.label.padEnd(9), d.a.type.padEnd(22), d.a.recommendation);
console.log(`\n${fail ? "FAILURES: " + fail : "ALL " + pass + " CURIOSITY CHECKS PASSED"}`);
process.exit(fail ? 1 : 0);

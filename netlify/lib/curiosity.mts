// Curiosity Opportunity Detector: one explainable editorial assessment per development.
// Deterministic rules on top of scoreStory(). No AI. Evidence strength and curiosity are SEPARATE and a
// dramatic but weakly supported story can never become a high-priority recommendation.
import { CUES, hit, type Scored } from "./scoring.mts";
import { themesOf, type ThemeHit } from "./themes.mts";
import { locate, type Location } from "./geo.mts";
import type { EvSource } from "./evidence-pack.mts";

export type DevType = "law_regulation" | "government_decision" | "scientific_discovery" | "technology" | "economic_change" | "environmental_event" | "institutional_decision" | "international_development" | "unusual_event" | "other";
export type Recommendation = "HIGH-POTENTIAL STORY" | "STRONG EDITION CANDIDATE" | "INTERESTING BUT NEEDS MORE EVIDENCE" | "LOW EDITORIAL CURIOSITY" | "RELEVANT BUT NOT TIMELY" | "HOLD FOR FUTURE DEVELOPMENTS";

const TYPE_RULES: { t: DevType; label: string; re: RegExp }[] = [
  { t: "law_regulation", label: "New law or regulation", re: /\b(law|bill|act|regulation|regulates?|directive|statute|decree|ordinance|legislat\w+|ban|bans|mandate[sd]?|rules?)\b/gi },
  { t: "scientific_discovery", label: "Scientific discovery", re: /\b(discover\w*|researchers?|scientists?|study|species|fossil|telescope|trial|breakthrough|findings?|evidence suggests)\b/gi },
  { t: "technology", label: "Technology development", re: /\b(technology|software|chip|robot\w*|ai|artificial intelligence|app|platform|satellite|battery|quantum|launch\w*|prototype)\b/gi },
  { t: "economic_change", label: "Economic change", re: /\b(inflation|gdp|interest rates?|tariffs?|prices?|economy|economic|unemployment|exports?|imports?|budget|currency|wages?)\b/gi },
  { t: "environmental_event", label: "Environmental development", re: /\b(climate|flood\w*|wildfires?|drought|emissions?|biodiversity|forest\w*|pollution|glacier\w*|storm|cyclone|heatwave|conservation)\b/gi },
  { t: "government_decision", label: "Government decision", re: /\b(government|minister\w*|cabinet|president|prime minister|announces?|approves?|signs?|orders?|decides?|plan|programme|policy|funding)\b/gi },
  { t: "institutional_decision", label: "Institutional decision", re: /\b(court|tribunal|regulator|commission|central bank|council|agency|authority|watchdog|united nations|who|imf)\b/gi },
  { t: "international_development", label: "International development", re: /\b(summit|treaty|talks|alliance|sanctions?|border|ceasefire|diplomat\w*|embassy|cooperation|agreement)\b/gi },
  { t: "unusual_event", label: "Unusual event or record", re: /\b(first[- ]ever|record|unprecedented|rare|unusual|oldest|largest|smallest|never before|unexpected)\b/gi },
];

// What an editor must be able to answer for each type (from the editorial direction), phrased as open questions.
const QUESTIONS: Record<DevType, string[]> = {
  law_regulation: ["What changed?", "Who introduced it?", "Who is affected?", "What happens if people or organisations do not comply?", "Is it unusual compared with other countries?", "Does it reveal a wider policy trend?"],
  scientific_discovery: ["What was discovered?", "What did researchers previously believe?", "What is now understood differently?", "What practical implications could follow?", "Is the finding preliminary or established?", "What remains unknown?"],
  government_decision: ["What decision was made?", "Why was it made, and what prompted it?", "Who benefits or bears the consequences?", "What does it reveal about the country's direction?", "Are other countries making similar decisions?"],
  unusual_event: ["Why is it unusual?", "What makes it different from previous events?", "What question does it raise?", "Is the unusual aspect supported by evidence?"],
  technology: ["What can it do that was not possible before?", "Who will be affected first?", "What is claimed and what is demonstrated?", "What are the risks and limits?"],
  economic_change: ["What changed, by how much, over what period?", "Who feels it first?", "What drove it?", "What does the data not show?"],
  environmental_event: ["What is changing, where and how much?", "Who and what is affected?", "What response is under way?", "What is still uncertain?"],
  institutional_decision: ["What did the institution decide, and on what authority?", "Who is affected?", "What happens next?", "What conflicts of interest or accountability questions arise?"],
  international_development: ["Which countries are involved and what did each do?", "What changes on the ground?", "What do the parties disagree about?"],
  other: ["What happened?", "What changed?", "Why does it matter now?"],
};

export type Assessment = {
  storyId: string;
  type: DevType;
  typeLabel: string;
  mainDevelopment: string;
  whatChanged: string;
  whyInteresting: string[];
  audienceQuestion: string;
  keyQuestions: string[];
  surprisingElement: string | null;
  humanConsequences: string | null;
  possibleImplications: string | null;
  locations: Location[];
  themes: ThemeHit[];
  accountability: string[];
  geographicInterest: string;
  missingEvidence: string[];
  curiosityScore: number;
  evidenceStrength: { score: number; max: 5; label: "WEAK" | "LIMITED" | "MODERATE"; why: string };
  corroborated: boolean;
  sensationalismFlags: string[];
  recommendation: Recommendation;
  recommendationWhy: string;
  hypothesisNote: string;
};

export function assessDevelopment(s: Scored, sources: EvSource[], now = Date.now()): Assessment {
  const st = s.story;
  const text = [st.headline, ...st.sources.map((x) => x.title), ...st.sources.map((x) => x.summary ?? "")].join(" . ").replace(/\blaw[\s-]+and[\s-]+order\b/gi, " ");
  const head = st.headline.replace(/\blaw[\s-]+and[\s-]+order\b/gi, " ");

  // Development type: the type with most distinct matches, ties broken by rule order; headline matches count double.
  const scoredTypes = TYPE_RULES.map((r) => ({ r, n: hit(text, r.re).length + hit(head, r.re).length })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  const top = scoredTypes[0];
  const type: DevType = top?.r.t ?? "other";
  const typeLabel = top?.r.label ?? "General development";

  const evScore = s.get("evidence_quality");
  const corroborated = s.outlets >= 2 || s.hasPrimary;
  const evLabel = evScore >= 2 ? "MODERATE" : evScore >= 1 ? "LIMITED" : "WEAK";
  const clickbait = hit(head, CUES.clickbait);
  const vague = hit(text, CUES.vague);
  const sensational: string[] = [];
  if (clickbait.length) sensational.push(`clickbait-style wording (${clickbait.join(", ")})`);
  if (vague.length) sensational.push(`vague attribution (${vague.join(", ")})`);
  const uncertainWords = hit(text, /\b(could|may|might|plans? to|proposed|draft|considering|pending|expected to|under review|talks)\b/gi);
  const live = hit(head, CUES.liveUpdate);
  const recycled = hit(text, CUES.recycled);

  const surprise = hit(text, CUES.surprise);
  const people = hit(text, CUES.people);
  const consequence = hit(text, CUES.consequence);
  const acct = hit(text, CUES.accountability);
  const themes = themesOf(text);
  const locations = locate(st.headline, sources);
  const countries = [...new Set(locations.map((l) => l.country))];

  const missing: string[] = ["Full article text was not read; only headlines and short snippets."];
  if (!s.hasPrimary) missing.push("No official or primary source retrieved.");
  if (s.outlets <= 1) missing.push("No second outlet: the event is unconfirmed beyond one report.");
  else if (evScore < 2) missing.push("Several outlets, but independence from one original report is not established.");
  if (!s.newest) missing.push("No publication date.");
  if (uncertainWords.length) missing.push(`Wording signals that details are not final (${uncertainWords.slice(0, 3).join(", ")}).`);
  if (type === "scientific_discovery") missing.push("Whether the finding is preliminary or established is not stated in the retrieved text.");
  if (type === "law_regulation") missing.push("The exact legal provisions were not retrieved.");

  const why: string[] = [];
  for (const p of s.patterns.slice(0, 4)) why.push(`${p.label}: ${p.why}`);
  if (!why.length && s.get("editorial_significance") >= 3) why.push("Quiet but consequential: an institutional or scientific development of real significance, without dramatic wording.");
  if (!why.length) why.push("No strong curiosity mechanism detected by the rules.");

  const curiosity = s.curiosity;
  const sig = s.get("editorial_significance");
  const rec = ((): { r: Recommendation; w: string } => {
    const weak = !corroborated || sensational.length > 0;
    if (recycled.length && s.get("novelty") <= 2) return { r: "RELEVANT BUT NOT TIMELY", w: "Wording suggests background or recycled reporting, and novelty is low." };
    if (s.get("recency") <= 1 && s.newest && !s.hasPrimary && curiosity >= 25) return { r: "RELEVANT BUT NOT TIMELY", w: "Interesting, but the newest report is older than two days." };
    if (live.length || (uncertainWords.length >= 2 && !s.hasPrimary)) return { r: "HOLD FOR FUTURE DEVELOPMENTS", w: "Details are provisional or still developing; wait for a confirmed outcome." };
    if (weak && (curiosity >= 25 || sig >= 3)) return { r: "INTERESTING BUT NEEDS MORE EVIDENCE", w: `${!corroborated ? "Only one outlet and no official source" : "Sensational wording or vague attribution"}: curiosity cannot compensate for weak evidence, so it is not a priority until supported.` };
    if (!weak && curiosity >= 45) return { r: "HIGH-POTENTIAL STORY", w: "Strong curiosity mechanisms and at least a corroborated or official source." };
    if (!weak && (themes.length > 0 || countries.length > 0) && (curiosity >= 25 || sig >= 3)) return { r: "STRONG EDITION CANDIDATE", w: `Supported by ${s.hasPrimary ? "an official source" : "multiple outlets"} and carries ${themes.length ? `the theme "${themes[0].label}"` : "a clear place"}, so it may gain value alongside related developments.` };
    if (!weak && sig >= 3.5) return { r: "HIGH-POTENTIAL STORY", w: "Quiet but consequential: significant institutional or scientific change with supporting evidence." };
    if (weak) return { r: "LOW EDITORIAL CURIOSITY", w: "Weak evidence and no strong curiosity mechanism." };
    return { r: "LOW EDITORIAL CURIOSITY", w: "No strong curiosity mechanism and modest significance." };
  })();

  const geo = countries.length >= 2 ? `Involves ${countries.length} places (${countries.join(", ")}): a geographic comparison is possible.` : countries.length === 1 ? `Anchored in ${countries[0]}${locations[0].basis === "publisher location only" ? " (publisher location only, not confirmed as the event location)" : ""}.` : "No place could be established from the retrieved text.";
  const lead = st.sources[0];

  return {
    storyId: st.id,
    type,
    typeLabel,
    mainDevelopment: st.headline,
    whatChanged: s.patterns.find((p) => p.id === "before_after" || p.id === "unexpected_reversal")?.why ?? (lead?.summary ? `According to ${lead.outlet}: ${lead.summary.slice(0, 160)}` : "The retrieved text does not state what changed."),
    whyInteresting: why,
    audienceQuestion: QUESTIONS[type][0],
    keyQuestions: QUESTIONS[type],
    surprisingElement: surprise.length ? `Wording points to something unexpected (${surprise.slice(0, 3).join(", ")}). Check the sources before claiming it.` : null,
    humanConsequences: people.length ? `The text touches everyday life (${people.slice(0, 5).join(", ")}).` : null,
    possibleImplications: consequence.length ? `Possible consequences mentioned or implied (${consequence.slice(0, 4).join(", ")}). Treat as possibilities, not facts.` : null,
    locations,
    themes,
    accountability: acct,
    geographicInterest: geo,
    missingEvidence: missing,
    curiosityScore: curiosity,
    evidenceStrength: { score: evScore, max: 5, label: evLabel, why: `Evidence quality ${evScore}/5 (capped at 2 until full text and claim checking exist). ${s.hasPrimary ? "Official source present." : "No official source."} ${s.outlets} outlet(s).` },
    corroborated,
    sensationalismFlags: sensational,
    recommendation: rec.r,
    recommendationWhy: rec.w,
    hypothesisNote: "Curiosity is an EDITORIAL HYPOTHESIS from fixed rules, not measured audience behaviour. It is kept separate from evidence strength and never overrides it.",
  };
}

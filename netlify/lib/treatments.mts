// Rule-based creative treatment selection. No AI. Each treatment is a story-type playbook:
// presentation approach, the professional roles to assign (and why), hook, visual and voice direction,
// things to avoid, and a storyboard arc. The editor can override the recommendation.
import type { EvStory } from "./evidence-pack.mts";

export type Role = { role: string; why: string };
export type Treatment = {
  key: string;
  label: string;
  approach: string;
  devices: string[];
  roles: Role[];
  hook: string;
  firstSeen: string;
  visual: string;
  voice: string;
  avoid: string[];
  arc: { beat: string; fraction: number; content: string }[];
};

const FACT_CHECKER: Role = { role: "Editorial fact-checker", why: "checks every on-screen and spoken claim against the evidence section before delivery" };
const VO_DIRECTOR: Role = { role: "Professional voiceover director", why: "sets pacing, emphasis and pronunciation so the narration is calm and clear" };

const T = (t: Treatment) => t;
export const TREATMENTS: Treatment[] = [
  T({
    key: "policy_explainer",
    label: "Policy and law explainer",
    approach: "Document-inspired explainer: what the rule says, who it affects, what changes, with a timeline and a before/after comparison.",
    devices: ["document", "timeline", "comparison"],
    roles: [
      { role: "Investigative journalist", why: "frames what was decided, by whom, and what is not yet known" },
      { role: "Policy explainer", why: "translates legal or regulatory wording into plain language without overstating its effect" },
      { role: "Motion-graphics designer", why: "builds restrained document, timeline and comparison graphics" },
      VO_DIRECTOR,
      FACT_CHECKER,
    ],
    hook: "Open on the single concrete change: what is now allowed, banned or required, and for whom.",
    firstSeen: "A clean document-style panel quoting only wording that appears in the evidence, then the group it affects.",
    visual: "Document-inspired layouts, a dated timeline, a two-column before/after. Highlight key figures and dates in Archival Gold. A map only if the rule is territorial.",
    voice: "Measured, precise, neutral. Short declarative sentences; pause before the key change; never editorialise about whether the rule is good or bad.",
    avoid: ["quoting statute or ruling wording that is not in the evidence", "predicting effects the sources do not state", "taking a side", "implying a proposal is already law"],
    arc: [
      { beat: "Hook: the change", fraction: 0.12, content: "State what changed and who it concerns." },
      { beat: "What the rule says", fraction: 0.25, content: "Plain-language account of the decision, attributed to its source." },
      { beat: "Who is affected", fraction: 0.2, content: "Only groups named in the evidence." },
      { beat: "What happens next", fraction: 0.15, content: "Dates and steps given in the sources; mark the rest as unknown." },
      { beat: "What is not known", fraction: 0.13, content: "Open questions, honestly stated." },
      { beat: "Why it matters", fraction: 0.15, content: "Wider significance, only as far as the evidence supports." },
    ],
  }),
  T({
    key: "science_discovery",
    label: "Science and discovery",
    approach: "Visual explainer of the finding: the question, what was found, how sure the researchers are, and what it does not show.",
    devices: ["diagram", "comparison", "timeline"],
    roles: [
      { role: "Science documentary director", why: "shapes a curiosity-led narrative around the finding" },
      { role: "Scientific visualisation specialist", why: "draws accurate, labelled diagrams in the brand palette" },
      { role: "Science journalist", why: "keeps claims at the strength of the evidence and flags limits" },
      { role: "Sound designer", why: "restrained ambient sound that supports wonder without drama" },
      FACT_CHECKER,
    ],
    hook: "Open on the question the finding answers, or the surprising detail that is actually in the evidence.",
    firstSeen: "A clear labelled diagram or scale comparison of the subject.",
    visual: "Clean scientific illustration and labelled diagrams on Midnight Navy; scale bars and comparisons; Signal Teal for the verified key element. No fake lab footage.",
    voice: "Curious, calm, precise. Wonder through specificity, not adjectives. Say 'researchers report' and name the journal or institution only if the evidence does.",
    avoid: ["saying 'proves' or 'cures'", "turning one study into a settled fact", "invented numbers or scale", "dramatised reconstructions presented as real footage"],
    arc: [
      { beat: "Hook: the question", fraction: 0.12, content: "The question or surprise from the evidence." },
      { beat: "What was found", fraction: 0.25, content: "The finding as the sources state it." },
      { beat: "How they know", fraction: 0.2, content: "Method, only if given; otherwise skip." },
      { beat: "How sure", fraction: 0.15, content: "Limits and caveats stated by the sources; mark the rest unknown." },
      { beat: "Why it matters", fraction: 0.18, content: "Implications limited to what the sources say." },
      { beat: "What comes next", fraction: 0.1, content: "Next steps if stated." },
    ],
  }),
  T({
    key: "geographic_affairs",
    label: "International affairs and geography",
    approach: "Cartography-led explainer: where it happened, who is involved, what changed on the ground or in policy.",
    devices: ["map", "timeline", "comparison"],
    roles: [
      { role: "Senior international news correspondent", why: "frames the development with context and restraint" },
      { role: "Geographic information designer", why: "chooses the geography that actually carries the story" },
      { role: "Cartographic visualisation specialist", why: "draws accurate, restrained maps in the brand palette" },
      { role: "Documentary director", why: "paces the reveal across place, people and consequence" },
      VO_DIRECTOR,
      FACT_CHECKER,
    ],
    hook: "Open on the place and the one fact that makes it matter.",
    firstSeen: "A map or globe that moves to the location named in the evidence.",
    visual: "Dark, restrained cartography; Archival Gold for the location or border at issue; labelled markers only where the sources place them. Contested borders: show neutrally and say so.",
    voice: "Authoritative, even, internationally understandable. Name places clearly; avoid jargon and acronyms without explanation.",
    avoid: ["placing events at locations the sources do not name", "showing disputed borders as settled", "maps added only for decoration", "stereotyped imagery"],
    arc: [
      { beat: "Hook: where and what", fraction: 0.12, content: "Place plus the key fact." },
      { beat: "What happened", fraction: 0.22, content: "Sequence of events as sourced." },
      { beat: "Who is involved", fraction: 0.18, content: "Parties named in the evidence, attributed." },
      { beat: "The other side", fraction: 0.14, content: "Responses or counter-positions in the evidence." },
      { beat: "What changes", fraction: 0.2, content: "Consequences the sources state; mark the rest unknown." },
      { beat: "Why it matters", fraction: 0.14, content: "Wider significance within the evidence." },
    ],
  }),
  T({
    key: "environment_climate",
    label: "Environment and climate",
    approach: "Place-and-data story: what is changing, where, how large, and what is being done.",
    devices: ["map", "diagram", "comparison"],
    roles: [
      { role: "Environmental documentary producer", why: "builds the narrative around the place and the change" },
      { role: "Geographic information designer", why: "shows where the change is happening and its extent" },
      { role: "Data journalist", why: "handles figures and comparisons without exaggeration" },
      { role: "Scientific visualisation specialist", why: "illustrates the process clearly and accurately" },
      FACT_CHECKER,
    ],
    hook: "Open on the measurable change or the place affected.",
    firstSeen: "A map or scale comparison showing the extent of the change, using only sourced figures.",
    visual: "Geographic and environmental imagery in the brand palette; simple charts with labelled units; Signal Teal for measured values, Archival Gold for the area affected.",
    voice: "Calm, grounded, specific. No alarmism: numbers and places carry the weight.",
    avoid: ["attributing a single event to climate change unless the sources do", "unlabelled or invented figures", "disaster-movie imagery", "misleading chart baselines or truncated axes"],
    arc: [
      { beat: "Hook: the change", fraction: 0.12, content: "Measurable change or place affected." },
      { beat: "Where and how big", fraction: 0.22, content: "Extent and figures as sourced." },
      { beat: "What is causing it", fraction: 0.18, content: "Only causes the sources state." },
      { beat: "Who is affected", fraction: 0.16, content: "Communities or ecosystems named in the evidence." },
      { beat: "What is being done", fraction: 0.18, content: "Responses reported by the sources." },
      { beat: "What is not known", fraction: 0.14, content: "Uncertainties, honestly stated." },
    ],
  }),
  T({
    key: "human_interest",
    label: "Human-centred story",
    approach: "Narrative built around the people affected and the verified human consequence, without inventing characters, dialogue or feelings.",
    devices: ["human", "timeline", "map"],
    roles: [
      { role: "Human-interest storyteller", why: "finds the human consequence inside the verified facts" },
      { role: "Documentary scriptwriter", why: "writes plain, specific narration without sentimentality" },
      { role: "Documentary director", why: "keeps the visual language respectful and restrained" },
      { role: "Sound designer", why: "subtle, non-manipulative sound" },
      VO_DIRECTOR,
      FACT_CHECKER,
    ],
    hook: "Open on the human fact that is in the evidence: a number of people, a place, a change in daily life.",
    firstSeen: "A simple, respectful visual of the place or situation, with the key human fact in text.",
    visual: "Documentary-style graphics in the brand palette: typography, maps and simple illustrations. No fabricated photographs of real people and no invented individuals.",
    voice: "Warm but not sentimental; clear and respectful. Let the facts carry the emotion.",
    avoid: ["inventing people, quotes, dialogue or feelings", "identifying private individuals or minors beyond the sources", "dramatised reconstructions presented as real", "pity or outrage framing"],
    arc: [
      { beat: "Hook: the human fact", fraction: 0.12, content: "Who is affected, from the evidence." },
      { beat: "What happened", fraction: 0.22, content: "Sourced sequence." },
      { beat: "The human consequence", fraction: 0.22, content: "Impact as the sources describe it." },
      { beat: "Responses", fraction: 0.16, content: "Official or community responses reported." },
      { beat: "What is not known", fraction: 0.14, content: "Gaps stated plainly." },
      { beat: "Why it matters", fraction: 0.14, content: "Wider significance within the evidence." },
    ],
  }),
  T({
    key: "data_economy",
    label: "Data and economy",
    approach: "Number-led explainer: the figure, what it compares with, who is affected, and what the data cannot say.",
    devices: ["comparison", "timeline", "diagram"],
    roles: [
      { role: "Data journalist", why: "keeps every figure sourced and in context" },
      { role: "Motion-graphics designer", why: "builds honest, legible charts and comparisons" },
      { role: "Policy explainer", why: "explains what the figure means for people without overreach" },
      VO_DIRECTOR,
      FACT_CHECKER,
    ],
    hook: "Open on the figure and the comparison that gives it meaning, if the evidence supplies one.",
    firstSeen: "One large, clearly labelled number with its unit, source and period.",
    visual: "Simple charts and comparisons; zero-based axes unless clearly labelled; Archival Gold for the key figure; Signal Teal for the comparison.",
    voice: "Precise, plain, unhurried. Say each number once, with its unit and period.",
    avoid: ["figures without unit, period or source", "misleading baselines or truncated axes", "implying causation from correlation", "invented comparisons"],
    arc: [
      { beat: "Hook: the figure", fraction: 0.12, content: "The number, unit and period." },
      { beat: "Compared with what", fraction: 0.2, content: "Comparison only if sourced." },
      { beat: "What drove it", fraction: 0.18, content: "Reasons the sources give." },
      { beat: "Who feels it", fraction: 0.18, content: "Groups named in the evidence." },
      { beat: "What the data cannot say", fraction: 0.16, content: "Limits and unknowns." },
      { beat: "Why it matters", fraction: 0.16, content: "Significance within the evidence." },
    ],
  }),
  T({
    key: "general_explainer",
    label: "General explainer",
    approach: "Clear what-happened / what-changed / what-matters explainer, with the visual device the evidence calls for.",
    devices: ["timeline", "comparison"],
    roles: [
      { role: "Senior international news correspondent", why: "frames the development accurately and calmly" },
      { role: "Documentary scriptwriter", why: "writes a tight, curiosity-led script" },
      { role: "Creative director", why: "picks the one visual device that serves the story" },
      VO_DIRECTOR,
      FACT_CHECKER,
    ],
    hook: "Open on the most concrete, sourced fact.",
    firstSeen: "The key fact in large type with its source.",
    visual: "Restrained editorial layout in the brand palette; add a map, timeline or comparison only if the evidence supports it.",
    voice: "Informed, calm, clear.",
    avoid: ["padding with unsupported context", "decorative graphics that add no information", "claiming more significance than the evidence supports"],
    arc: [
      { beat: "What happened", fraction: 0.3, content: "Sourced account." },
      { beat: "What changed", fraction: 0.3, content: "Change as stated in the evidence." },
      { beat: "What is not known", fraction: 0.15, content: "Gaps." },
      { beat: "What matters", fraction: 0.25, content: "Significance within the evidence." },
    ],
  }),
];

const RULES: { key: string; words: RegExp; category?: RegExp }[] = [
  { key: "policy_explainer", words: /\b(law|bill|act|regulation|regulator|ruling|court|tribunal|parliament|senate|congress|legislat\w*|ban|treaty|policy|ordinance|verdict|statute|decree|amendment|judge|ministry|directive|constitution\w*)\b/gi, category: /law|polic|legal|government/i },
  { key: "science_discovery", words: /\b(study|researchers?|scientists?|discover\w*|species|fossil|telescope|vaccine|trial|genome|particle|astronom\w*|physics|quantum|journal|asteroid|planet|molecule|experiment|biolog\w*|archaeolog\w*)\b/gi, category: /science|discover|health|tech/i },
  { key: "geographic_affairs", words: /\b(border|region|strait|island|port|capital|troops|ceasefire|sanctions?|summit|diplomat\w*|embassy|migration|corridor|pipeline|territor\w*|military|alliance|treaty|talks)\b/gi, category: /international|world|geo|politic/i },
  { key: "environment_climate", words: /\b(climate|emissions?|flood\w*|drought|wildfires?|glaciers?|biodiversity|forests?|ocean|coral|pollution|carbon|renewable|deforest\w*|storm|cyclone|heatwave|wildlife|conservation)\b/gi, category: /environment|climate/i },
  { key: "human_interest", words: /\b(family|families|villagers?|children|survivors?|community|communities|students|farmers|rescued|refugees?|workers|residents|orphan\w*|volunteers?|teachers?|patients?)\b/gi, category: /human|society|people/i },
  { key: "data_economy", words: /\b(inflation|gdp|prices?|economy|economic|unemployment|interest rates?|billion|million|percent|per cent|record high|record low|budget|growth|exports?|imports?|market|trade|wages?)\b|%/gi, category: /econom|business|finance|data/i },
];

export type Recommendation = { treatment: Treatment; matched: string[]; reason: string; alternatives: { key: string; label: string; matched: string[] }[] };

export function getTreatment(key: string): Treatment | undefined {
  return TREATMENTS.find((t) => t.key === key);
}

/** Choose a treatment from headline, snippets and category. Deterministic; ties resolved by list order. */
export function recommendTreatment(story: EvStory): Recommendation {
  const text = [story.headline, ...story.sources.map((s) => s.title), ...story.sources.map((s) => s.summary ?? "")].join(" ").replace(/\blaw[\s-]+and[\s-]+order\b/gi, " ");
  const scored = RULES.map((r) => {
    const matched = [...new Set((text.match(r.words) ?? []).map((w) => w.toLowerCase()))];
    const bonus = r.category && story.category && r.category.test(story.category) ? 2 : 0;
    return { key: r.key, matched, score: matched.length + bonus };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const top = scored[0];
  const treatment = getTreatment(top?.key ?? "general_explainer")!;
  const matched = top?.matched ?? [];
  const reason = top
    ? `The headline and snippets match ${treatment.label.toLowerCase()} terms (${matched.slice(0, 6).join(", ") || "category"}). ${treatment.approach}`
    : "No strong story-type signal in the headline or snippets, so a general explainer is recommended. Choose another treatment if you know better.";
  const alternatives = [
    ...scored.slice(1, 4).map((x) => ({ key: x.key, label: getTreatment(x.key)!.label, matched: x.matched })),
    ...(treatment.key === "general_explainer" ? [] : [{ key: "general_explainer", label: "General explainer", matched: [] as string[] }]),
  ];
  return { treatment, matched, reason, alternatives };
}

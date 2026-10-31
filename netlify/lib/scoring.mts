// Transparent, deterministic story scoring. No AI. Pure functions (easy to test and replace).
//
// Every dimension is scored SEPARATELY with a plain-words reason. There is no single number that
// hides a weakness: weaknesses are returned as `flags` and shown next to the scores.
//
// The curiosity score is an EDITORIAL HYPOTHESIS built from keyword rules and the weights below.
// It does not predict audience behaviour and it is never a verification score. See docs/SCORING.md.

export const MODEL_VERSION = "rules-1";

export type SourceInput = {
  outlet: string;
  region: string;
  tier: "primary" | "reporting";
  publishedAt: string | null;
  retrievedAt: string | null;
  title: string;
  summary: string | null;
};
export type StoryInput = {
  id: string;
  headline: string;
  category: string | null;
  createdAt: string;
  sources: SourceInput[];
};

export type Dimension = { dimension: string; score: number; max: number; reason: string; detail?: Record<string, unknown> };
export type Scored = {
  story: StoryInput;
  dimensions: Dimension[];
  curiosity: number;
  patterns: { id: string; label: string; why: string }[];
  flags: string[];
  dominantRegion: string;
  regions: string[];
  hasPrimary: boolean;
  outlets: number;
  newest: number;
  get: (d: string) => number;
};

// Initial editorial hypotheses, kept in one place so they can be changed or calibrated later.
export const CURIOSITY_WEIGHTS: Record<string, number> = {
  curiosity_gap: 15,
  human_impact: 15,
  surprise: 12,
  consequences: 12,
  relevance: 10,
  novelty: 10,
  conversation_potential: 10,
  emotional_resonance: 6,
  scale: 5,
  hidden_connection: 5,
};

// Priority blend used ONLY to order candidates. Curiosity is gated by evidence quality.
export const PRIORITY_WEIGHTS = { significance: 0.28, curiosity: 0.2, relevance: 0.14, recency: 0.1, novelty: 0.1, evidence: 0.1, independence: 0.08 };

const hit = (text: string, words: RegExp) => [...new Set((text.match(words) ?? []).map((w) => w.toLowerCase()))];
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

const CUES = {
  gap: /\b(why|how|what|who|whether|unexpected|mystery|mysterious|unknown|unexplained|secret|behind|first time|unclear)\b|\?/gi,
  surprise: /\b(reverses|reversal|overturns|strikes down|scraps|u-turn|backtracks|surprising|unexpected|despite|instead|rare|first-ever|record|unprecedented|shock result|unexpectedly)\b/gi,
  consequence: /\b(will|could|ban|bans|banned|new rules|law|ruling|sanctions?|tariffs?|prices?|tax|taxes|shutdown|cuts?|ends|ending|ordered|orders|deadline|takes effect)\b/gi,
  people: /\b(health|hospital|disease|vaccine|cost|prices?|tax|jobs?|wages?|salary|workers|rights|safety|school|students|food|water|housing|rent|privacy|data|children|families|patients|pension|energy|electricity|flood|drought|heat)\b/gi,
  debate: /\b(debate|dispute|controvers\w*|divid\w*|vote|ruling|proposal|calls? for|ethic\w*|ban|rights|protest|challenge[sd]?|appeal)\b/gi,
  emotion: /\b(rescued|breakthrough|hope|cure|record|tragedy|dies|died|missing|recovery|reunite[sd]?|first|saved|survivors?|discovery|discovered)\b/gi,
  scale: /\b(global|worldwide|million|billion|nationwide|across|countries|world|continent|international)\b/gi,
  link: /\b(linked|link|links|connection|connected|tied to|ties|behind|reveals|reveal|drives|explains|why)\b/gi,
  accountability: /\b(lobby\w*|conflict of interest|accountab\w*|probe|investigat\w*|audit\w*|corruption|watchdog|inquiry|whistleblow\w*)\b/gi,
  discovery: /\b(discover\w*|found|finds|reveals?|study|researchers|scientists|breakthrough|new species|first evidence)\b/gi,
  institution: /\b(parliament|court|ministry|regulator|commission|council|central bank|government|senate|assembly|tribunal|agency)\b/gi,
  sigWords: /\b(law|ruling|court|parliament|treaty|regulation|ban|approve[sd]?|sanctions?|election|ceasefire|central bank|rate|vaccine|climate|summit|supreme)\b/gi,
  novel: /\b(first|new|unveil\w*|approves?|signs?|passes|launch\w*|announces?|introduces?|discover\w*|ruling|rules)\b/gi,
  recycled: /\b(anniversary|years ago|looks back|revisit\w*|remembering|throwback|explained|what we know)\b/gi,
  liveUpdate: /\b(live updates?|live blog|as it happened|minute by minute)\b/gi,
  clickbait: /\b(shocking|stunning|you won'?t believe|slams|destroys|bombshell|explosive|outrage[ds]?|meltdown|epic|jaw-dropping|unbelievable|hits back|blasts)\b/gi,
  vague: /\b(sources say|reportedly|allegedly|insiders?|it is believed|rumou?rs?)\b/gi,
  wire: /\b(reuters|associated press|afp|xinhua|pti|ani|anadolu|ap)\b/gi,
};

const PATTERNS: { id: string; label: string; re: RegExp; why: string }[] = [
  { id: "information_gap", label: "Information gap", re: CUES.gap, why: "raises a question the reader wants answered" },
  { id: "unexpected_reversal", label: "Unexpected reversal", re: /\b(reverses|overturns|strikes down|scraps|u-turn|backtracks|scrapped|rescinds|withdraws)\b/gi, why: "a decision or position changed direction" },
  { id: "before_after", label: "Before and after", re: /\b(now|no longer|replaces|replaced|from .{2,25} to|used to|ends|ended)\b/gi, why: "something that was one way is now another" },
  { id: "hidden_mechanism", label: "Hidden mechanism", re: /\b(behind|how .{2,30} works|mechanism|reason why|driving|drives)\b/gi, why: "points to how or why something really happens" },
  { id: "discovery", label: "Discovery or revelation", re: CUES.discovery, why: "reports something newly found or revealed" },
  { id: "unexpected_consequence", label: "Unexpected consequence", re: /\b(backfire[sd]?|unintended|knock-on|side effect|ripple|fallout|consequence[s]?)\b/gi, why: "an action had an effect nobody planned for" },
  { id: "expectation_vs_reality", label: "Expectation versus reality", re: /\b(despite|but|yet|contrary|than expected|fails? to|falls? short|defies)\b/gi, why: "outcome differs from what was expected" },
  { id: "human_story", label: "Human story behind a decision", re: /\b(families|residents|workers|patients|farmers|students|villagers|survivors|communit(y|ies))\b/gi, why: "ordinary people appear in the story of an institutional decision" },
  { id: "power_vs_people", label: "Powerful decision affecting ordinary people", re: /\b(government|court|ministry|regulator|council|parliament|central bank)\b.*\b(workers|families|residents|consumers|citizens|farmers|students|patients|households)\b/gi, why: "an institution's decision lands on ordinary people" },
  { id: "science_practical", label: "Science with practical implications", re: /\b(study|researchers|scientists|trial|vaccine|treatment|battery|crop|satellite)\b/gi, why: "research that could change something in practice" },
  { id: "belief_challenged", label: "Belief challenged by evidence", re: /\b(myth|wrong|overturns|challenges? (the )?(belief|assumption)|rethink|contradicts?)\b/gi, why: "new evidence questions something widely assumed" },
  { id: "small_large", label: "Small development, large implication", re: /\b(quietly|little-noticed|buried|small change|amendment|clause|rule change)\b/gi, why: "a minor-looking step with potentially wide effects" },
  { id: "accountability", label: "Competing interests or accountability", re: CUES.accountability, why: "scrutiny of who decided what, and in whose interest" },
];

const text = (s: StoryInput) => [s.headline, ...s.sources.map((x) => x.title), ...s.sources.map((x) => x.summary ?? "")].join(" ");

export function scoreStory(story: StoryInput, now = Date.now()): Scored {
  const headline = story.headline;
  const all = text(story);
  const outlets = new Set(story.sources.map((s) => s.outlet)).size;
  const regionCount = new Map<string, number>();
  for (const s of story.sources) regionCount.set(s.region, (regionCount.get(s.region) ?? 0) + 1);
  const regions = [...regionCount.keys()].sort();
  const dominantRegion = [...regionCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "Unknown";
  const hasPrimary = story.sources.some((s) => s.tier === "primary");
  const times = story.sources.map((s) => Date.parse(s.publishedAt ?? s.retrievedAt ?? "")).filter(Number.isFinite);
  const newest = times.length ? Math.max(...times) : 0;
  const hours = newest ? (now - newest) / 3_600_000 : Infinity;
  const dims: Dimension[] = [];
  const add = (dimension: string, score: number, max: number, reason: string, detail?: Record<string, unknown>) =>
    dims.push({ dimension, score: Math.round(score * 100) / 100, max, reason, detail });

  // --- Recency
  const rec = hours < 6 ? 5 : hours < 12 ? 4 : hours < 24 ? 3 : hours < 48 ? 2 : hours < 72 ? 1 : 0;
  add("recency", rec, 5, Number.isFinite(hours) ? `Newest report is about ${Math.round(hours)} hour(s) old.` : "No usable publication date, so recency is unknown (scored 0).");

  // --- Novelty
  const fresh = (now - Date.parse(story.createdAt)) / 3_600_000 < 36;
  const novelHits = hit(headline, CUES.novel);
  const recycled = hit(all, CUES.recycled);
  const live = hit(headline, CUES.liveUpdate);
  const nov = clamp((fresh ? 3 : 2) + (novelHits.length ? 1 : 0) - (recycled.length ? 2 : 0) - (live.length ? 1 : 0), 0, 5);
  add("novelty", nov, 5, `${fresh ? "First seen in the last day and a half" : "Already on the desk from an earlier run"}${novelHits.length ? `; new-development wording (${novelHits.join(", ")})` : ""}${recycled.length ? `; looks recycled or background (${recycled.join(", ")})` : ""}${live.length ? "; live-update format" : ""}.`);

  // --- Evidence quality (capped: only headlines and summaries are retrieved in this version)
  const evRaw = (hasPrimary ? 1 : 0) + (outlets >= 2 ? 1 : 0);
  add("evidence_quality", Math.min(evRaw, 2), 5, `${hasPrimary ? "Includes an official or primary source" : "No official or primary source"}; ${outlets >= 2 ? `${outlets} outlets` : "one outlet"}. Capped at 2 of 5: only headlines and short summaries were collected, no full text and no claim has been checked.`);

  // --- Source independence (capped: original-source tracing is not built yet)
  const wire = hit(all, CUES.wire);
  let ind = outlets <= 1 ? 0 : regions.length >= 2 ? 2 : 1;
  if (wire.length && ind > 0) ind -= 1;
  add("source_independence", ind, 5, `${outlets <= 1 ? "Single outlet: no independent confirmation." : `${outlets} outlets in ${regions.length} region(s), but they may all repeat one announcement`}${wire.length ? `; wire-service wording found (${wire.join(", ")}), so outlets may share one origin` : ""}. Capped at 2 of 5 until original sources can be traced.`);

  // --- Geographic spread of coverage
  add("geographic_spread", regions.length >= 3 ? 5 : regions.length === 2 ? 3 : 1, 5, `Covered from ${regions.length} region(s): ${regions.join(", ")}.`);

  // --- Editorial significance
  const base: Record<string, number> = {
    "Laws and regulations": 3, "Government and institutional decisions": 3, "Scientific discoveries": 3, "International affairs": 3,
    "Business and economic developments": 2, "Environment and climate": 3, "Public policy": 3, Technology: 2, "General world news": 1,
  };
  const sigHits = hit(headline + " " + all.slice(0, 600), CUES.sigWords);
  const inst = hit(headline, CUES.institution);
  const sig = clamp((base[story.category ?? ""] ?? 1) + Math.min(sigHits.length, 2) * 0.75 + (regions.length > 1 ? 0.5 : 0) + (hasPrimary ? 0.5 : 0) + (inst.length ? 0.25 : 0), 0, 5);
  add("editorial_significance", sig, 5, `Category "${story.category ?? "unknown"}"${sigHits.length ? `; significance wording (${sigHits.slice(0, 4).join(", ")})` : ""}${regions.length > 1 ? "; reported in more than one region" : ""}${hasPrimary ? "; official source present" : ""}.`);

  // --- Human relevance
  const ppl = hit(all, CUES.people);
  const rel = clamp(ppl.length * 1.25, 0, 5);
  add("human_relevance", rel, 5, ppl.length ? `Touches everyday life: ${ppl.slice(0, 5).join(", ")}.` : "No clear everyday-life wording found (the rules can miss subtle relevance).");

  // --- Curiosity (EDITORIAL HYPOTHESIS)
  const flags: string[] = [];
  const clickbait = hit(headline, CUES.clickbait);
  if (clickbait.length) flags.push(`Clickbait-style wording in headline (${clickbait.join(", ")}): excluded from scoring, rewrite before use`);
  if (hit(all, CUES.vague).length) flags.push(`Vague attribution (${hit(all, CUES.vague).join(", ")})`);
  if (live.length) flags.push("Live-update format: little standalone information");
  if (recycled.length) flags.push(`May be recycled or background (${recycled.join(", ")})`);
  if (outlets <= 1) flags.push("Single outlet: unconfirmed");
  if (ind <= 1 && outlets > 1) flags.push("Several outlets, but independence not established");
  if (!newest) flags.push("No publication date available");
  const caps = (v: number) => (clickbait.length ? Math.min(v, 0.3) : v);
  const comp: Record<string, { v: number; why: string }> = {};
  const g = hit(headline, CUES.gap);
  comp.curiosity_gap = { v: caps(g.length >= 2 ? 0.9 : g.length === 1 ? 0.6 : novelHits.length ? 0.3 : 0.15), why: g.length ? `raises a question (${g.join(", ")})` : "no clear question raised" };
  comp.human_impact = { v: clamp(ppl.length / 3, 0, 1), why: ppl.length ? `affects people (${ppl.slice(0, 4).join(", ")})` : "no direct effect on people found" };
  const sur = hit(all, CUES.surprise);
  comp.surprise = { v: sur.length >= 2 ? 1 : sur.length === 1 ? 0.6 : 0.1, why: sur.length ? `surprise wording (${sur.join(", ")})` : "no surprise or reversal wording" };
  const con = hit(headline + " " + all.slice(0, 500), CUES.consequence);
  comp.consequences = { v: clamp(con.length / 3, 0, 1), why: con.length ? `consequence wording (${con.slice(0, 4).join(", ")})` : "no stated consequences" };
  comp.relevance = { v: rel / 5, why: `from human relevance ${rel.toFixed(1)}/5` };
  comp.novelty = { v: nov / 5, why: `from novelty ${nov}/5` };
  const deb = hit(all, CUES.debate);
  comp.conversation_potential = { v: clamp(deb.length / 2 + (outlets > 1 ? 0.2 : 0), 0, 1), why: deb.length ? `debatable (${deb.slice(0, 4).join(", ")})` : "no obvious debate" };
  const emo = hit(all, CUES.emotion);
  comp.emotional_resonance = { v: caps(clamp(emo.length / 2, 0, 1)), why: emo.length ? `legitimate emotional cues (${emo.slice(0, 3).join(", ")})` : "no strong emotional cue" };
  const sc = hit(all, CUES.scale);
  comp.scale = { v: clamp(sc.length / 2 + (regions.length > 2 ? 0.3 : 0), 0, 1), why: sc.length ? `wide scale (${sc.slice(0, 3).join(", ")})` : "scale not indicated" };
  const lk = hit(headline + " " + all.slice(0, 500), CUES.link);
  comp.hidden_connection = { v: clamp(lk.length / 2, 0, 1), why: lk.length ? `connection wording (${lk.slice(0, 3).join(", ")})` : "no hidden link indicated" };
  let cur = 0;
  for (const [k, w] of Object.entries(CURIOSITY_WEIGHTS)) cur += w * comp[k].v;
  cur = Math.round(cur * 10) / 10;
  add("curiosity", cur, 100, `EDITORIAL HYPOTHESIS, not a prediction of audience behaviour and not a verification score. ${Object.entries(CURIOSITY_WEIGHTS).map(([k]) => `${k.replace(/_/g, " ")} ${(comp[k].v * CURIOSITY_WEIGHTS[k]).toFixed(1)}/${CURIOSITY_WEIGHTS[k]}`).join("; ")}.`, {
    components: Object.fromEntries(Object.entries(comp).map(([k, c]) => [k, { points: Math.round(c.v * CURIOSITY_WEIGHTS[k] * 10) / 10, max: CURIOSITY_WEIGHTS[k], why: c.why }])),
  });

  const patterns = PATTERNS.map((p) => ({ p, m: hit(p.id === "information_gap" ? headline : all, p.re) }))
    .filter((x) => x.m.length > 0 && !(x.p.id === "expectation_vs_reality" && x.m.every((w) => w === "but")))
    .map((x) => ({ id: x.p.id, label: x.p.label, why: `${x.p.why} (matched: ${x.m.slice(0, 3).join(", ")})` }));

  const scored: Scored = {
    story, dimensions: dims, curiosity: cur, patterns, flags, dominantRegion, regions, hasPrimary, outlets, newest,
    get: (d) => dims.find((x) => x.dimension === d)?.score ?? 0,
  };
  return scored;
}

export function priorityOf(s: Scored): number {
  const evid = s.get("evidence_quality") / 5;
  const gate = 0.4 + 0.6 * evid; // strong curiosity can never rescue weak evidence
  const w = PRIORITY_WEIGHTS;
  const p =
    w.significance * (s.get("editorial_significance") / 5) +
    w.curiosity * (s.curiosity / 100) * gate +
    w.relevance * (s.get("human_relevance") / 5) +
    w.recency * (s.get("recency") / 5) +
    w.novelty * (s.get("novelty") / 5) +
    w.evidence * evid +
    w.independence * (s.get("source_independence") / 5);
  return Math.round(p * 1000) / 10;
}

// ---------------- shortlist ----------------
export type Pick = { scored: Scored; priority: number; selected: boolean; rank: number | null; reason: string };

const UNDERREPORTED = ["Africa", "Latin America", "Oceania", "Middle East"];
const INSTITUTIONAL = ["Laws and regulations", "Government and institutional decisions", "Public policy"];

export function buildShortlist(items: Scored[], size = 12, opts = { regionCap: 4, categoryCap: 3, underreportedSlots: 3 }): { picks: Pick[]; heldBack: Pick[] } {
  const ranked = items.map((s) => ({ s, p: priorityOf(s) })).sort((a, b) => b.p - a.p || a.s.story.id.localeCompare(b.s.story.id));
  const chosen = new Map<string, { s: Scored; p: number; why: string }>();
  const regionN = new Map<string, number>(), catN = new Map<string, number>();
  const take = (x: { s: Scored; p: number }, why: string) => {
    chosen.set(x.s.story.id, { ...x, why });
    regionN.set(x.s.dominantRegion, (regionN.get(x.s.dominantRegion) ?? 0) + 1);
    catN.set(x.s.story.category ?? "", (catN.get(x.s.story.category ?? "") ?? 0) + 1);
  };
  const decent = (x: { s: Scored }) => x.s.get("editorial_significance") >= 2;

  // Reserved slots first, so strong-curiosity stories cannot crowd out underreported or quiet ones.
  const usedRegions = new Set<string>();
  for (const x of ranked) {
    if (usedRegions.size >= opts.underreportedSlots) break;
    if (UNDERREPORTED.includes(x.s.dominantRegion) && !usedRegions.has(x.s.dominantRegion) && decent(x)) {
      usedRegions.add(x.s.dominantRegion);
      take(x, `Reserved slot for an under-reported region (${x.s.dominantRegion}): its best-scoring story.`);
    }
  }
  const sci = ranked.find((x) => !chosen.has(x.s.story.id) && x.s.story.category === "Scientific discoveries" && decent(x));
  if (sci) take(sci, "Reserved slot for a scientific development.");
  const quiet = ranked.find((x) => !chosen.has(x.s.story.id) && x.s.hasPrimary && INSTITUTIONAL.includes(x.s.story.category ?? "") && decent(x));
  if (quiet) take(quiet, "Reserved slot for an official institutional change, which may not be dramatic but matters.");

  const skipped = new Map<string, string>();
  for (const x of ranked) {
    if (chosen.size >= size) break;
    if (chosen.has(x.s.story.id)) continue;
    if ((regionN.get(x.s.dominantRegion) ?? 0) >= opts.regionCap) { skipped.set(x.s.story.id, `Region cap reached (${opts.regionCap} stories already selected from ${x.s.dominantRegion}).`); continue; }
    if ((catN.get(x.s.story.category ?? "") ?? 0) >= opts.categoryCap) { skipped.set(x.s.story.id, `Category cap reached (${opts.categoryCap} stories already selected in "${x.s.story.category}").`); continue; }
    take(x, `Top priority: significance ${x.s.get("editorial_significance").toFixed(1)}/5, curiosity ${x.s.curiosity}/100, ${x.s.outlets} outlet(s).`);
  }
  // Second pass: if the category cap left empty places, relax ONLY the category cap (never the
  // region cap) and say so. The list may stay shorter than requested if diversity limits bind.
  for (const x of ranked) {
    if (chosen.size >= size) break;
    if (chosen.has(x.s.story.id)) continue;
    if ((regionN.get(x.s.dominantRegion) ?? 0) >= opts.regionCap) continue;
    take(x, `Added after the category limit was relaxed to fill the list: significance ${x.s.get("editorial_significance").toFixed(1)}/5, curiosity ${x.s.curiosity}/100, ${x.s.outlets} outlet(s).`);
  }
  const order = [...chosen.values()].sort((a, b) => b.p - a.p || a.s.story.id.localeCompare(b.s.story.id));
  const picks: Pick[] = order.map((x, i) => ({ scored: x.s, priority: x.p, selected: true, rank: i + 1, reason: x.why }));
  const cutoff = order.length ? order[order.length - 1].p : 0;
  // Nothing major disappears silently: strong-significance stories that missed out are listed with the reason.
  const heldBack: Pick[] = ranked
    .filter((x) => !chosen.has(x.s.story.id) && x.s.get("editorial_significance") >= 3.5)
    .slice(0, 12)
    .map((x) => ({ scored: x.s, priority: x.p, selected: false, rank: null, reason: skipped.get(x.s.story.id) ?? `Significant, but priority ${x.p} is below the shortlist cutoff of ${cutoff}.` }));
  return { picks, heldBack };
}

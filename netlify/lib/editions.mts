// Thematic edition engine: discovers genuine connections between developments, scores coherence transparently,
// proposes editions, and checks any selection. Deterministic and explainable. No AI. Shared keywords never
// establish a connection on their own: a theme or catalyst PLUS other signals are required, and weak
// connections are reported (not forced) with the reason.
import { createHash } from "node:crypto";
import { assessDevelopment, type Assessment } from "./curiosity.mts";
import { distanceKm, mentionedCountries, PLACES, placeByName, type Location } from "./geo.mts";
import { EVENT_TYPES, properNouns, themeById } from "./themes.mts";
import { CUES, hit, scoreStory, type Scored, type StoryInput } from "./scoring.mts";
import type { EvSource } from "./evidence-pack.mts";
import { jaccard, tokens } from "./cluster.mts";

export type Structure = "multi_country" | "single_country" | "event_roundup" | "news_roundup";
export const STRUCTURE_LABEL: Record<Structure, string> = { multi_country: "Multi-country synthesis", single_country: "Single-country deep dive", event_roundup: "Event-driven thematic roundup", news_roundup: "Multi-topic news roundup" };

export type Dev = {
  id: string; headline: string; category: string | null;
  sources: EvSource[]; scored: Scored; a: Assessment;
  proper: string[]; eventTypes: string[]; tokenSet: Set<string>; newest: number; outlets: Set<string>;
  consequenceWords: string[];
};

export const membersKey = (ids: string[]) => createHash("md5").update(ids.join(",")).digest("hex");

export function buildDev(input: StoryInput, sources: EvSource[], now = Date.now()): Dev {
  const scored = scoreStory(input, now);
  const a = assessDevelopment(scored, sources, now);
  const exclude = new Set<string>([...PLACES.map((p) => p.name.split(" ")[0]), ...input.sources.flatMap((s) => s.outlet.split(/\s+/))]);
  for (const c of mentionedCountries(input.headline)) exclude.add(c);
  const text = [input.headline, ...input.sources.map((s) => s.title)].join(" . ");
  return {
    id: input.id, headline: input.headline, category: input.category, sources, scored, a,
    proper: properNouns(text, exclude).filter((w) => !/^(Study|News|Daily|Times|Post|Today)$/.test(w)),
    eventTypes: hit(text, EVENT_TYPES).map((w) => w.replace(/s$/, "")),
    tokenSet: new Set(tokens(input.headline)), newest: scored.newest, outlets: new Set(input.sources.map((s) => s.outlet)),
    consequenceWords: [...new Set([...hit(text, CUES.consequence), ...hit(text, CUES.people)])],
  };
}

const countriesOf = (d: Dev) => [...new Set(d.a.locations.map((l) => l.country))];
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// ---------------- pairwise connection ----------------
export type Signal = { name: string; points: number; max: number; why: string };
export type Pair = { a: string; b: string; score: number; signals: Signal[]; duplicate: boolean; duplicateWhy?: string };

export function pairConnection(a: Dev, b: Dev): Pair {
  const sig: Signal[] = [];
  const add = (name: string, points: number, max: number, why: string) => sig.push({ name, points: Math.round(points * 10) / 10, max, why });
  const dup = jaccard(a.tokenSet, b.tokenSet).score >= 0.5;
  const sameProperAndCountry = a.proper.length > 0 && a.proper.filter((p) => b.proper.includes(p)).length >= 2 && countriesOf(a).join() === countriesOf(b).join() && countriesOf(a).length > 0;
  const duplicate = dup || sameProperAndCountry;

  const sharedThemes = a.a.themes.filter((t) => b.a.themes.some((u) => u.id === t.id));
  const th = sharedThemes[0];
  add("shared theme", th ? 30 * Math.min(1, (th.strength + (b.a.themes.find((u) => u.id === th.id)?.strength ?? 0)) / 1.2) : 0, 30, th ? `both match "${th.label}" (${th.matched.slice(0, 3).join(", ")})` : "no shared theme");
  const sp = a.proper.filter((p) => b.proper.includes(p));
  const se = a.eventTypes.filter((p) => b.eventTypes.includes(p));
  add("common catalyst", sp.length ? 20 : se.length ? 10 : 0, 20, sp.length ? `both mention ${sp.slice(0, 2).join(", ")}` : se.length ? `both concern the same kind of event (${se[0]})` : "no shared event or catalyst");
  const policy = (d: Dev) => ["law_regulation", "government_decision", "institutional_decision"].includes(d.a.type);
  add("related policy direction", th && policy(a) && policy(b) ? 10 : 0, 10, th && policy(a) && policy(b) ? "both are policy or institutional decisions on the same theme" : "not both policy decisions on a shared theme");
  const sc = a.consequenceWords.filter((w) => b.consequenceWords.includes(w));
  add("similar consequences", sc.length >= 2 ? 10 : sc.length === 1 ? 4 : 0, 10, sc.length ? `both mention ${sc.slice(0, 3).join(", ")}` : "no shared consequences");
  const ca = countriesOf(a), cb = countriesOf(b);
  const diff = ca.length && cb.length && !ca.some((c) => cb.includes(c));
  add("geographic comparison", diff && (th || sp.length) ? 10 : 0, 10, diff ? (th || sp.length ? `different places (${ca[0]} and ${cb[0]}) with a shared theme or catalyst` : "different places, but nothing else links them, so geography alone does not count") : "same place or place unknown");
  const gap = a.newest && b.newest ? Math.abs(a.newest - b.newest) / 3_600_000 : Infinity;
  add("chronology", gap <= 72 ? 10 : gap <= 168 ? 5 : 0, 10, Number.isFinite(gap) ? `reported ${Math.round(gap)} hour(s) apart` : "no dates");
  add("contrasting responses", th && diff ? 10 : 0, 10, th && diff ? "same theme handled in different places: a contrast is available" : "no contrast found");
  add("complementary evidence", a.a.type !== b.a.type || a.scored.hasPrimary !== b.scored.hasPrimary ? 5 : 0, 5, a.a.type !== b.a.type ? "different development types" : a.scored.hasPrimary !== b.scored.hasPrimary ? "official and reported sources complement each other" : "same type of evidence");
  let score = sig.reduce((x, s) => x + s.points, 0);
  if (!th && !sp.length && !se.length) score = Math.min(score, 25); // no theme or catalyst: never more than a weak link
  return { a: a.id, b: b.id, score: Math.round(clamp(score, 0, 100)), signals: sig, duplicate, duplicateWhy: duplicate ? (dup ? "near-identical headlines: probably the same underlying event" : "same named subjects in the same place") : undefined };
}

// ---------------- edition evaluation ----------------
export type Component = { name: string; points: number; max: number; why: string };
export type Evaluation = {
  ids: string[]; structure: Structure; structureLabel: string; roundup: boolean; suggestedStructure: Structure; theme: string; themeId: string | null; catalyst: string | null; title: string; angle: string;
  coherence: { score: number | null; verdict: "COHERENT" | "WEAK" | "INCOHERENT" | "SINGLE DEVELOPMENT"; components: Component[] };
  metrics: { curiosityPotential: number; evidenceStrength: { label: string; score: number; weakest: string }; timelinessHours: number | null; humanRelevance: number };
  locations: Location[];
  sequence: { id: string; headline: string; role: string; why: string }[];
  contributions: { id: string; headline: string; adds: string; avgConnection: number }[];
  whyItMatters: string;
  uncertainties: string[];
  check: {
    belongTogether: string; centralArgument: string; strongestOpening: string; logicalSequence: string; repetition: string[]; geographicDimension: string; mapUseful: boolean; mapWhy: string;
    valueVersusSeparate: string; weaklyConnected: { id: string; headline: string; why: string }[]; conflicts: string[]; recommendations: string[];
  };
  pairs: Pair[];
};

const hookScore = (d: Dev) => d.a.curiosityScore * (0.4 + 0.6 * (d.scored.get("evidence_quality") / 5)) + (d.a.corroborated ? 10 : 0);

export function evaluateEdition(members: Dev[], opts: { conflictNotes?: string[]; now?: number; structure?: Structure } = {}): Evaluation {
  const n = members.length;
  const ids = members.map((m) => m.id);
  const pairs: Pair[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push(pairConnection(members[i], members[j]));

  // theme and catalyst coverage
  const themeCount = new Map<string, { n: number; label: string; q: string }>();
  for (const m of members) for (const t of m.a.themes) { const c = themeCount.get(t.id) ?? { n: 0, label: t.label, q: t.question }; c.n++; themeCount.set(t.id, c); }
  const bestTheme = [...themeCount.entries()].sort((a, b) => b[1].n - a[1].n)[0];
  const themeCoverage = n >= 2 && bestTheme && bestTheme[1].n >= 2 ? bestTheme[1].n / n : 0; // a theme must be shared by at least two developments
  const nounCount = new Map<string, number>();
  for (const m of members) for (const w of new Set([...m.proper, ...m.eventTypes.map((e) => `event:${e}`)])) nounCount.set(w, (nounCount.get(w) ?? 0) + 1);
  const bestNoun = [...nounCount.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1] || Number(a[0].startsWith("event:")) - Number(b[0].startsWith("event:")))[0];
  const catalystCoverage = n >= 2 && bestNoun ? bestNoun[1] / n : 0;
  const catalyst = bestNoun ? bestNoun[0].replace(/^event:/, "") : null;
  const hasLink = themeCoverage > 0 || catalystCoverage > 0;
  const linkCov = Math.max(themeCoverage, catalystCoverage); // share of members actually tied together

  const countries = [...new Set(members.flatMap(countriesOf))];
  const locs: Location[] = [];
  for (const m of members) for (const l of m.a.locations) if (!locs.some((x) => x.country === l.country)) locs.push(l);
  const times = members.map((m) => m.newest).filter(Boolean);
  const span = times.length >= 2 ? (Math.max(...times) - Math.min(...times)) / 3_600_000 : 0;
  const types = new Set(members.map((m) => m.a.type));
  const avgConn = (id: string) => {
    const ps = pairs.filter((p) => p.a === id || p.b === id);
    return ps.length ? Math.round(ps.reduce((x, p) => x + p.score, 0) / ps.length) : 0;
  };

  const comps: Component[] = [];
  const addC = (name: string, points: number, max: number, why: string) => comps.push({ name, points: Math.round(points * 10) / 10, max, why });
  addC("shared theme", 25 * themeCoverage, 25, bestTheme && themeCoverage ? `${bestTheme[1].n} of ${n} developments match "${bestTheme[1].label}"` : "no theme shared by the developments");
  addC("common catalyst", 15 * catalystCoverage, 15, catalyst ? `${bestNoun![1]} of ${n} share "${catalyst}"` : "no shared event or named catalyst");
  const geoPts = hasLink && countries.length >= 2 ? Math.min(15, 7 + countries.length * 2) * linkCov : 0;
  addC("geographic relationship", geoPts, 15, countries.length >= 2 ? (hasLink ? `${countries.length} places (${countries.slice(0, 5).join(", ")}) linked by a theme or catalyst` : `${countries.length} places, but with no theme or catalyst geography does not count`) : "one place or none established");
  addC("chronology", n >= 2 && times.length >= 2 ? (span <= 72 ? 10 : span <= 168 ? 5 : 0) : 0, 10, times.length >= 2 ? `reports span ${Math.round(span)} hour(s)` : "dates unavailable");
  addC("complementary evidence", hasLink && (types.size >= 2 || members.some((m) => m.scored.hasPrimary) && members.some((m) => !m.scored.hasPrimary)) ? 10 * linkCov : 0, 10, types.size >= 2 ? `${types.size} kinds of development` : "similar kinds of development");
  addC("contrasting responses", hasLink && countries.length >= 2 ? 10 * linkCov : 0, 10, hasLink && countries.length >= 2 ? "the same theme is handled differently in different places" : "no contrast available");
  const inLink = (m: Dev) => (bestTheme && themeCoverage ? m.a.themes.some((t) => t.id === bestTheme[0]) : false) || (bestNoun ? m.proper.includes(bestNoun[0]) || m.eventTypes.some((e) => `event:${e}` === bestNoun[0]) : false);
  const weakIds = members.filter((m) => n >= 2 && (avgConn(m.id) < 25 || (hasLink && !inLink(m)))).map((m) => m.id);
  addC("narrative coherence", n >= 2 ? 15 * ((n - weakIds.length) / n) : 0, 15, n >= 2 ? `${n - weakIds.length} of ${n} developments connect to the rest` : "single development");
  let score = Math.round(comps.reduce((x, c) => x + c.points, 0));
  if (n >= 2 && !hasLink) score = Math.min(score, 39); // without a theme or catalyst there is no genuine connection
  else if (n >= 2 && linkCov < 0.6) score = Math.min(score, 55); // most developments are not tied to the connecting theme
  const dupPairs = pairs.filter((p) => p.duplicate);
  if (dupPairs.length) score = Math.min(score, 45);
  const verdict: Evaluation["coherence"]["verdict"] = n < 2 ? "SINGLE DEVELOPMENT" : score >= 60 ? "COHERENT" : score >= 40 ? "WEAK" : "INCOHERENT";

  // structure
  const namedCatalyst = !!bestNoun && !bestNoun[0].startsWith("event:");
  const autoRoundup = n >= 2 && verdict !== "COHERENT"; // no genuine connection: honest multi-topic roundup instead of an invented theme
  const roundup = opts.structure ? opts.structure === "news_roundup" && n >= 2 : autoRoundup; // the editor may override the suggestion
  const autoStructure: Structure = autoRoundup ? "news_roundup" : catalystCoverage >= 0.5 && n >= 2 && (namedCatalyst || (catalystCoverage > themeCoverage && countries.length >= 2)) ? "event_roundup" : countries.length >= 2 ? "multi_country" : "single_country";
  const structure: Structure = opts.structure ?? autoStructure;
  const themeLabel = bestTheme && themeCoverage ? bestTheme[1].label : n === 1 ? members[0].a.typeLabel : "No shared theme";
  const place = countries.length === 1 ? countries[0] : null;
  const title = structure === "news_roundup" ? `Today's developments: ${(countries.slice(0, 4).join(", ") || `${n} stories`)}${countries.length > 4 ? " and more" : ""}`
    : structure === "event_roundup" && catalyst ? `How are countries responding to ${catalyst}?`
    : structure === "multi_country" && bestTheme && themeCoverage ? bestTheme[1].q.replace(/\?$/, "?")
    : structure === "single_country" && place ? (bestTheme && themeCoverage ? `What is driving ${place}'s moves on ${themeLabel.toLowerCase()}?` : `What explains the latest developments in ${place}?`)
    : n === 1 ? members[0].headline : "Unthemed selection";
  const angle = structure === "news_roundup" ? `A fast, clear briefing on ${n} separate developments. Each story gets its own short segment and a plain transition; no link between them is claimed. Order is chosen for pace and variety.`
    : structure === "multi_country" ? `Compare how ${countries.slice(0, 4).join(", ")} are approaching "${themeLabel}", and show what the differences reveal about the wider trend.`
    : structure === "event_roundup" ? `Follow ${catalyst ?? "the shared event"} across ${countries.slice(0, 4).join(", ") || "the places involved"}, showing how each responded and what they share.`
    : `Explain ${place ?? "the development"} through its contributing factors and consequences, and connect it outward only where the evidence does.`;

  // sequence: strongest evidence-backed hook first, then nearest-neighbour geography, widest implication last
  const rest = [...members];
  rest.sort((a, b) => hookScore(b) - hookScore(a));
  const opening = rest.shift();
  const order: Dev[] = opening ? [opening] : [];
  const centroid = (d: Dev) => d.a.locations[0];
  while (rest.length && roundup) {
    const prev = order[order.length - 1];
    const left = (t: string) => rest.filter((x) => x.a.type === t).length;
    const cand = rest.filter((x) => x.a.type !== prev.a.type);
    // alternate kinds of story for pace; take from the most common remaining kind first so two of a kind are not stranded at the end
    const pick = cand.length ? cand.reduce((best, x) => (left(x.a.type) > left(best.a.type) ? x : best), cand[0]) : rest[0];
    rest.splice(rest.indexOf(pick), 1);
    order.push(pick);
  }
  while (rest.length) {
    const last = centroid(order[order.length - 1]);
    rest.sort((a, b) => (last && centroid(a) && centroid(b) ? distanceKm(last, centroid(a)) - distanceKm(last, centroid(b)) : hookScore(b) - hookScore(a)));
    order.push(rest.shift()!);
  }
  const sequence = order.map((m, i) => ({
    id: m.id, headline: m.headline,
    role: i === 0 ? (n === 1 ? "Anchor" : "Opening: strongest evidence-backed hook") : roundup ? (i === n - 1 && n >= 3 ? "Closing segment: a separate development, then the recap" : `Segment ${i + 1}: a separate development (${m.a.typeLabel})`) : i === n - 1 && n >= 3 ? "Closing: widest implication and what remains open" : "Comparison: what differs here",
    why: roundup && i > 0 ? `Placed for pace: a different kind of story from the one before${centroid(m) ? ` (${centroid(m).country})` : ""}. No connection claimed.` : i === 0 ? `Highest hook value (curiosity ${m.a.curiosityScore}, ${m.a.corroborated ? "corroborated" : "single outlet, so framed as unconfirmed"}).` : `Next nearest place or theme${centroid(m) ? ` (${centroid(m).country})` : ""}, keeping the map movement short.`,
  }));

  const contributions = members.map((m) => ({
    id: m.id, headline: m.headline,
    adds: `${m.a.typeLabel}${countriesOf(m).length ? ` in ${countriesOf(m).join(", ")}` : ""}${m.a.themes[0] ? `; theme "${m.a.themes[0].label}"` : ""}`,
    avgConnection: avgConn(m.id),
  }));

  const weakEv = members.filter((m) => !m.a.corroborated);
  const worst = members.reduce((w, m) => (m.scored.get("evidence_quality") < w.score ? { score: m.scored.get("evidence_quality"), id: m.id } : w), { score: 99, id: "" });
  const evScore = worst.score === 99 ? 0 : worst.score;
  const textPlaces = locs.filter((l) => l.basis === "mentioned in the retrieved text").length;
  const mapUseful = roundup ? textPlaces >= 2 : textPlaces >= 2 && hasLink && linkCov >= 0.6;
  const uncertain = [
    roundup ? "This is a multi-topic roundup: NO connection between the developments is claimed. They are grouped because the editor chose them." : "The connection is inferred from fixed rules (themes, shared events, places, timing). The editor must judge whether it is real.",
    ...(weakEv.length ? [`Single-outlet developments (unconfirmed): ${weakEv.map((m) => m.headline).join("; ")}.`] : []),
    ...members.flatMap((m) => m.a.missingEvidence.filter((x) => !/Full article text/.test(x)).slice(0, 2).map((x) => `${m.headline}: ${x}`)).slice(0, 6),
    "Full article text was not read for any development.",
    ...(locs.some((l) => l.basis === "publisher location only") ? ["Some places are the publisher's location, not confirmed event locations."] : []),
  ];
  const conflicts = (opts.conflictNotes ?? []).filter(Boolean);
  const recs: string[] = [];
  if (roundup) recs.push("No genuine shared theme was found, so this is treated as a multi-topic news roundup (no invented connection). To make a thematic edition instead, choose stories that share a real issue or event.");
  if (n >= 2 && !roundup && hasLink && linkCov < 0.6) recs.push(`Only ${Math.round(linkCov * n)} of ${n} developments share the connecting theme or event. The others are weakly connected; consider separate coverage for them.`);
  
  for (const id of roundup ? [] : weakIds) recs.push(`Consider removing or replacing "${members.find((m) => m.id === id)!.headline}": average connection to the others is ${avgConn(id)}/100.`);
  for (const p of dupPairs) recs.push(`"${members.find((m) => m.id === p.a)!.headline}" and "${members.find((m) => m.id === p.b)!.headline}" look like one underlying event (${p.duplicateWhy}). Keep one.`);
  if (weakEv.length) recs.push("Frame single-outlet developments as 'reported by', or wait for confirmation.");
  if (n === 2 && verdict === "COHERENT") recs.push("A coherent two-development edition is fine; do not add unrelated stories to reach a target number.");

  const check: Evaluation["check"] = {
    belongTogether: roundup ? "They do not share a genuine theme, and that is fine for a roundup: each is a separate development presented in turn, with no connection claimed." : n < 2 ? "Only one development: this is a deep dive, not a synthesis." : verdict === "COHERENT" ? `Yes: they share ${[themeCoverage ? `the theme "${themeLabel}"` : "", catalyst ? `the catalyst "${catalyst}"` : ""].filter(Boolean).join(" and ")}.` : verdict === "WEAK" ? "Only partly: the connection is thin. Review the weakly connected developments below." : "No: the rules found no genuine connection. Do not force one.",
    centralArgument: angle,
    strongestOpening: order[0] ? `"${order[0].headline}" (${sequence[0].why})` : "none",
    logicalSequence: sequence.map((s, i) => `${i + 1}. ${s.headline}`).join("  ->  "),
    repetition: dupPairs.map((p) => `${p.duplicateWhy}: ${members.find((m) => m.id === p.a)!.headline} / ${members.find((m) => m.id === p.b)!.headline}`),
    geographicDimension: countries.length >= 2 ? `${countries.length} places: ${countries.join(", ")}.` : countries.length === 1 ? `One place: ${countries[0]}.` : "No place could be established.",
    mapUseful,
    mapWhy: roundup && mapUseful ? "A locator map can show where each separate story happened. Markers only: no routes, lines or arrows between places, because no connection is claimed." : mapUseful ? "A map shows where each development sits and how the places compare, which a list cannot." : countries.length < 2 ? "Fewer than two named places, so a map would be decorative. Prefer a timeline or comparison." : hasLink ? "Places are mostly publisher locations, not confirmed event locations, so a map could mislead." : "The places are not linked by a theme or event, so a map would imply a connection the evidence does not show.",
    valueVersusSeparate: roundup ? "One briefing instead of separate videos: pace and convenience for the audience. It adds no analytical synthesis, and does not claim any." : n < 2 ? "Not applicable to a single development." : verdict === "COHERENT" ? "Together they show a pattern and a comparison that no single story shows." : "Not clearly better than separate coverage.",
    weaklyConnected: (roundup ? [] : weakIds).map((id) => ({ id, headline: members.find((m) => m.id === id)!.headline, why: `average connection ${avgConn(id)}/100` })),
    conflicts, recommendations: recs,
  };

  const hrs = times.length ? Math.round((((opts.now ?? Date.now()) - Math.max(...times)) / 3_600_000) * 10) / 10 : null;
  const cur = members.length ? Math.round((members.reduce((x, m) => x + m.a.curiosityScore, 0) / n + (verdict === "COHERENT" ? 8 : 0)) * 10) / 10 : 0;
  return {
    ids, structure, structureLabel: STRUCTURE_LABEL[structure], roundup, suggestedStructure: autoStructure, theme: themeLabel, themeId: bestTheme && themeCoverage ? bestTheme[0] : null, catalyst, title, angle,
    coherence: { score: n < 2 ? null : score, verdict, components: comps },
    metrics: { curiosityPotential: cur, evidenceStrength: { label: evScore >= 2 ? "MODERATE" : evScore >= 1 ? "LIMITED" : "WEAK", score: evScore, weakest: worst.id ? members.find((m) => m.id === worst.id)!.headline : "" }, timelinessHours: hrs, humanRelevance: Math.round((members.reduce((x, m) => x + m.scored.get("human_relevance"), 0) / Math.max(n, 1)) * 10) / 10 },
    locations: locs, sequence, contributions,
    whyItMatters: n < 2 ? "A single development explained in depth." : roundup ? `A quick, accurate briefing on ${n} separate developments the editor judged important today. Each is explained on its own evidence.` : verdict === "COHERENT" ? `Seen together, ${members.length} developments reveal a pattern ("${themeLabel}") that no single report shows${countries.length >= 2 ? `, and the comparison between ${countries.slice(0, 3).join(", ")} shows how responses differ` : ""}.` : "The combination adds little over separate coverage.",
    uncertainties: uncertain, check, pairs,
  };
}

// ---------------- suggestions ----------------
export type Suggested = Evaluation & { key: string; rank: number; blended: number; excluded: { id: string; headline: string; reason: string }[]; };
export type Suggestions = { editions: Suggested[]; weakConnections: Suggested[]; unmatched: { id: string; headline: string; recommendation: string; why: string }[]; ineligible: { id: string; headline: string; reason: string }[] };

const ELIGIBLE = new Set(["HIGH-POTENTIAL STORY", "STRONG EDITION CANDIDATE"]);
export function suggestEditions(pool: Dev[], opts: { max?: number; now?: number } = {}): Suggestions {
  const ineligible: Suggestions["ineligible"] = [];
  const eligible: Dev[] = [];
  for (const d of pool) {
    if (ELIGIBLE.has(d.a.recommendation) || (d.a.corroborated && d.a.curiosityScore >= 20 && !d.a.sensationalismFlags.length && !["RELEVANT BUT NOT TIMELY", "HOLD FOR FUTURE DEVELOPMENTS"].includes(d.a.recommendation))) eligible.push(d);
    else ineligible.push({ id: d.id, headline: d.headline, reason: `${d.a.recommendation}: ${d.a.recommendationWhy}` });
  }
  // collapse duplicate reporting of one event: keep the best-evidenced
  const kept: Dev[] = [];
  const dupNote = new Map<string, string>();
  for (const d of [...eligible].sort((a, b) => hookScore(b) - hookScore(a))) {
    const twin = kept.find((k) => pairConnection(k, d).duplicate);
    if (twin) { dupNote.set(d.id, `Duplicate reporting of "${twin.headline}" (same underlying event)`); ineligible.push({ id: d.id, headline: d.headline, reason: dupNote.get(d.id)! }); } else kept.push(d);
  }

  const groups = new Map<string, { ids: string[]; basis: string }>();
  const addGroup = (ids: string[], basis: string) => {
    const u = [...new Set(ids)].sort();
    if (u.length >= 2) groups.set(membersKey(u), { ids: u, basis });
  };
  for (const [id, th] of new Map(kept.flatMap((d) => d.a.themes.map((t) => [t.id, t] as const)))) {
    void th;
    addGroup(kept.filter((d) => d.a.themes.some((t) => t.id === id)).map((d) => d.id), `theme:${id}`);
  }
  const nouns = new Map<string, string[]>();
  for (const d of kept) for (const w of new Set([...d.proper, ...d.eventTypes.map((e) => `event:${e}`)])) nouns.set(w, [...(nouns.get(w) ?? []), d.id]);
  for (const [w, ids] of nouns) if (ids.length >= 2 && ids.length <= Math.max(3, Math.ceil(kept.length * 0.4))) addGroup(ids, `catalyst:${w}`);
  const byCountry = new Map<string, string[]>();
  for (const d of kept) for (const c of countriesOf(d)) byCountry.set(c, [...(byCountry.get(c) ?? []), d.id]);
  for (const [c, ids] of byCountry) addGroup(ids, `country:${c}`);

  const byId = new Map(kept.map((d) => [d.id, d]));
  const evaluated: Suggested[] = [];
  for (const [key, g] of groups) {
    let members = g.ids.map((id) => byId.get(id)!).sort((a, b) => hookScore(b) - hookScore(a));
    const excluded: Suggested["excluded"] = [];
    if (members.length > 6) { for (const m of members.slice(6)) excluded.push({ id: m.id, headline: m.headline, reason: "Edition limit of 6 developments; lowest hook value dropped" }); members = members.slice(0, 6); }
    let ev = evaluateEdition(members, { now: opts.now });
    // drop members whose connection to the rest is weak, and explain why
    for (const w of ev.check.weaklyConnected) {
      if (members.length <= 2) break;
      excluded.push({ id: w.id, headline: w.headline, reason: `Weak connection to the rest (${w.why})` });
      members = members.filter((m) => m.id !== w.id);
      ev = evaluateEdition(members, { now: opts.now });
    }
    const blended = Math.round(((ev.coherence.score ?? 0) * 0.5 + clamp(ev.metrics.curiosityPotential * 1.6, 0, 100) * 0.25 + (ev.metrics.evidenceStrength.score / 5) * 100 * 0.25) * 10) / 10;
    evaluated.push({ ...ev, key: membersKey(ev.ids), rank: 0, blended, excluded });
  }
  // remove edition candidates that are subsets of a better one
  evaluated.sort((a, b) => b.blended - a.blended || a.key.localeCompare(b.key));
  const result: Suggested[] = [];
  for (const e of evaluated) {
    // a larger coherent edition replaces a smaller one it contains (do not shrink an edition needlessly)
    const inner = result.findIndex((r) => r.ids.every((i) => e.ids.includes(i)) && r.ids.length < e.ids.length);
    if (inner >= 0 && (e.coherence.score ?? 0) >= (result[inner].coherence.score ?? 0) - 10 && e.coherence.verdict === "COHERENT") { result.splice(inner, 1, e); continue; }
    if (result.some((r) => e.ids.every((i) => r.ids.includes(i)))) continue;
    if (result.some((r) => r.ids.filter((i) => e.ids.includes(i)).length >= Math.max(2, Math.ceil(e.ids.length * 0.67)))) continue; // mostly overlapping
    result.push(e);
  }
  const good = result.filter((e) => e.coherence.verdict === "COHERENT" && (e.coherence.score ?? 0) >= 60).slice(0, opts.max ?? 6).map((e, i) => ({ ...e, rank: i + 1 }));
  const weak = result.filter((e) => e.coherence.verdict !== "COHERENT").slice(0, 6);
  const used = new Set(good.flatMap((e) => e.ids));
  const unmatched = kept.filter((d) => !used.has(d.id) && ELIGIBLE.has(d.a.recommendation)).slice(0, 8).map((d) => ({ id: d.id, headline: d.headline, recommendation: d.a.recommendation, why: "No suitable related development found. Consider a single-story prompt." }));
  return { editions: good, weakConnections: weak, unmatched, ineligible };
}
void themeById; void placeByName;

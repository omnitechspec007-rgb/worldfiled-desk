// Edition engine: connection discovery, coherence, structures, exclusions. Pure functions, no network.
import { buildDev, evaluateEdition, pairConnection, suggestEditions, type Dev } from "../netlify/lib/editions.mts";
import type { StoryInput } from "../netlify/lib/scoring.mts";
import type { EvSource } from "../netlify/lib/evidence-pack.mts";

let pass = 0, fail = 0;
const check = (n: string, v: boolean) => { console.log((v ? "PASS " : "FAIL ") + n); v ? pass++ : fail++; };
const NOW = Date.parse("2026-10-31T12:00:00Z");
const ago = (h: number) => new Date(NOW - h * 3600_000).toISOString();
type S = { outlet: string; tier?: "primary" | "reporting"; title: string; summary: string; ago?: number };
function mk(id: string, headline: string, category: string, sources: S[]): Dev {
  const input: StoryInput = { id, headline, category, createdAt: ago(3), sources: sources.map((s) => ({ outlet: s.outlet, region: "Europe", tier: s.tier ?? "reporting", publishedAt: ago(s.ago ?? 5), retrievedAt: ago(1), title: s.title, summary: s.summary })) };
  const ev: EvSource[] = sources.map((s) => ({ outlet: s.outlet, region: "Europe", tier: s.tier ?? "reporting", url: `https://${s.outlet.toLowerCase().replace(/\W/g, "")}.example/${id}`, title: s.title, summary: s.summary, publishedAt: ago(s.ago ?? 5), retrievedAt: ago(1) }));
  return buildDev(input, ev, NOW);
}
const two = (id: string, prefix: string, headline: string, cat: string, a: [string, string], b: [string, string], official = false): Dev =>
  mk(id, headline, cat, [{ outlet: `${prefix} Gazette`, tier: official ? "primary" : "reporting", title: a[0], summary: a[1] }, { outlet: `${prefix} Times`, title: b[0], summary: b[1] }]);

// ---- A. multi-country synthesis: preparedness ----
const jp = two("jp", "Tokyo", "Japan orders new emergency preparedness plan with stockpiles for families", "Government and institutional decisions", ["Japan updates national preparedness and stockpile directive", "Government ministry orders households and local councils to stockpile water and food for disasters."], ["Tokyo tightens emergency readiness rules", "Families must keep supplies; shelters and early warning expanded in Japan."], true);
const fi = two("fi", "Helsinki", "Finland publishes civil defence guide on household resilience and shelters", "Public policy", ["Finland issues civil defence guidance for every household", "Agency tells citizens to prepare emergency supplies; shelters and resilience plan updated."], ["Finnish residents get preparedness booklet", "Authorities say crisis plan and readiness for disruption has been rewritten in Finland."], true);
const cl = two("cl", "Santiago", "Chile launches earthquake early warning and evacuation programme", "Public policy", ["Chile expands early warning and evacuation drills nationwide", "The government programme improves disaster readiness and shelters in Chile."], ["Chile rolls out emergency alert system", "Authorities in Chile say preparedness for earthquakes and tsunami evacuation will be tested."]);
const ke = two("ke", "Nairobi", "Kenya announces national drought contingency fund and early warning", "Public policy", ["Kenya sets up drought contingency and early warning fund", "The government says disaster readiness and emergency response will be funded in Kenya."], ["Kenya backs drought preparedness plan", "A contingency fund and early warning network will protect families from drought, officials in Kenya said."]);
const privacy = two("pv", "Lagos", "Nigeria passes data protection law with fines for breaches of personal data", "Laws and regulations", ["Nigeria passes data protection act with privacy fines", "The new law protects personal data and sets penalties for data breach."], ["Nigeria's privacy law signed", "Lawmakers approve the data protection bill covering biometric data."]);
const space = two("sp", "Canberra", "Telescope finds exoplanet atmosphere with water signal, researchers say", "Scientific discoveries", ["Telescope detects water in exoplanet atmosphere", "Astronomers report a new finding from the space telescope."], ["Astronomers find water vapour on distant planet", "Researchers say the telescope study is a breakthrough."]);
const rates = two("rt", "Brasilia", "Central bank in Brazil raises interest rates as inflation climbs", "Business and economic developments", ["Brazil raises interest rates to fight inflation", "The central bank decision affects mortgages, prices and wages."], ["Brazilian central bank hikes rate", "Inflation and currency pressure drive the rate rise in Brazil."]);

const all = suggestEditions([jp, fi, cl, ke, privacy, space, rates], { now: NOW });
const prep = all.editions.find((e) => e.ids.includes("jp") && e.ids.includes("fi"));
check("multi-country: a preparedness edition is suggested", !!prep);
check("multi-country: structure is multi-country synthesis with 3+ countries", prep?.structure === "multi_country" && (prep?.locations.length ?? 0) >= 3);
check("multi-country: theme and question stated", prep?.theme === "Preparing for disruption" && /prepare for disruption/.test(prep?.title ?? ""));
check("multi-country: coherent with transparent components", prep?.coherence.verdict === "COHERENT" && prep.coherence.components.length === 7 && prep.coherence.components.every((c) => c.why.length > 5));
check("multi-country: unrelated stories (rates, space, privacy) are NOT forced in", !!prep && !prep.ids.some((i) => ["rt", "sp", "pv"].includes(i)));
check("multi-country: records why each member is included and its contribution", !!prep && prep.contributions.length === prep.ids.length && prep.contributions.every((c) => c.adds.length > 5));
check("multi-country: sequence opens with the strongest hook and covers every member once", !!prep && prep.sequence.length === prep.ids.length && new Set(prep.sequence.map((s) => s.id)).size === prep.ids.length && /Opening/.test(prep.sequence[0].role));
check("multi-country: map judged useful and places grounded as 'mentioned in the retrieved text'", !!prep && prep.check.mapUseful && prep.locations.every((l) => l.basis === "mentioned in the retrieved text"));
check("multi-country: edition reports evidence, timeliness and uncertainty", !!prep && prep.metrics.evidenceStrength.label.length > 0 && prep.metrics.timelinessHours !== null && prep.uncertainties.length >= 2);
check("no edition mixes unrelated themes: every suggestion is coherent", all.editions.every((e) => e.coherence.verdict === "COHERENT"));

// ---- B. single-country deep dive ----
const jq = two("jq", "Osaka", "Japan strengthens earthquake building codes after coastal survey", "Laws and regulations", ["Japan revises building rules for earthquake zones", "New law requires reinforced buildings; officials cite previous disasters and shelters in Japan."], ["Japan tightens seismic building law", "Ministry says earthquake resilience and evacuation are the aim in Japan."]);
const jr = two("jr", "Kyoto", "Japan funds seawalls and evacuation towers along earthquake coast", "Public policy", ["Japan approves seawall and evacuation tower funding", "The government says coastal resilience and shelters will be built for earthquake and tsunami risk in Japan."], ["Japan builds tsunami evacuation towers", "Funding for coastal readiness and early warning announced in Japan."]);
const deep = suggestEditions([jq, jr, space, rates], { now: NOW });
const dd = deep.editions[0];
check("single-country: both Japanese developments form one deep dive", !!dd && dd.structure === "single_country" && dd.ids.includes("jq") && dd.ids.includes("jr"));
check("single-country: title names the country", /Japan/.test(dd?.title ?? ""));
check("single-country: map judged NOT useful (one place) with a reason", !!dd && !dd.check.mapUseful && /decorative|Fewer than two/.test(dd.check.mapWhy));

// ---- C. event-driven roundup ----
const ev1 = two("e1", "Manila", "Cyclone Zarina forces evacuations across the Philippines", "Environment and climate", ["Cyclone Zarina hits Philippines, thousands evacuated", "Storm Zarina brought floods and the government ordered shelters opened."], ["Philippines evacuates as Zarina nears", "Authorities report flood damage from the cyclone."]);
const ev2 = two("e2", "Hanoi", "Vietnam closes ports as Cyclone Zarina approaches", "Environment and climate", ["Vietnam shuts ports ahead of Zarina", "Officials in Vietnam warn of storm surge from Cyclone Zarina."], ["Vietnam prepares for Zarina landfall", "Fishing boats recalled in Vietnam as the cyclone nears."]);
const ev3 = two("e3", "Taipei", "Taiwan cancels flights as Cyclone Zarina brushes the coast", "Environment and climate", ["Taiwan grounds flights over Zarina", "Airlines in Taiwan cancel services as the cyclone passes."], ["Taiwan braces for Zarina rain", "Authorities in Taiwan warn of landslides after the cyclone."]);
const roundup = suggestEditions([ev1, ev2, ev3, rates, space], { now: NOW }).editions.find((e) => e.ids.includes("e1"));
check("event roundup: separate developments tied by one catalyst", !!roundup && roundup.structure === "event_roundup" && /Zarina/.test(roundup.catalyst ?? "") && roundup.ids.length === 3);
check("event roundup: title asks how countries responded to the catalyst", /Zarina/.test(roundup?.title ?? ""));

// ---- D. two-story coherent edition ----
const p2 = suggestEditions([privacy, two("pv2", "Seoul", "South Korea fines tech firm under new personal data protection law", "Laws and regulations", ["South Korea fines company for personal data breach under privacy law", "The regulator enforces the data protection law after a data breach."], ["Korean privacy regulator issues penalty", "Biometric data and privacy rules tested in South Korea."]), space, rates], { now: NOW }).editions.find((e) => e.ids.includes("pv"));
check("two-story edition: a coherent pair is accepted without padding", !!p2 && p2.ids.length === 2 && p2.coherence.verdict === "COHERENT");

// ---- E. several unrelated stories ----
const lab = two("lb", "Lima", "Teachers' union in Peru ends strike after curriculum deal", "Public policy", ["Peru teachers end strike over school curriculum", "Union and ministry agree on a new curriculum for students."], ["Peruvian teachers return to classrooms", "Students and teachers welcome the deal."]);
const bio = two("bi", "Suva", "Fiji creates marine reserve to protect coral and rare species", "Environment and climate", ["Fiji declares marine protected area for coral reefs", "Conservation of species and biodiversity is the aim."], ["Fiji marine reserve covers coral and wildlife", "Biodiversity gains expected from the new protected areas."]);
const mixed = [rates, space, privacy, lab, bio];
const none = suggestEditions(mixed, { now: NOW });
check("unrelated stories: no edition is suggested", none.editions.length === 0);
const forced = evaluateEdition(mixed, { now: NOW });
check("unrelated stories: manual selection scores INCOHERENT and explains why", forced.coherence.verdict === "INCOHERENT" && forced.check.belongTogether.startsWith("No") && forced.check.recommendations.some((r) => /share no theme or event/.test(r)));
check("unrelated stories: the user's selection is not silently changed", forced.ids.length === 5 && forced.check.weaklyConnected.length >= 1);
check("unrelated stories: map judged misleading when places are not linked", !forced.check.mapUseful);

// ---- F. duplicate reporting of one underlying event ----
const dupA = two("da", "Alpha", "Parliament passes landmark data protection law after long debate", "Laws and regulations", ["Parliament passes landmark data protection law", "Privacy and personal data rules approved."], ["Data protection law passed by parliament", "Lawmakers approve the privacy bill."]);
const dupB = two("db", "Beta", "Landmark data protection law passed by parliament after long debate", "Laws and regulations", ["Landmark data protection law passes parliament", "The privacy law was approved after debate."], ["Parliament approves data protection act", "Personal data protections approved."]);
check("duplicates: flagged as one underlying event", pairConnection(dupA, dupB).duplicate);
const dsug = suggestEditions([dupA, dupB, privacy], { now: NOW });
check("duplicates: only one is eligible and the other's exclusion is explained", dsug.ineligible.some((x) => /Duplicate reporting/.test(x.reason)));
const dupEval = evaluateEdition([dupA, dupB], { now: NOW });
check("duplicates: a manual pair with one event cannot score as coherent and is told to keep one", dupEval.coherence.verdict !== "COHERENT" && dupEval.check.recommendations.some((r) => /one underlying event/.test(r)) && dupEval.check.repetition.length === 1);

// ---- G. conflicting accounts ----
const conf = evaluateEdition([jp, fi, cl], { now: NOW, conflictNotes: ["Outlet A says 12 shelters, the ministry says 8."] });
check("conflicts: editor-noted conflict is carried into the coherence check", conf.check.conflicts.length === 1 && /12 shelters/.test(conf.check.conflicts[0]));
check("conflicts: none are invented when the editor notes none", evaluateEdition([jp, fi], { now: NOW }).check.conflicts.length === 0);

// ---- H. no suitable related stories ----
const lonely = suggestEditions([jp, space], { now: NOW });
check("no related stories: reported as unmatched with a single-story suggestion, not forced into an edition", lonely.editions.length === 0 && lonely.unmatched.some((u) => u.id === "jp" && /single-story/.test(u.why)));

// ---- coherence effect of editing a selection ----
const base = evaluateEdition([jp, fi, cl], { now: NOW });
const polluted = evaluateEdition([jp, fi, cl, rates], { now: NOW });
check("adding an unrelated story lowers coherence and flags it (never silently removes it)", (polluted.coherence.score ?? 0) < (base.coherence.score ?? 0) && polluted.ids.includes("rt") && polluted.check.weaklyConnected.some((w) => w.id === "rt"));
const solo = evaluateEdition([jp], { now: NOW });
check("single development is a deep dive, not scored as a synthesis", solo.coherence.verdict === "SINGLE DEVELOPMENT" && solo.coherence.score === null);
check("every pair connection lists its signals", base.pairs.length === 3 && base.pairs.every((p) => p.signals.length >= 7));
check("geography alone is not a connection", pairConnection(rates, space).score <= 25);
check("exclusion reasons are recorded for edition members dropped as weak", suggestEditions([jp, fi, cl, ke, rates], { now: NOW }).editions.every((e) => e.excluded.every((x) => x.reason.length > 10)));

console.log(`\n${fail ? "FAILURES: " + fail : "ALL " + pass + " EDITION CHECKS PASSED"}`);
process.exit(fail ? 1 : 0);

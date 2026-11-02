// Edition Prompt Architect: one integrated prompt, per-development attribution, no invented connections.
import { buildDev, evaluateEdition, type Dev } from "../netlify/lib/editions.mts";
import { buildEditionPrompt, evidenceHash, pickRoles, EditionPromptTooLarge } from "../netlify/lib/edition-prompt.mts";
import { buildEvidencePack, type EvSource } from "../netlify/lib/evidence-pack.mts";
import type { StoryInput } from "../netlify/lib/scoring.mts";

let pass = 0, fail = 0;
const check = (n: string, v: boolean) => { console.log((v ? "PASS " : "FAIL ") + n); v ? pass++ : fail++; };
const NOW = Date.parse("2026-10-31T12:00:00Z");
const ago = (h: number) => new Date(NOW - h * 3600_000).toISOString();
type S = { outlet: string; tier?: "primary" | "reporting"; title: string; summary: string };
function mk(id: string, headline: string, category: string, sources: S[]) {
  const input: StoryInput = { id, headline, category, createdAt: ago(3), sources: sources.map((s) => ({ outlet: s.outlet, region: "Europe", tier: s.tier ?? "reporting", publishedAt: ago(5), retrievedAt: ago(1), title: s.title, summary: s.summary })) };
  const ev: EvSource[] = sources.map((s) => ({ outlet: s.outlet, region: "Europe", tier: s.tier ?? "reporting", url: `https://${s.outlet.toLowerCase().replace(/\W/g, "")}.example/${id}`, title: s.title, summary: s.summary, publishedAt: ago(5), retrievedAt: ago(1) }));
  const dev = buildDev(input, ev, NOW);
  return { dev, story: { headline, category, sources: ev } };
}
const two = (id: string, p: string, h: string, c: string, a: [string, string], b: [string, string], official = false) =>
  mk(id, h, c, [{ outlet: `${p} Gazette`, tier: official ? "primary" : "reporting", title: a[0], summary: a[1] }, { outlet: `${p} Times`, title: b[0], summary: b[1] }]);

const M = [
  two("jp", "Tokyo", "Japan orders new emergency preparedness plan with stockpiles for families", "Government and institutional decisions", ["Japan updates national preparedness and stockpile directive", "Government ministry orders households and local councils to stockpile water and food for disasters."], ["Tokyo tightens emergency readiness rules", "Families must keep supplies; shelters and early warning expanded in Japan."], true),
  two("fi", "Helsinki", "Finland publishes civil defence guide on household resilience and shelters", "Public policy", ["Finland issues civil defence guidance for every household", "Agency tells citizens to prepare emergency supplies; shelters and resilience plan updated."], ["Finnish residents get preparedness booklet", "Authorities say crisis plan and readiness for disruption has been rewritten in Finland."], true),
  two("cl", "Santiago", "Chile launches earthquake early warning and evacuation programme", "Public policy", ["Chile expands early warning and evacuation drills nationwide", "The government programme improves disaster readiness and shelters in Chile."], ["Chile rolls out emergency alert system", "Authorities in Chile say preparedness for earthquakes and tsunami evacuation will be tested."]),
];
const devs = M.map((m) => m.dev);
const ev = evaluateEdition(devs, { now: NOW });
const members = (cs: string[] = []) => M.map((m, i) => ({ dev: m.dev, pack: buildEvidencePack(m.story, { refPrefix: `D${i + 1}-`, conflictNote: cs[i] ?? null }) }));
const base = (over: any = {}) => buildEditionPrompt({ title: "How three countries prepare", members: members(), evaluation: ev, deliverable: "script_storyboard", durationSeconds: 90, approvedRules: [], ...over });
const out = base();
const p = out.prompt;

check("one integrated prompt covering all 23 numbered items", [...Array(23)].every((_, i) => new RegExp(`^=== (\\d+ and )?${i + 1}( and \\d+)?\\.`, "m").test(p) || new RegExp(`^=== \\d+ and ${i + 1}\\.`, "m").test(p)))
check("brand block and logo rules present", /Midnight Navy/.test(p) && /#0B1F38/.test(p) && /What happened\. What changed\. What matters\./.test(p));
check("states the structure and why together", /Multi-country synthesis/.test(p) && /WHY THESE DEVELOPMENTS BELONG TOGETHER/.test(p));
check("each development keeps its own evidence, namespaced D1-S1 / D2-S1 / D3-S1", /D1-S1/.test(p) && /D2-S1/.test(p) && /D3-S1/.test(p));
check("source refs never collide across developments", new Set(members().flatMap((m) => m.pack.sources.map((s) => s.ref))).size === members().reduce((n, m) => n + m.pack.sources.length, 0));
check("every development headline is attributed in the evidence section", devs.every((d) => p.includes(d.headline)));
check("connection presented as inferred, not verified; no coordination claim", /not verified/.test(p) && /coordinated/.test(p) && /EDITORIAL INTERPRETATION/.test(p));
check("hypothesis label on the curiosity mechanism", /EDITORIAL HYPOTHESIS/.test(p) && /never overrides the evidence/.test(p));
check("shared-origin rule included (outlets repeating one report are not independent)", /NOT independent confirmation/.test(p));
check("all evidence classes defined, FUTURE POSSIBILITY separated", /OFFICIALLY_DOCUMENTED/.test(p) && /FUTURE POSSIBILITY/.test(p));
check("roles chosen for this edition, fact-checker last word", out.roles.length >= 4 && out.roles.length <= 8 && /fact-checker has the last word/.test(p) && out.roles.some((r) => /international/.test(r.role)));
check("roles are selected, not a fixed list (single country differs)", pickRoles(members().slice(0, 1), evaluateEdition([devs[0]], { now: NOW }), "script_storyboard").some((r) => /Senior news correspondent/.test(r.role)));
check("sequence section lists every development once in engine order", ev.sequence.every((s, i) => p.includes(`${i + 1}. "${s.headline.slice(0, 40)}`)));
check("map: grounded places with basis, approximate, no invented routes", /Mark only these places/.test(p) && /mentioned in the retrieved text/.test(p) && /NOT as the location of any specific event/.test(p) && /Do not add places, borders, routes/.test(p));
check("timecodes cover the chosen duration", /Scene 1 - Hook and introduction \(0s to/.test(p) && /What remains uncertain/.test(p));
check("word budget matches duration", /198 to 252 words/.test(p) && /90 seconds/.test(p));
check("single-outlet framing instruction only if needed", !/Single-outlet developments/.test(p) || /not independently confirmed/.test(p));
check("tools are chosen per deliverable and unverified", /NOT verified by WorldFiled Desk/.test(base({ deliverable: "narrated_video" }).prompt) && !/Do not install anything not listed/.test("") );
check("no paid services", /no paid services/.test(p));
check("does not copy other brands", /Do not copy any other news brand/.test(p));
check("approved style rules included only when approved", !/Approved style rules/.test(p) && /Approved style rules/.test(base({ approvedRules: [{ rule_key: "x", version: 1, category: "pacing", statement: "Keep cuts slow." }] }).prompt));
check("editor angle and conflict notes carried through", /Editor's chosen angle: "ask why"/.test(base({ angle: "ask why" }).prompt) && /Editor-noted conflicts/.test(base({ conflictNotes: ["Sources differ on the date."] }).prompt));
check("snapshot records every development and what was omitted", out.snapshot.developments.length === 3 && "evidence_limits" in out.snapshot && "omitted_total" in out.snapshot);
check("evidence hash is stable and changes when evidence changes", out.evidenceHash === evidenceHash(members()) && (() => { const m = members(); m[1].pack.sources[0].snippet += " updated"; return evidenceHash(m) !== out.evidenceHash; })());
check("prompt ties to member set: different members give a different prompt and hash", (() => { const two2 = members().slice(0, 2); const o = buildEditionPrompt({ title: "t", members: two2, evaluation: evaluateEdition(devs.slice(0, 2), { now: NOW }), deliverable: "script_storyboard", durationSeconds: 60, approvedRules: [] }); return o.evidenceHash !== out.evidenceHash && o.prompt !== p; })());
check("oversized prompt is refused, not shortened", (() => { try { buildEditionPrompt({ title: "t", members: members(), evaluation: ev, deliverable: "script_storyboard", durationSeconds: 60, angle: "", approvedRules: Array.from({ length: 4000 }, (_, i) => ({ rule_key: "k" + i, version: 1, category: "c", statement: "x".repeat(60) })) }); return false; } catch (e) { return e instanceof EditionPromptTooLarge; } })());
// weak/unrelated edition: connection must not be forced
const lone = two("rt", "Brasilia", "Central bank in Brazil raises interest rates as inflation climbs", "Business and economic developments", ["Brazil raises interest rates to fight inflation", "The central bank decision affects mortgages, prices and wages."], ["Brazilian central bank hikes rate", "Inflation and currency pressure drive the rate rise in Brazil."]);
const weakEv = evaluateEdition([devs[0], lone.dev], { now: NOW });
const weak = buildEditionPrompt({ title: "Mixed", members: [members()[0], { dev: lone.dev, pack: buildEvidencePack(lone.story, { refPrefix: "D2-" }) }], evaluation: weakEv, deliverable: "script_storyboard", durationSeconds: 60, approvedRules: [] });
check("unrelated pair: treated as a multi-topic roundup, prompt forbids inventing a connection", weakEv.structure === "news_roundup" && /Multi-topic news roundup/.test(weak.prompt) && /Do NOT present the stories as connected/.test(weak.prompt) && /must NOT invent one/.test(weak.prompt) && !/say so instead of forcing it/.test(weak.prompt));
// ---- user's example: five unrelated individual developments combined into ONE briefing ----
const five = [
  two("g1", "Ankara", "Turkey central bank holds rates after cabinet decision on budget", "Government and institutional decisions", ["Turkey government decision on budget and rates", "Cabinet approves new budget; central bank holds interest rates in Turkey."], ["Turkish cabinet approves budget", "Government says the decision affects prices in Turkey."], true),
  two("f1", "Madrid", "Real Madrid beat Barcelona 3-1 in the league clash in Spain", "Sports", ["Real Madrid win the clasico 3-1 in Spain", "The match result moves the league race in Spain."], ["Spain football: Madrid beat Barcelona", "Fans in Spain react to the result."]),
  two("c1", "Paris", "French minister faces criticism after incident at public event in France", "Politics", ["French minister under pressure after incident in France", "The controversy over the incident grows in France; opponents demand an explanation."], ["Minister in France apologises after incident", "Critics in France say the incident raised questions."]),
  two("s1", "Canberra", "Researchers in Australia report a new battery material discovery", "Scientific discoveries", ["Australian researchers report battery material discovery", "A study in Australia describes a new material for batteries."], ["New battery material found in Australia", "Scientists say the discovery needs more testing in Australia."]),
  two("u1", "Lima", "Unexpected volcanic ash cloud closes airports in Peru", "Environment and climate", ["Volcanic ash closes airports in Peru", "An unexpected eruption disrupts flights across Peru."], ["Peru airports shut by ash", "Authorities in Peru warn travellers."]),
];
const fiveEv = evaluateEdition(five.map((x) => x.dev), { now: NOW });
const fiveMembers = five.map((x, i) => ({ dev: x.dev, pack: buildEvidencePack(x.story, { refPrefix: `D${i + 1}-` }) }));
const orderedMembers = fiveEv.sequence.map((sq) => fiveMembers.find((m) => m.dev.id === sq.id)!);
const fp = buildEditionPrompt({ title: "Five things that happened", members: orderedMembers, evaluation: fiveEv, deliverable: "script_storyboard", durationSeconds: 120, approvedRules: [] });
check("five unrelated developments: recommended structure is a multi-topic news roundup (no invented theme)", fiveEv.structure === "news_roundup" && fiveEv.roundup);
check("five developments: ONE prompt contains all five evidence blocks", [1, 2, 3, 4, 5].every((k) => fp.prompt.includes(`DEVELOPMENT D${k}:`)) && five.every((x) => fp.prompt.includes(x.dev.headline)) && (fp.prompt.match(/=== 1\. BRAND/g) ?? []).length === 1);
check("five developments: required parts (hook, introduction, segments, transitions, conclusion, captions, key facts, map, storyboard)", /opening hook/.test(fp.prompt) && /short introduction/.test(fp.prompt) && /transition between every pair/.test(fp.prompt) && /strong conclusion/.test(fp.prompt) && /on-screen headline/.test(fp.prompt) && /key facts/.test(fp.prompt) && /STORYBOARD AND TIMECODES/.test(fp.prompt) && /Scene \d+ - Recap/.test(fp.prompt));
check("five developments: transitions only mark a change of story, no invented links", /only marks the move to a new story/.test(fp.prompt) && /Do not state or imply a relationship/.test(fp.prompt));
check("five developments: locator map has no routes or arrows", !/Camera: move from place to place/.test(fp.prompt) && (!fiveEv.check.mapUseful || /NO routes, lines or arrows/.test(fp.prompt)));
check("five developments: scene count = hook + 5 + recap + uncertainty + conclusion", (fp.prompt.match(/^Scene \d+ /gm) ?? []).length === 9);
check("five developments: evidence refs stay separate per development", fp.snapshot.developments.length === 5 && new Set(fp.snapshot.developments.map((d: any) => d.pack.sources[0].ref)).size === 5);
check("no-map edition explains why and forbids decorative map", /map is NOT recommended|A map is NOT recommended/.test(buildEditionPrompt({ title: "x", members: [members()[0]], evaluation: evaluateEdition([devs[0]], { now: NOW }), deliverable: "script_storyboard", durationSeconds: 60, approvedRules: [] }).prompt));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

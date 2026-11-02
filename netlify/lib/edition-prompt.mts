// Edition Prompt Architect: ONE integrated Claude production prompt for a whole approved edition.
// Rule-based and deterministic. Every development keeps its own evidence, and nothing here invents a connection:
// the connection text comes from the edition engine's recorded signals.
import { createHash } from "node:crypto";
import { brandBlock, brandChecklist, BRAND_VERSION } from "./brand.mts";
import { CLASS_MEANING, cleanField, classCounts, renderEvidence, type EvidencePack } from "./evidence-pack.mts";
import { DELIVERABLES, selectTools, type Deliverable, type ToolPlan } from "./production-tools.mts";
import { distanceKm } from "./geo.mts";
import type { Dev, Evaluation } from "./editions.mts";
import type { StyleRuleIn } from "./prompt-architect.mts";

export const MAX_EDITION_PROMPT_CHARS = 200_000;
export const MAX_EDITION_SNAPSHOT_BYTES = 600_000;
export class EditionPromptTooLarge extends Error {}

export type EditionMember = { dev: Dev; pack: EvidencePack };
export type EditionPromptInput = {
  title: string;
  members: EditionMember[]; // already in the approved story order
  evaluation: Evaluation;
  deliverable: Deliverable;
  durationSeconds: 60 | 90 | 120;
  angle?: string;
  conflictNotes?: string[];
  approvedRules: StyleRuleIn[];
};
type Role = { role: string; why: string };

const WPS: [number, number] = [2.2, 2.8];
const bullets = (a: string[]) => a.map((x) => `- ${x}`).join("\n");
const q = (s: string) => `"${cleanField(s, 160)}"`;

export function pickRoles(members: EditionMember[], ev: Evaluation, deliverable: Deliverable): Role[] {
  const has = (t: string) => members.filter((m) => m.dev.a.type === t).map((m) => q(m.dev.headline));
  const roles: Role[] = [];
  const add = (role: string, why: string) => { if (!roles.some((r) => r.role === role)) roles.push({ role, why }); };
  if (ev.structure !== "single_country") add("Senior international news correspondent", `frames developments across ${ev.locations.map((l) => l.country).slice(0, 4).join(", ") || "several places"} as one story without flattening their differences`);
  else add("Senior news correspondent", `explains the developments in ${ev.locations[0]?.country ?? "the country"} with context and restraint`);
  add("Documentary director", "builds one continuous narrative arc from the opening hook to the closing implication, not a list of items");
  if (ev.check.mapUseful) add("GIS and cartography specialist", "turns the verified places into a map sequence that shows the relationship between developments");
  const pol = [...has("law_regulation"), ...has("government_decision"), ...has("institutional_decision")];
  if (pol.length) add("Policy analyst", `explains what each decision actually changes and for whom, for ${pol.slice(0, 2).join(" and ")}`);
  if (has("scientific_discovery").length) add("Science visualisation specialist", `draws accurate, labelled diagrams for ${has("scientific_discovery")[0]}`);
  if (has("technology").length) add("Technology correspondent", `explains what the technology does and does not do for ${has("technology")[0]}`);
  if (has("environmental_event").length) add("Environmental journalist", `keeps environmental claims at the strength of the evidence for ${has("environmental_event")[0]}`);
  if (has("economic_change").length) add("Data journalist", `handles figures, units and comparisons for ${has("economic_change")[0]}`);
  if (members.some((m) => m.dev.a.accountability.length)) add("Investigative journalist", "asks who decided what and in whose interest where the evidence raises accountability questions");
  add("Motion-graphics designer", "builds restrained maps, timelines and comparisons in the brand palette");
  if (deliverable === "narrated_video") add("Professional voiceover director", "sets pacing, emphasis and pronunciation for a calm, clear delivery");
  add("Editorial fact-checker", "checks every on-screen and spoken claim against the evidence and has the last word");
  return roles.slice(0, 8);
}

/** Hash of the evidence the prompt was built from. Used to detect material updates after generation. */
export function evidenceHash(members: EditionMember[]): string {
  const canon = members.map((m) => ({ id: m.dev.id, s: m.pack.sources.map((s) => [s.url, s.title, s.published_at, s.snippet]).sort() }));
  return createHash("sha256").update(JSON.stringify(canon)).digest("hex");
}

export function buildEditionPrompt(input: EditionPromptInput) {
  const { members, evaluation: ev } = input;
  const n = members.length;
  const secs = input.durationSeconds;
  const d = DELIVERABLES.find((x) => x.key === input.deliverable) ?? DELIVERABLES[0];
  const tools: ToolPlan = selectTools(d.key, ev.check.mapUseful);
  const roles = pickRoles(members, ev, d.key);
  const budget = { min: Math.round(secs * WPS[0]), max: Math.round(secs * WPS[1]), target: Math.round(secs * 2.5) };
  const angle = cleanField(input.angle, 200);
  const title = cleanField(input.title, 200);

  // ---- per-development evidence blocks, each with its own namespace (D1-S1, D1-C1 ...)
  const evidenceBlocks = members
    .map((m, i) => {
      const a = m.dev.a;
      return [
        `--- DEVELOPMENT D${i + 1}: ${cleanField(m.dev.headline, 200)} ---`,
        `Type: ${a.typeLabel}. Editorial recommendation: ${a.recommendation}. Evidence strength: ${a.evidenceStrength.label} (${a.evidenceStrength.why})`,
        renderEvidence(m.pack),
        `What is still missing for D${i + 1}: ${a.missingEvidence.join(" | ")}`,
      ].join("\n");
    })
    .join("\n\n");

  const classLegend = (Object.keys(CLASS_MEANING) as (keyof typeof CLASS_MEANING)[]).map((k) => `- ${k}: ${CLASS_MEANING[k]}`).join("\n");

  // ---- sequence, scenes and timecodes
  const hookPct = 0.1, connectPct = 0.12, uncertainPct = 0.08, matterPct = 0.1;
  const devPct = (1 - hookPct - connectPct - uncertainPct - matterPct) / Math.max(n, 1);
  let t = 0;
  const seg = (label: string, pct: number, body: string) => {
    const len = Math.max(3, Math.round(pct * secs));
    const from = t;
    t = Math.min(secs, t + len);
    return `Scene ${label} (${from}s to ${t}s): ${body}`;
  };
  const scenes: string[] = [];
  scenes.push(seg("1 - Hook", hookPct, `Open with the strongest evidence-backed hook (see section 9).`));
  ev.sequence.forEach((s, i) => {
    const m = members.find((x) => x.dev.id === s.id)!;
    const where = m.dev.a.locations[0] ? `${m.dev.a.locations[0].country} (${m.dev.a.locations[0].basis})` : "place not established";
    scenes.push(seg(`${i + 2} - D${members.indexOf(m) + 1}`, devPct, `${s.role}. Development: ${q(m.dev.headline)}. Place: ${where}. Attribute every fact to its source ref (D${members.indexOf(m) + 1}-S#). Say what happened and what is different about this one.`));
  });
  scenes.push(seg(`${n + 2} - What connects them`, connectPct, `State the connection (section 4) and why the combination explains more than the separate stories.`));
  scenes.push(seg(`${n + 3} - What remains uncertain`, uncertainPct, `Say plainly what is single-source, conflicting or unknown (section 6).`));
  scenes.push(seg(`${n + 4} - What matters`, matterPct, `Close on what matters, only as far as the evidence supports. Do not predict.`));

  // ---- map instructions grounded in the gazetteer
  const placed = ev.sequence.map((s, i) => ({ s, l: members.find((m) => m.dev.id === s.id)!.dev.a.locations[0], i }));
  const mapBlock = ev.check.mapUseful
    ? [
        `A map IS useful here: ${ev.check.mapWhy}`,
        "Mark only these places, in this order (approximate country centroids, rounded; use them to place a marker, NOT as the location of any specific event; take exact geometry from a reliable free map dataset and say which you used):",
        ...placed.filter((p) => p.l).map((p, k) => `  ${k + 1}. ${p.l!.country} [${p.l!.region}] about ${p.l!.lat}, ${p.l!.lon} | basis: ${p.l!.basis}${k > 0 && placed[k - 1].l ? ` | about ${distanceKm(placed[k - 1].l!, p.l!)} km from the previous place` : ""}`),
        "Camera: move from place to place in the sequence above, keeping each move short and readable. Highlight the active country in Archival Gold; keep other places subdued.",
        "Where basis is 'publisher location only', do NOT present the place as where the event happened unless you can verify it from the evidence; label it or leave it off the map.",
        "Show disputed borders neutrally. Do not add places, borders, routes, distances or arrows that this list or the evidence does not support.",
      ].join("\n")
    : `A map is NOT recommended: ${ev.check.mapWhy} Use a timeline, comparison table or document panels instead, and do not add a map for decoration.`;

  const rules = input.approvedRules.length
    ? "Approved style rules from the editor's Reference Library (general principles only; do NOT copy any other creator's branding, wording or layout):\n" + bullets(input.approvedRules.map((r) => `${r.statement} [${r.category}, ${r.rule_key} v${r.version}]`))
    : "No reference style rules are approved yet. Rely on the brand specification; do not imitate any other creator.";

  const conflicts = [...(input.conflictNotes ?? []), ...ev.check.conflicts].map((c) => cleanField(c, 600)).filter(Boolean);
  const curiosityLines = members.map((m, i) => `D${i + 1}: ${m.dev.a.whyInteresting.slice(0, 2).join("; ")} (curiosity ${m.dev.a.curiosityScore}/100, evidence ${m.dev.a.evidenceStrength.label})`).join("\n");
  const flagged = members.filter((m) => !m.dev.a.corroborated).map((m, i) => `D${members.indexOf(m) + 1}`);
  const numericAnchors = members.flatMap((m, i) => m.pack.sources.flatMap((s) => (`${s.title} ${s.snippet}`.match(/\b\d[\d,.]*\s?(%|percent|million|billion|km|days?|years?|points?)?/gi) ?? []).slice(0, 2).map((x) => `${x.trim()} (D${i + 1}, ${s.ref}, ${s.outlet})`))).slice(0, 12);
  const structureBrief =
    ev.structure === "multi_country" ? "Multi-country synthesis: separate developments in different countries, connected by a shared theme. Do not claim the governments coordinated unless the evidence says so."
    : ev.structure === "event_roundup" ? `Event-driven thematic roundup: separate developments connected by one event or catalyst${ev.catalyst ? ` ("${ev.catalyst}")` : ""}. Do not claim causation beyond what each source states.`
    : "Single-country deep dive: one place explained through its related developments. Historical or background context is NOT in the evidence: you may add widely documented background only if you label it BACKGROUND (NOT FROM THE EVIDENCE PACK, EDITOR TO VERIFY) and never add numbers, dates or quotes from memory.";

  const prompt = `You are being given a complete production assignment by the editor of THE WORLD, FILED. (tagline: "What happened. What changed. What matters."). This is ONE integrated editorial work about ${n} development${n === 1 ? "" : "s"}, not a collection of separate items. Read every section. Do not publish anything; the editor reviews your output.

=== RULES THAT OVERRIDE EVERYTHING ELSE ===
- Use ONLY the facts in section 6. Never invent numbers, dates, names, places, quotes, official statements, source links, legal provisions, scientific conclusions, geographic relationships or corroboration.
- Every claim has an evidence class. You may not state a claim more strongly than its class allows. Separate, always labelled: EDITORIAL INTERPRETATION (our reading of the connection) and FUTURE POSSIBILITY (anything that "could" or "may" happen, only if a source says it). Creative treatment may never turn a SINGLE_SOURCE, CONFLICTING or UNKNOWN item into an asserted fact.
- Several outlets repeating one announcement or one wire report are NOT independent confirmation. Do not write "confirmed by multiple sources" unless section 6 shows separate original sources.
- The connection between the developments is the editorial thesis. Present it as our interpretation. Do not imply the places coordinated, caused each other, or share a cause unless a source states that.
- Anything illustrative must be visibly or verbally framed as illustrative, never as real footage or evidence.
- Everything must be free to produce: no paid services, trials, subscriptions or API keys. If something cannot be done free, say so.
${flagged.length ? `- Single-outlet developments (${flagged.join(", ")}) must be framed on screen and in narration as "reported by <outlet>, not independently confirmed".\n` : ""}- Report honestly what you could not verify or complete.

=== 2. EDITION AND CENTRAL THEME ===
Edition title: ${title}
Central theme: ${cleanField(ev.theme, 120)}${ev.catalyst ? ` | shared catalyst: ${cleanField(ev.catalyst, 60)}` : ""}
${angle ? `Editor's chosen angle: "${angle}" (follow it only where the evidence supports it).\n` : ""}
=== 3. EDITORIAL STRUCTURE ===
${ev.structureLabel}. ${structureBrief}

=== 4. WHY THESE DEVELOPMENTS BELONG TOGETHER ===
Coherence check by fixed rules: ${ev.coherence.verdict}${ev.coherence.score !== null ? ` (${ev.coherence.score}/100)` : ""}.
${ev.check.belongTogether}
${ev.coherence.components.map((c) => `- ${c.name}: ${c.points}/${c.max} (${c.why})`).join("\n")}
What each development adds:
${ev.contributions.map((c) => `- ${q(c.headline)}: ${c.adds}`).join("\n")}
Why the combination is more informative than separate stories: ${ev.check.valueVersusSeparate}
${ev.check.repetition.length ? `Possible repetition to avoid: ${ev.check.repetition.join("; ")}.\n` : ""}${ev.check.weaklyConnected.length ? `Weakly connected (the editor chose to keep them; give them a clear role or keep them short): ${ev.check.weaklyConnected.map((w) => `${q(w.headline)} (${w.why})`).join("; ")}.\n` : ""}This connection was inferred by fixed rules, not verified. If, while writing, you find the connection is not supported by section 6, say so instead of forcing it.

=== 5. PROFESSIONAL ROLE ASSIGNMENT ===
Act as this team, chosen for this edition (not every role is needed for every project):
${roles.map((r) => `- ${r.role}: ${r.why}.`).join("\n")}
The fact-checker has the last word.

=== 6. THE DEVELOPMENTS AND THEIR EVIDENCE ===
Each development keeps its own evidence and source refs (D1-S1 = development 1, source 1). Attribute every claim to its ref.
${evidenceBlocks}

Evidence classes, defined:
${classLegend}
${conflicts.length ? `\nEditor-noted conflicts between accounts (the app does not detect conflicts itself): ${conflicts.join(" | ")}. Present each account, attributed, and do not choose between them.\n` : ""}
=== 7. CENTRAL EDITORIAL ANGLE ===
${ev.angle}
What the audience should understand by the end: what happened in each place, how they relate, and what matters, each only as far as section 6 supports.

=== 8. AUDIENCE CURIOSITY MECHANISM ===
EDITORIAL HYPOTHESIS, not measured audience behaviour, and it never overrides the evidence:
${curiosityLines}
Edition-level: the comparison between ${ev.locations.map((l) => l.country).slice(0, 4).join(", ") || "the developments"} is the curiosity engine. Aim for understanding, not outrage or alarm. No clickbait: the hook must be answered inside the piece.

=== 9. STRONGEST EVIDENCE-BACKED OPENING HOOK ===
Lead with: ${ev.check.strongestOpening}
The hook must be a verified fact or an honest question the evidence raises. It must not exaggerate or tease with withheld facts.

=== 10. INTEGRATED NARRATION SCRIPT ===
Write ONE continuous script for ${secs} seconds: ${budget.min} to ${budget.max} words in total (aim for about ${budget.target}), at roughly ${WPS[0]} to ${WPS[1]} words per second. It must read as one argument with transitions, not ${n} summaries joined together. Short, declarative, calm sentences; attribute each factual statement ("according to ...", "reported by ...").

=== 11. STORY SEQUENCE AND TRANSITIONS ===
Recommended order (chosen for hook strength and short geographic moves):
${ev.sequence.map((s, i) => `${i + 1}. ${q(s.headline)} - ${s.role}. ${s.why}`).join("\n")}
Write a transition between each pair that states the relationship (what is similar, what differs) without claiming more than section 4 supports. Do not repeat information the audience already has.

=== 12. GEOGRAPHIC SYNTHESIS AND MAP SEQUENCE ===
${ev.check.geographicDimension}
${mapBlock}

=== 13. STORYBOARD AND TIMECODES (${secs} seconds; skip or shorten any scene the evidence cannot support) ===
${scenes.join("\n")}
For every scene give: narration, on-screen text, visual cue, motion, transition and the source refs used.

=== 14. ON-SCREEN TEXT AND NUMERICAL ANCHORS ===
Large, minimal, one idea per scene. Use a number only if it appears in section 6 with its unit and source.
Numbers found in the retrieved headlines and snippets (verify each against its source before use):
${numericAnchors.length ? bullets(numericAnchors) : "- none found; do not invent numerical anchors"}

=== 15 and 16. VISUAL ASSETS, MAPS, DATA AND GEOGRAPHIC VISUALISATION ===
${members.map((m, i) => `D${i + 1} (${m.dev.a.typeLabel}): ${m.dev.a.type === "law_regulation" || m.dev.a.type === "government_decision" || m.dev.a.type === "institutional_decision" ? "document-style panel with only wording that appears in the evidence" : m.dev.a.type === "scientific_discovery" ? "clean labelled diagram of the finding; no fake lab footage" : m.dev.a.type === "economic_change" ? "one clearly labelled figure with unit and period; zero-based axes" : "restrained editorial graphic"}.`).join("\n")}
${rules}
Do not use photographs of real people or logos unless the editor supplies them. Use the brand palette; do not use all four colours at equal intensity.

=== 17. NARRATION AND PRONUNCIATION ===
Voice: informed, calm, precise; steady pace, a short pause before each key fact, one emphasised word per sentence; never shout or dramatise.
Pronunciation: list every person, place and organisation name in the script with a plain-text phonetic guide, and mark any you are unsure of.

=== 18. SOUND AND MUSIC ===
Restrained and supportive. No music that competes with the narration; no sound effects that imply events the evidence does not state. Use only royalty-free sound you can verify is free to use, and say what you used.

=== 19. SUBTITLES AND TYPOGRAPHY ===
Provide subtitles as short caption groups with start times. Strong editorial headlines, legible sans-serif supporting text, large high-contrast text for a 9:16 phone screen, restrained uppercase labels, no long all-caps paragraphs. See the brand specification below.

=== 20 and 21. TOOLS, AVAILABILITY, COST AND LICENSING ===
Deliverable type: ${d.label}.
${tools.needed.length ? "Tools genuinely needed for this deliverable (candidates; NOT verified by WorldFiled Desk, you must verify each before relying on it):\n" + tools.needed.map((x) => `- ${x.name} (${x.repo}): ${x.why}.\n  Verify: ${x.checks.join("; ")}.`).join("\n") : "Tools: none required."}
${tools.optional.length ? "Optional only if you have a specific reason:\n" + tools.optional.map((x) => `- ${x.name} (${x.repo}): ${x.why}.`).join("\n") : ""}
Not needed: ${tools.notNeeded.map((x) => `${x.name} (${x.reason})`).join("; ")}.
${tools.note}
Report actual availability, cost, licence and compatibility of anything you use. Do not install anything not listed as needed. If a tool fails verification, say so and propose a free alternative or reduce the deliverable. Never substitute a paid service.

=== 22. DELIVERABLES ===
Produce: ${d.text}
Also always provide, in this order:
1. The integrated script with caption groups and start times, and total word count.
2. The storyboard with timecodes.
3. The deliverable files described above, if any.
4. A claim-to-source table: every number, date, name, place and quote on screen or in the script, with its source ref (D#-S#) and evidence class, and whether it is a fact, EDITORIAL INTERPRETATION or FUTURE POSSIBILITY. Anything unsourced: mark UNSOURCED and remove it.
5. A list of scenes you skipped or softened, and any development whose connection to the others you could not support.
6. A tools note: what you used and how you verified it.
7. Two separate checklists, answered honestly: FACT CHECK and BRAND COMPLIANCE (section 23).

=== 23. QUALITY CONTROL ===
Fact check (separate from brand):
- Every claim traces to a source ref and does not exceed its class; interpretation and future possibility are labelled.
- No invented detail; no corroboration beyond the evidence; illustrative elements are labelled.
- The connection is presented as interpretation and the edition reads as one coherent argument.
- Visual clarity and mobile readability; voiceover quality; pronunciation list complete; timing matches the word budget.
- Technical correctness: files open and play as described; report what you tested.
Brand compliance (checked separately from facts):
${bullets(brandChecklist())}

=== 1. BRAND (mandatory; applies to the whole production) ===
${brandBlock()}
Do not copy any other news brand's name, wording, visual identity or presentation; learn from structure only.
`;

  if (prompt.length > MAX_EDITION_PROMPT_CHARS) throw new EditionPromptTooLarge("The edition prompt exceeds the size limit. Nothing was shortened; remove a development or choose a shorter deliverable.");
  const snapshot = {
    developments: members.map((m, i) => ({ story_id: m.dev.id, ref: `D${i + 1}`, headline: m.dev.headline, pack: m.pack })),
    evidence_limits: members[0]?.pack.evidence_limits ?? "",
    omitted_total: members.reduce((x, m) => x + m.pack.omitted_sources.count, 0),
    claim_class_counts: members.map((m) => classCounts(m.pack)),
  };
  if (Buffer.byteLength(JSON.stringify(snapshot)) > MAX_EDITION_SNAPSHOT_BYTES) throw new EditionPromptTooLarge("The evidence for this edition exceeds the storage limit. Nothing was shortened; remove a development.");
  return {
    prompt, roles, tools, snapshot, evidenceHash: evidenceHash(members), brandVersion: BRAND_VERSION,
    rationale: { structure: ev.structure, theme: ev.theme, catalyst: ev.catalyst, coherence: { score: ev.coherence.score, verdict: ev.coherence.verdict, components: ev.coherence.components }, sequence: ev.sequence, roles, deliverable: d.key, duration_seconds: secs, map_useful: ev.check.mapUseful, recommendations: ev.check.recommendations, approved_style_rules: input.approvedRules.map((r) => `${r.rule_key}@v${r.version}`) },
  };
}

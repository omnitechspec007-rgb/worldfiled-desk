// Production blueprint: one scene-by-scene specification for the whole edition. Deterministic; the app writes no media.
// Every scene carries the 18 fields Claude needs so it never has to invent the visual concept.
import type { Dev, Evaluation } from "./editions.mts";
import type { EvidencePack } from "./evidence-pack.mts";
import {
  allocateRuntime, capByKey, evidenceTreatment, mapSpec, namesIn, namesInDev, paceMid, pickCompositions, PROFILES, pronunciationCheck, runtimeItem, selectDelivery, soundPlan, TREATMENT_SET, visualKey,
  type Allocation, type CapClass, type Delivery, type EvidenceTreatment, type FormatChoice, type LexEntry, type Profile, type SoundOpt, type VoiceConfig,
} from "./presenter.mts";

export type Member = { dev: Dev; pack: EvidencePack };
export type SceneCap = { need: string; key: string; cls: CapClass; confirmed: boolean };
export type Scene = {
  n: number; kind: "hook" | "story" | "context" | "consequence" | "connection" | "recap" | "closing"; devRef: string | null; title: string;
  timecode: { from: number; to: number }; seconds: number;
  purpose: string; storyRef: string;
  narration: { instruction: string; words: { min: number; max: number; target: number }; maxSentenceWords: number; facts: { text: string; ref: string; cls: string }[] };
  delivery: { key: string; label: string; paceLo: number; paceHi: number; direction: string; reason: string };
  pronunciation: { name: string; state: string; respelling: string | null }[];
  visual: { treatment: string; compositionId: string; composition: string };
  imagery: string; camera: string; motion: string;
  onScreen: { headline: string; chip: string; captionRule: string; keyFacts: string };
  mapData: string; sfx: string; music: string; transition: string;
  evidenceRefs: string[]; capabilities: SceneCap[]; humanReview: string[];
  intensity: string; tier: string;
};
export type BlueprintInput = {
  members: Member[]; ev: Evaluation; secs: number; format: FormatChoice; voice: VoiceConfig; lex: LexEntry[]; toolsConfirmed: string[];
  sound: SoundOpt; visualMode: "adaptive" | "typographic"; deliverable: string; now: number; assets?: Record<string, string[]>;
};
export type Blueprint = { scenes: Scene[]; allocation: Allocation; totalWords: number; names: string[]; pronunciation: ReturnType<typeof pronunciationCheck>; perDev: Record<string, { ref: string; et: EvidenceTreatment; delivery: Delivery; visualKey: string }> };

const refsOf = (p: EvidencePack) => p.sources.map((s) => s.ref);
const factsOf = (p: EvidencePack) => p.claim_classes.filter((c) => c.class !== "UNKNOWN").slice(0, 3).map((c) => ({ text: c.statement, ref: c.refs.join("+") || "editor note", cls: c.class }));
const TRANSITIONS = ["Type push: the next headline pushes the current one off, marking a new story.", "Cross-dissolve through the Midnight Navy field to the next plate.", "Cut on the beat after the last word, with the soft transition cue."];

export function buildBlueprint(inp: BlueprintInput): Blueprint {
  const { ev, secs, format, voice, lex, sound, now } = inp;
  const ordered = ev.sequence.map((s) => inp.members.find((m) => m.dev.id === s.id)!).filter(Boolean);
  const refOf = (m: Member) => `D${inp.members.indexOf(m) + 1}`;
  const perDev: Blueprint["perDev"] = {};
  for (const m of inp.members) { const et = evidenceTreatment(m.dev, m.pack); perDev[m.dev.id] = { ref: refOf(m), et, delivery: selectDelivery(m.dev, et, now), visualKey: visualKey(m.dev) }; }
  const names = namesIn(inp.members); const pron = pronunciationCheck(names, lex);
  const alloc = allocateRuntime(ordered.map((m) => runtimeItem(m.dev, perDev[m.dev.id].et, m.pack, secs)), secs, format.key);
  const sp = soundPlan(format.key, sound);

  type Plan = { kind: Scene["kind"]; m: Member | null; seconds: number; title: string; purpose: string };
  const plan: Plan[] = [];
  const first = ordered[0] ?? null;
  const lead = format.key === "focused_briefing" ? ordered.find((m) => m.dev.id === format.leadId) ?? first : null;
  plan.push({ kind: "hook", m: lead ?? first, seconds: alloc.hook, title: "Hook", purpose: `Open with the strongest evidence-backed hook: ${ev.check.strongestOpening}. News in the first clause; the brand plate stays under two seconds.` });
  if (format.key === "focused_briefing" && lead) {
    const a = alloc.items[lead.dev.id] ?? 12;
    const s1 = Math.round(a * 0.4), s2 = Math.round(a * 0.3), s3 = Math.max(3, a - s1 - s2);
    plan.push({ kind: "story", m: lead, seconds: s1, title: "What happened", purpose: "State what happened, who did it and what is different, as far as the evidence supports. The hook already used the lead fact: do not repeat that sentence; open with what is new." });
    plan.push({ kind: "context", m: lead, seconds: s2, title: "Context and background", purpose: "Give relevant context. Background that is not in section 6 must be labelled BACKGROUND (NOT FROM THE EVIDENCE PACK, EDITOR TO VERIFY), with no numbers, dates or quotes from memory." });
    plan.push({ kind: "consequence", m: lead, seconds: s3, title: "Consequences and what is not yet known", purpose: "Say what follows from the sourced facts and what the evidence does not yet establish. Possible implications are labelled as possibilities." });
    for (const m of ordered) if (m !== lead) plan.push({ kind: "story", m, seconds: alloc.items[m.dev.id], title: "Related development", purpose: "A related development, verified separately; say plainly how it relates only if the evidence states it." });
  } else {
    ordered.forEach((m, i) => plan.push({ kind: "story", m, seconds: alloc.items[m.dev.id], title: `Story ${i + 1}`, purpose: `${ev.sequence[i]?.role ?? "Development"}. ${format.key === "global_roundup" ? "Stands on its own significance; no link to the other stories is claimed." : "Shows what this place adds to the theme."}${i === 0 && m === (lead ?? first) ? " The hook already used this development's lead fact: do not repeat that sentence; open with what is new." : ""}` }));
    if (alloc.connection) plan.push({ kind: "connection", m: null, seconds: alloc.connection, title: "What connects them", purpose: `State the connection and why the combination explains more than the separate stories. Label it ${format.connectionLabel}.` });
    if (alloc.recap) plan.push({ kind: "recap", m: null, seconds: alloc.recap, title: "Recap", purpose: "A brief recap of what was covered. No new facts and no unifying claim." });
  }
  plan.push({ kind: "closing", m: null, seconds: alloc.closing, title: "Closing", purpose: "Close on what matters, only as far as the evidence supports. No new facts, no prediction." });

  // visual compositions: one per scene, never the same twice in a row
  const storyish = plan.map((p) => (p.m ? { kind: perDev[p.m.dev.id].visualKey as any, intensity: inp.visualMode === "typographic" ? ("MINIMAL" as const) : perDev[p.m.dev.id].et.intensity } : { kind: "human_interest" as const, intensity: "MINIMAL" as const }));
  const comps = pickCompositions(storyish, plan.map((p) => !!(p.m && inp.assets?.[p.m.dev.id]?.length)));
  const confirmed = (k: string) => inp.toolsConfirmed.includes(k);
  const cap = (need: string, key: string): SceneCap => ({ need, key, cls: capByKey(key).cls, confirmed: confirmed(key) });
  const scenes: Scene[] = []; let t = 0;
  plan.forEach((p, i) => {
    const m = p.m; const d = m ? perDev[m.dev.id] : null;
    const brandOnly = p.kind === "closing" || p.kind === "recap" || p.kind === "connection";
    const prof: Profile = p.kind === "closing" ? PROFILES.closing : p.kind === "recap" || (p.kind === "connection") ? PROFILES.roundup_transition : d!.delivery.profile;
    const reason = p.kind === "closing" ? "closing line" : p.kind === "recap" ? "recap marks the end of the stories" : p.kind === "connection" ? "marks the move to the connection" : d!.delivery.reason;
    const intensity = d ? (inp.visualMode === "typographic" ? "MINIMAL" : d.et.intensity) : "STANDARD";
    const seconds = Math.max(2, p.seconds);
    const words = { min: Math.round(seconds * prof.paceLo), max: Math.round(seconds * prof.paceHi), target: Math.round(seconds * paceMid(prof)) };
    const from = t; t += seconds;
    const comp = comps[i]; const vk = d ? d.visualKey : "human_interest";
    const treat = d ? TREATMENT_SET[vk as keyof typeof TREATMENT_SET] : null;
    const map = m && !brandOnly && p.kind !== "hook" ? mapSpec(m.dev, intensity as any, format.key) : { use: false, text: p.kind === "hook" ? "No map in the hook; the map starts with the story." : "No map in this scene." };
    const nm = m ? namesInDev(m.dev, names) : [];
    const pr = nm.map((n) => { const x = pron.find((q) => q.name === n)!; return { name: n, state: x.state, respelling: x.entry?.pronunciation || null }; });
    let facts = m ? factsOf(m.pack) : [];
    if (p.kind === "hook") facts = facts.slice(0, 1);
    if (p.kind === "context") facts = [];
    if (p.kind === "consequence" && m) facts = [...(m.dev.a.humanConsequences ? [{ text: `Human consequences (from the evidence): ${m.dev.a.humanConsequences}`, ref: refsOf(m.pack).join("+"), cls: "INTERPRETATION" }] : []), ...(m.dev.a.possibleImplications ? [{ text: `Possible implications (NOT established): ${m.dev.a.possibleImplications}`, ref: "none", cls: "FUTURE POSSIBILITY" }] : []), ...m.dev.a.missingEvidence.slice(0, 2).map((x) => ({ text: `Not yet known: ${x}`, ref: "none", cls: "UNKNOWN" }))];
    if (p.kind === "connection") facts = [{ text: ev.check.belongTogether, ref: "edition-level", cls: "EDITORIAL INTERPRETATION" }];
    const factLines = facts.length ? facts.map((f) => `${f.text} [${f.ref}; ${f.cls}]`).join(" | ") : brandOnly ? "none: this scene adds no new facts" : "no sourced fact available: leave this item out";
    const sfxSerious = d && ["human_impact", "accountability"].includes(d.delivery.profile.key);
    const transition = i === plan.length - 1 ? "End on the closing motif and a short silence." : format.key === "connected_edition" ? "Bridge to the next scene that marks only the change of story and may show the theme label tagged EDITORIAL INFERENCE. Never imply a causal link." : TRANSITIONS[i % TRANSITIONS.length] + (intensity === "STANDARD" && i % 2 === 0 ? " Optional match cut on a shared SHAPE (for example circle to circle) for rhythm only; the on-screen labels stay factual and no link between the stories is implied." : "");
    const caps: SceneCap[] = [cap("Narration audio, generated by you in the configured voice from the clean transcript", "ai_studio_manual")];
    if (inp.deliverable === "narrated_video") caps.push(cap("Procedural visual plates and motion", "python_pil"), cap("Assembly of audio and video", "ffmpeg"));
    else if (inp.deliverable === "animated_html") caps.push(cap("One self-contained HTML animation", "html_animation"));
    else caps.push(cap("Written script, storyboard and specification", "written_deliverables"));
    if (map.use) caps.push(cap("Country geometry for the locator map", "natural_earth"));
    if (pr.length) caps.push(cap("Pronunciation and listening review", "pronunciation_review"));
    caps.push(cap("Sound and music assets (record licence evidence)", "external_media"));
    caps.push({ need: "Per-word emphasis, SSML, custom pronunciation or numeric pace controls", key: "engine_controls", cls: voice.verifiedControls.length ? "MANUAL" : "UNVERIFIED", confirmed: false });
    const review: string[] = ["Editor checks every claim against its evidence refs."];
    if (d && d.et.intensity !== "STANDARD") review.push(`Editor decides whether to include this item at all (evidence: ${d.et.tier.toLowerCase().replace("_", " ")}).`);
    if (d && d.et.claimKind === "ALLEGATION") review.push("Editor confirms the allegation is attributed correctly.");
    if (pr.some((x) => x.state === "CHECK_REQUIRED")) review.push("PRONUNCIATION CHECK REQUIRED for: " + pr.filter((x) => x.state === "CHECK_REQUIRED").map((x) => x.name).join(", ") + ".");
    if (map.use) review.push("Editor verifies the map geometry and labels.");
    if (p.kind === "context") review.push("Editor verifies any BACKGROUND that is not in the evidence pack.");
    review.push("Editor confirms every sound asset has licence evidence.");
    scenes.push({
      n: i + 1, kind: p.kind, devRef: m ? d!.ref : null, title: p.title, timecode: { from, to: t }, seconds, purpose: p.purpose,
      storyRef: m && !brandOnly ? `${d!.ref}: ${m.dev.headline}` : p.kind === "hook" && m ? `${d!.ref}: ${m.dev.headline} (opening)` : "Edition-level",
      narration: { instruction: `Write the EXACT spoken narration for this scene: about ${words.target} words (${words.min} to ${words.max}) for ${seconds} seconds. Use ONLY these facts: ${factLines}. News in the first clause. At most 18 words per sentence unless clarity needs more. Spell numbers and abbreviations as spoken. ${d ? `Attribution and qualification: ${d.et.spoken.rule}` : "No new claims."}`, words, maxSentenceWords: 18, facts },
      delivery: { key: prof.key, label: prof.label, paceLo: prof.paceLo, paceHi: prof.paceHi, direction: prof.direction, reason },
      pronunciation: pr,
      visual: brandOnly || p.kind === "hook" ? { treatment: p.kind === "hook" ? "Brand opening plate, then the lead fact as typography" : p.kind === "closing" ? "Brand closing plate" : "Minimal typographic plate", compositionId: comp.id, composition: p.kind === "hook" ? "Approved logo unchanged on Midnight Navy for under two seconds, then the key fact in large type with the source chip." + (d && d.et.intensity !== "STANDARD" ? " Evidence is limited, so no animation." : "") : p.kind === "closing" ? "Approved logo unchanged and the tagline, a single quiet fade." : comp.text } : { treatment: treat!.label + ": " + treat!.devices, compositionId: comp.id, composition: comp.text + (treat!.illustrative ? " Mark this ILLUSTRATIVE on screen." : "") },
      imagery: `No photographs, footage, crowds, buildings or likenesses of named people. Editor-supplied verified assets for this scene: ${m && inp.assets?.[m.dev.id]?.length ? inp.assets[m.dev.id].join("; ") + " (confirm rights before use)" : "none"}. Use typography, map or schematic treatment only. Label any illustration ILLUSTRATIVE.`,
      camera: !d || intensity === "MINIMAL" ? "No camera movement." : intensity === "RESTRAINED" ? "A very slow push-in of at most two percent, only if it serves reading the text." : comp.id.endsWith("map") || comp.id === "ei_map" || comp.id === "en_map" || comp.id === "ic_map" ? "Pan and ease to the marker over about a second; purpose: show where this is." : "A slow push-in of three to five percent over the scene; purpose: keep the plate alive without changing the meaning.",
      motion: !d || intensity === "MINIMAL" ? "None beyond a fade in and out; purpose: legibility." : /chart|compare|data|score|callout/.test(comp.id) ? "Values grow from zero over under a second; purpose: show magnitude honestly." : "Text appears in phrase groups in time with the narration; purpose: guide the eye to the fact being spoken.",
      onScreen: { headline: d ? `A factual headline of at most eight words drawn from ${d.ref} (no stronger than its evidence).` : p.kind === "closing" ? "The tagline: What happened. What changed. What matters." : p.kind === "connection" ? `A short theme label tagged EDITORIAL INFERENCE.` : "A one-line list of the stories covered.", chip: d ? `Persistent chip: ${d.et.chip}` : "No evidence chip (no new claims).", captionRule: "Captions follow the clean transcript word for word.", keyFacts: d && !brandOnly ? "Two to three key facts, each with its source ref, only from the facts listed in the narration field." : "None." },
      mapData: map.text,
      sfx: i === plan.length - 1 ? "None." : !d ? "A single soft transition cue." : sfxSerious || intensity !== "STANDARD" ? "A soft tick at most, or silence. No impacts." : map.use ? "Quiet marker tick when the marker lands; the shared transition cue at the change of story." : "The shared transition cue at the change of story.",
      music: sound === "minimal" ? (p.kind === "hook" ? "Opening motif only." : p.kind === "closing" ? "Closing motif only." : "No music.") : p.kind === "hook" ? "Opening motif, then the bed fades in under the first sentence." : p.kind === "closing" ? "Bed fades out; closing motif resolves quietly." : sfxSerious ? "Bed ducked to near silence; one beat of silence before the first fact." : "The single music bed, ducked under narration" + (d && d.et.spoken.material ? " and a further 3 to 6 dB on the qualified claim." : "."),
      transition, evidenceRefs: m ? refsOf(m.pack) : p.kind === "connection" ? inp.members.flatMap((x) => refsOf(x.pack)) : [], capabilities: caps, humanReview: review,
      intensity, tier: d ? d.et.tier : "n/a",
    });
  });
  return { scenes, allocation: alloc, totalWords: scenes.reduce((a, s) => a + s.narration.words.target, 0), names, pronunciation: pron, perDev };
}

const tc = (s: number) => `${s}s`;
export function renderScene(s: Scene): string {
  const cap = s.capabilities.map((c) => `${c.need}: ${c.cls}${c.confirmed ? " (you confirmed this is available)" : c.cls === "FREE TOOL" || c.cls === "NATIVE" ? " (availability not confirmed by you)" : ""}`).join("; ");
  return [
    `SCENE ${s.n} (${s.kind.toUpperCase()}): ${s.title}`,
    `  1. Timecode: ${tc(s.timecode.from)} to ${tc(s.timecode.to)} (${s.seconds}s)`,
    `  2. Editorial purpose: ${s.purpose}`,
    `  3. Story reference: ${s.storyRef}`,
    `  4. Exact narration (YOU WRITE IT; put it ONLY in the clean transcript, with no directions inside it): ${s.narration.instruction}`,
    `  5. Presenter delivery profile: ${s.delivery.label}, ${s.delivery.paceLo} to ${s.delivery.paceHi} words per second (target to check by ear, not a guarantee). ${s.delivery.direction} Chosen because: ${s.delivery.reason}.`,
    `  6. Pronunciation: ${s.pronunciation.length ? s.pronunciation.map((p) => `${p.name} [${p.state === "CHECK_REQUIRED" ? "PRONUNCIATION CHECK REQUIRED" : p.state}${p.respelling ? `: say "${p.respelling}"` : ""}]`).join("; ") : "no names flagged in this scene"}`,
    `  7. Visual composition (${s.visual.compositionId}; ${s.visual.treatment}): ${s.visual.composition}`,
    `  8. Imagery and rights: ${s.imagery}`,
    `  9. Camera movement: ${s.camera}`,
    ` 10. Motion graphics: ${s.motion}`,
    ` 11. On-screen text: Headline: ${s.onScreen.headline} ${s.onScreen.chip}. Captions: ${s.onScreen.captionRule} Key facts: ${s.onScreen.keyFacts}`,
    ` 12. Map or data specification: ${s.mapData}`,
    ` 13. Sound effects: ${s.sfx}`,
    ` 14. Music direction: ${s.music}`,
    ` 15. Transition: ${s.transition}`,
    ` 16. Evidence references: ${s.evidenceRefs.length ? s.evidenceRefs.join(", ") : "none (no new claims in this scene)"}; evidence level: ${s.tier}; creative intensity: ${s.intensity}`,
    ` 17. Production capability classification: ${cap}`,
    ` 18. Human review required: ${s.humanReview.join(" ")}`,
  ].join("\n");
}

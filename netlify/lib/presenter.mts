// Creative Desk rules: presenter identity, engine-independent voice configuration, delivery profiles,
// evidence-limited creative intensity, programme formats, adaptive visual treatments, sound plan, production
// capability registry, pronunciation lexicon, narration checks and runtime allocation.
// Pure and deterministic. Nothing here generates audio, video or media, and nothing here calls a paid service.
import { createHash } from "node:crypto";
import type { Dev, Evaluation } from "./editions.mts";
import type { EvidencePack } from "./evidence-pack.mts";

export const PRESENTER_VERSION = "presenter-1";

// ---------------- presenter identity (separate from any voice engine) ----------------
export const PRESENTER = {
  identity: "A recurring WorldFiled desk presenter. Upbeat, higher-pitched, clear, naturally expressive and conversational. Confident and informed, with a sense of momentum. The presenter sounds interested in the news and understands its significance. The delivery is professional and credible, not theatrical.",
  energy: [
    "Momentum without rushing.",
    "Emphasis without shouting.",
    "Curiosity without manufactured mystery.",
    "Authority without an artificially deep voice.",
    "Expressiveness without exaggerated excitement.",
    "Seriousness when the subject requires it.",
  ],
  never: ["a generic deep male newsreader", "a trailer announcer", "a sports commentator", "a robotic assistant", "an influencer"],
};
/** Measured properties of ONE supplied sample (Laomedeia). They are not universal voice-quality rules, and the editor's listening judgement outranks them. */
export const LAOMEDEIA_REFERENCE = {
  format: "WAV, PCM 16-bit, mono, 24 kHz", durationSeconds: 17.88, integratedLufs: -15.4, truePeakDbfs: -0.6, medianPitchHz: 187, pitchVariationSemitones: 4.5,
  wordsPerSecond: 2.7, paceNote: "Pace is based on an unreliable machine transcript.", pauses: "Several natural pauses between phrase groups.",
  caution: "Measured on one supplied sample. Not a universal quality target. Listening judgement takes precedence over numerical similarity.",
};

// ---------------- voice configuration (engine-independent) ----------------
export const VOICE_STATUSES = ["REFERENCE_ONLY", "NOT_YET_TESTED", "TESTED_BY_EDITOR", "BLOCKED"] as const;
export const LICENCE_STATUSES = ["UNVERIFIED", "VERIFIED_FREE_NONCOMMERCIAL", "VERIFIED_COMMERCIAL_OK", "RESTRICTED"] as const;
export const PRONUNCIATION_HANDLING = ["NOTES_ONLY", "RESPELLING_IN_TRANSCRIPT", "ENGINE_CONTROLS"] as const;
/** Controls an engine may offer. None is assumed: a control is used in a prompt only if the editor recorded that it was verified for the configured engine. */
export const CONTROLS = ["style_prompt", "ssml", "per_word_emphasis", "custom_pronunciation", "numeric_pace"] as const;
export type Control = (typeof CONTROLS)[number];
export type VoiceConfig = {
  engine: string; voiceName: string; model: string;
  styleInstructions: string; paceInstructions: string;
  pronunciationHandling: (typeof PRONUNCIATION_HANDLING)[number];
  status: (typeof VOICE_STATUSES)[number];
  licence: { status: (typeof LICENCE_STATUSES)[number]; note: string; checkedAt: string | null };
  lastTested: string | null;
  verifiedControls: Control[];
  approval: { approved: boolean; approvedAt: string | null; approvedVoiceKey: string | null; note: string };
};
export const DEFAULT_VOICE: VoiceConfig = {
  engine: "Google AI Studio (manual generation)", voiceName: "Laomedeia", model: "",
  styleInstructions: "Upbeat, higher pitch, clear, naturally expressive and conversational. Confident and informed, with momentum.",
  paceInstructions: "Reference sample about 2.7 words per second (one sample, unreliable transcript). Treat pace as a target to check by ear.",
  pronunciationHandling: "NOTES_ONLY", status: "REFERENCE_ONLY",
  licence: { status: "UNVERIFIED", note: "Engine terms, model availability, regional availability and commercial use have not been checked.", checkedAt: null },
  lastTested: null, verifiedControls: [],
  approval: { approved: false, approvedAt: null, approvedVoiceKey: null, note: "" },
};
export const voiceKey = (v: Pick<VoiceConfig, "engine" | "voiceName" | "model">) => [v.engine, v.voiceName, v.model].map((x) => x.trim().toLowerCase()).join("|");
export type ApprovalState = "APPROVED" | "VOID_VOICE_CHANGED" | "NOT_APPROVED";
/** A listening approval belongs to one exact engine + voice + model. Changing any of them voids it (the presenter identity is unchanged). */
export function approvalState(v: VoiceConfig): ApprovalState {
  if (!v.approval.approved) return "NOT_APPROVED";
  return v.approval.approvedVoiceKey === voiceKey(v) ? "APPROVED" : "VOID_VOICE_CHANGED";
}
const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
export function validateVoice(raw: any, today = new Date().toISOString().slice(0, 10)): { ok: true; voice: VoiceConfig } | { ok: false; errors: string[] } {
  const errors: string[] = []; const r = raw && typeof raw === "object" ? raw : {};
  const engine = str(r.engine, 120), voiceName = str(r.voiceName, 80), model = str(r.model, 80);
  if (!engine) errors.push("Voice engine is required."); if (!voiceName) errors.push("Voice name is required.");
  const status = VOICE_STATUSES.includes(r.status) ? r.status : null; if (!status) errors.push("Status must be one of " + VOICE_STATUSES.join(", ") + ".");
  const lic = r.licence ?? {}; const ls = LICENCE_STATUSES.includes(lic.status) ? lic.status : null; if (!ls) errors.push("Licence status must be one of " + LICENCE_STATUSES.join(", ") + ".");
  const ph = PRONUNCIATION_HANDLING.includes(r.pronunciationHandling) ? r.pronunciationHandling : null; if (!ph) errors.push("Pronunciation handling must be one of " + PRONUNCIATION_HANDLING.join(", ") + ".");
  const lastTested = r.lastTested === null || r.lastTested === "" || r.lastTested === undefined ? null : r.lastTested;
  if (lastTested !== null && (!isDate(lastTested) || lastTested > today)) errors.push("Last tested must be a past date (YYYY-MM-DD).");
  const checkedAt = lic.checkedAt === null || lic.checkedAt === "" || lic.checkedAt === undefined ? null : lic.checkedAt;
  if (checkedAt !== null && (!isDate(checkedAt) || checkedAt > today)) errors.push("Licence checked date must be a past date (YYYY-MM-DD).");
  if ((ls === "VERIFIED_FREE_NONCOMMERCIAL" || ls === "VERIFIED_COMMERCIAL_OK") && (checkedAt === null || str(lic.note, 600).length < 10)) errors.push("A verified licence needs the date you checked it and a note saying where (at least 10 characters).");
  if (status === "TESTED_BY_EDITOR" && lastTested === null) errors.push("Status TESTED_BY_EDITOR needs a last-tested date.");
  const vc: Control[] = Array.isArray(r.verifiedControls) ? r.verifiedControls : [];
  if (vc.some((c) => !CONTROLS.includes(c))) errors.push("Unknown control in the verified-controls list.");
  const ap = r.approval ?? {};
  const approved = ap.approved === true;
  const carried = approved && typeof ap.approvedVoiceKey === "string" && ap.approvedVoiceKey.length > 0; // an existing approval keeps the voice it was given for
  if (approved && !carried && status !== "TESTED_BY_EDITOR") errors.push("A voice can only be approved after it is marked TESTED_BY_EDITOR (you listened to it).");
  if (errors.length) return { ok: false, errors };
  const voice: VoiceConfig = {
    engine, voiceName, model, styleInstructions: str(r.styleInstructions, 600), paceInstructions: str(r.paceInstructions, 400),
    pronunciationHandling: ph!, status: status!, licence: { status: ls!, note: str(lic.note, 600), checkedAt }, lastTested, verifiedControls: [...new Set(vc)],
    approval: { approved, approvedAt: approved ? (isDate(ap.approvedAt) ? ap.approvedAt : today) : null, approvedVoiceKey: approved ? (carried ? ap.approvedVoiceKey : voiceKey({ engine, voiceName, model })) : null, note: str(ap.note, 400) },
  };
  return { ok: true, voice };
}
/** Controls the prompt may ask the engine for: only those the editor verified for this exact configuration. */
export const allowedControls = (v: VoiceConfig): Control[] => v.verifiedControls;

// ---------------- production capability registry ----------------
export type CapClass = "NATIVE" | "FREE TOOL" | "MANUAL" | "UNVERIFIED" | "PAID";
export type Capability = { key: string; label: string; cls: CapClass; note: string; tested: false };
const cap = (key: string, label: string, cls: CapClass, note: string): Capability => ({ key, label, cls, note, tested: false });
/** `tested` is false for everything: appearing in a report is not testing. */
export const CAPABILITIES: Capability[] = [
  cap("written_deliverables", "Written script, storyboard and specification", "NATIVE", "Claude writes text deliverables in the current workflow."),
  cap("html_animation", "One self-contained HTML animation (screen-recordable)", "NATIVE", "A single HTML file with a master clock; no extra tool."),
  cap("piper", "Piper (local narration experiments)", "FREE TOOL", "Voice-model licence and installation on your machine are not verified."),
  cap("kokoro", "Kokoro (local narration experiments)", "FREE TOOL", "Not the default presenter. Needs your listening approval and licence review first."),
  cap("natural_earth", "Natural Earth (geographic data)", "FREE TOOL", "Natural Earth describes its data as public domain; confirm its current terms before relying on that."),
  cap("python_pil", "Python with PIL (procedural visual plates and motion)", "FREE TOOL", "Needs Python and PIL available where Claude runs."),
  cap("ffmpeg", "FFmpeg (audio and video assembly)", "FREE TOOL", "Licence terms depend on the build; confirm for your use."),
  cap("ai_studio_manual", "Manual voice generation in Google AI Studio (Laomedeia)", "MANUAL", "You generate and listen yourself. Engine terms, regional availability and commercial use are unverified."),
  cap("pronunciation_review", "Pronunciation and listening review", "MANUAL", "You listen and approve names and delivery."),
  cap("external_media", "External licensed or CC0 media", "MANUAL", "Only where you verify the rights and record the licence evidence."),
  cap("engine_controls", "Per-word emphasis, SSML, custom pronunciation, numeric pace controls", "UNVERIFIED", "Not requested from any engine unless you record the control as verified for that engine."),
  cap("paid_tts", "Paid text-to-speech (cloud TTS or API services)", "PAID", "Never assumed and never used automatically."),
  cap("paid_media", "Paid stock footage, music or sound libraries", "PAID", "Never assumed and never used automatically."),
];
export const capByKey = (k: string) => CAPABILITIES.find((c) => c.key === k)!;

// ---------------- delivery profiles ----------------
export type DeliveryKey = "major_international" | "breaking" | "human_impact" | "accountability" | "science_tech" | "economy_infrastructure" | "roundup_transition" | "closing";
export type Profile = { key: DeliveryKey; label: string; paceLo: number; paceHi: number; paceSource: "supplied" | "initial"; direction: string };
export const PROFILES: Record<DeliveryKey, Profile> = {
  major_international: { key: "major_international", label: "Major International Development", paceLo: 2.6, paceHi: 2.8, paceSource: "supplied", direction: "Clear and confident, news in the first clause, steady momentum, one lifted emphasis on the key fact, a brief pause before the consequence." },
  breaking: { key: "breaking", label: "Breaking Development", paceLo: 2.8, paceHi: 3.0, paceSource: "supplied", direction: "Slightly quicker and more urgent but controlled; state only what the sources confirm; no alarm in the voice." },
  human_impact: { key: "human_impact", label: "Human Impact", paceLo: 2.2, paceHi: 2.5, paceSource: "supplied", direction: "Slower, warmer, lower energy; give the human detail room; no dramatic emphasis; pause after the central fact." },
  accountability: { key: "accountability", label: "Accountability / Allegation", paceLo: 2.3, paceHi: 2.6, paceSource: "supplied", direction: "Measured and even; attribute the claim clearly the first time; no emphasis that treats the claim as proven." },
  science_tech: { key: "science_tech", label: "Science and Technology", paceLo: 2.7, paceHi: 2.9, paceSource: "supplied", direction: "Bright and curious but precise; slow slightly on any technical term or figure; let the mechanism be clear." },
  economy_infrastructure: { key: "economy_infrastructure", label: "Economy and Infrastructure", paceLo: 2.5, paceHi: 2.7, paceSource: "initial", direction: "Steady and exact; slow slightly on numbers, units and periods; avoid hype words." },
  roundup_transition: { key: "roundup_transition", label: "Global Roundup Transition", paceLo: 2.7, paceHi: 2.9, paceSource: "supplied", direction: "Light, quick marker of the change of story; no suggestion of a link between the stories." },
  closing: { key: "closing", label: "Closing", paceLo: 2.4, paceHi: 2.6, paceSource: "initial", direction: "Settle the energy; one clear closing line; no new facts; no prediction." },
};
export const paceMid = (p: Profile) => (p.paceLo + p.paceHi) / 2;

const textOf = (d: Dev) => [d.headline, ...d.sources.map((s) => s.title), ...d.sources.map((s) => s.summary ?? "")].join(" . ");
const ALLEGATION = /\b(alleg\w+|accus\w+|suspect\w*|charged|denied|denies|claims?|claimed|blamed|sued|lawsuit|probe|investigat\w+|fraud|corruption|misconduct)\b/i;
const PLAN = /\b(plans? to|planned|propos\w+|aims? to|target\w*|will|would|expected|could|may|draft|intends? to|pledges?|promises?|bids? to)\b/i;
const DONE = /\b(approv|sign|pass|announc|open|launch|order|issu|publish|ban|rais|cut|won|found|detect|releas|complet|expand|updat|tighten|rewrit|hik)\w*/i;
export type ClaimKind = "ALLEGATION" | "PLAN_OR_TARGET" | "COMPLETED" | "UNCLEAR";
export function claimKind(d: Dev): ClaimKind {
  const t = textOf(d);
  if (d.a.accountability.length || ALLEGATION.test(t)) return "ALLEGATION";
  const plan = PLAN.test(t), done = DONE.test(t);
  if (plan && !done) return "PLAN_OR_TARGET";
  if (done) return "COMPLETED";
  return plan ? "PLAN_OR_TARGET" : "UNCLEAR";
}

// ---------------- evidence ladder: what the evidence allows creatively ----------------
export type Tier = "OFFICIAL" | "CORROBORATED" | "SINGLE_SOURCE" | "WEAK" | "CONFLICTING";
export type Intensity = "STANDARD" | "RESTRAINED" | "MINIMAL";
export type EvidenceTreatment = {
  tier: Tier; intensity: Intensity; chip: string; claimKind: ClaimKind;
  spoken: { qualification: "none" | "once" | "both_accounts"; rule: string; material: boolean };
  forbidden: string[]; allowed: string;
};
export function evidenceTreatment(d: Dev, pack: EvidencePack): EvidenceTreatment {
  const conflicting = pack.claim_classes.some((c) => c.class === "CONFLICTING") || !!pack.editor_notes.conflict;
  const official = pack.claim_classes.some((c) => c.class === "OFFICIALLY_DOCUMENTED");
  const corroborated = pack.claim_classes.some((c) => c.class === "INDEPENDENTLY_CORROBORATED"); // the pack is stricter than the headline count: shared wording counts as ONE source
  const outlets = new Set(pack.sources.map((s) => s.outlet)).size;
  const tier: Tier = conflicting ? "CONFLICTING" : official ? "OFFICIAL" : corroborated ? "CORROBORATED" : d.a.evidenceStrength.label === "WEAK" ? "WEAK" : "SINGLE_SOURCE";
  const kind = claimKind(d);
  const intensity: Intensity = tier === "OFFICIAL" || tier === "CORROBORATED" ? "STANDARD" : tier === "SINGLE_SOURCE" ? "RESTRAINED" : "MINIMAL";
  const first = pack.sources[0]?.outlet ?? "the source";
  const chip = tier === "OFFICIAL" ? "OFFICIAL SOURCE" : tier === "CORROBORATED" ? `REPORTED BY ${outlets} OUTLETS` : tier === "SINGLE_SOURCE" ? `SINGLE SOURCE: ${first.toUpperCase()}` : tier === "WEAK" ? "WEAK EVIDENCE" : "ACCOUNTS DIFFER";
  const material = tier === "WEAK" || tier === "CONFLICTING" || kind === "ALLEGATION";
  let qualification: "none" | "once" | "both_accounts" = "none"; let rule = "One natural attribution in the first sentence of the item; no repeated qualifiers.";
  if (tier === "CONFLICTING") { qualification = "both_accounts"; rule = "Say that accounts differ and give each account, attributed. Do not choose between them."; }
  else if (kind === "ALLEGATION") { qualification = "once"; rule = "State it as an allegation or claim, attributed to who made it, once, at the first claim. Do not repeat the qualification in every sentence, and do not present it as established fact."; }
  else if (tier === "WEAK" || tier === "SINGLE_SOURCE") { qualification = "once"; rule = `Attribute once, naming the outlet in the first clause ("${first} reports..."). The on-screen chip carries the evidence level, so do not repeat "not independently confirmed" in the voice-over.`; }
  else if (kind === "PLAN_OR_TARGET") { qualification = "once"; rule = "Say plainly that it is a plan, proposal or target, and use 'plans to' or 'aims to', never the past tense of completion."; }
  const forbidden: string[] = [];
  if (intensity !== "STANDARD") forbidden.push('a "BREAKING" or "CONFIRMED" label', "impact sounds or a music swell on the claim", "dramatic zoom or countdown devices");
  if (intensity === "MINIMAL") forbidden.push("any animation that implies certainty (animated highlights, build-ups, reveal effects)", "a map marker animation (a static marker only, or no map)");
  if (kind === "ALLEGATION") forbidden.push("any visual that shows the allegation as proven (guilt colours, stamps, verdict-style graphics)");
  const allowed = intensity === "STANDARD" ? "Full adaptive treatment within the editorial purpose." : intensity === "RESTRAINED" ? "Calm treatment: static or slow, attributed, with a persistent source chip." : "Static typographic plate with a persistent source chip. Consider leaving this item out; include it only with the sourced facts, kept short.";
  return { tier, intensity, chip, claimKind: kind, spoken: { qualification, rule, material }, forbidden, allowed };
}

// ---------------- delivery selection ----------------
export type Delivery = { profile: Profile; reason: string; capped: boolean };
export function selectDelivery(d: Dev, et: EvidenceTreatment, now = Date.now()): Delivery {
  const t = textOf(d);
  const ageH = d.newest ? (now - d.newest) / 3_600_000 : Infinity;
  const breakingOk = et.intensity === "STANDARD" && et.claimKind === "COMPLETED" && ageH <= 6 && ["international_development", "government_decision", "law_regulation", "unusual_event", "environmental_event"].includes(d.a.type);
  const human = /\b(victims|survivors|patients|migrants|refugees|displaced|homeless|killed|died|dead|injured|evacuat\w+|casualties)\b/i.test(t) && !!d.a.humanConsequences;
  let key: DeliveryKey; let reason: string;
  if (et.claimKind === "ALLEGATION") { key = "accountability"; reason = "the item rests on an allegation or claim"; }
  else if (breakingOk) { key = "breaking"; reason = `corroborated or official, completed, reported within ${Math.max(1, Math.round(ageH))} hours`; }
  else if (human) { key = "human_impact"; reason = "the evidence describes effects on people"; }
  else if (d.a.type === "scientific_discovery" || d.a.type === "technology") { key = "science_tech"; reason = "a science or technology development"; }
  else if (d.a.type === "economic_change" || /\b(energy|pipeline|grid|infrastructure|railway|port|airport|electricity)\b/i.test(t)) { key = "economy_infrastructure"; reason = "an economic or infrastructure development"; }
  else { key = "major_international"; reason = "a significant development without a more specific delivery need"; }
  const base = PROFILES[key];
  const capped = et.intensity !== "STANDARD" && base.paceHi > 2.6;
  const profile = capped ? { ...base, paceHi: Math.max(base.paceLo, 2.6), paceLo: Math.min(base.paceLo, 2.6) } : base;
  return { profile, reason: reason + (capped ? `; pace capped at 2.6 words per second because the evidence is ${et.tier.replace("_", " ").toLowerCase()}` : ""), capped };
}

// ---------------- programme format ----------------
export type FormatKey = "global_roundup" | "connected_edition" | "focused_briefing";
export const FORMATS: Record<FormatKey, { label: string; description: string }> = {
  global_roundup: { label: "Global Roundup", description: "Several independently important developments with no verified shared connection. Organised by significance, geography, contrast or audience relevance. No common theme is invented." },
  connected_edition: { label: "Connected Edition", description: "Several developments that share a theme, cause, event or policy direction. The link is shown as an editorial inference unless the sources state it." },
  focused_briefing: { label: "Focused Briefing", description: "One major development with relevant context, background, consequences and related verified developments." },
};
export type FormatChoice = { key: FormatKey; label: string; why: string; connectionLabel: string | null; leadId: string | null; overridden: boolean };
export function selectFormat(ev: Evaluation, members: { dev: Dev; pack: EvidencePack }[], override?: string | null): FormatChoice {
  const n = members.length;
  const lead = [...members].sort((a, b) => Number(b.dev.a.corroborated) - Number(a.dev.a.corroborated) || b.dev.a.curiosityScore - a.dev.a.curiosityScore)[0]?.dev.id ?? null;
  let key: FormatKey; let why: string;
  if (n === 1) { key = "focused_briefing"; why = "one development was selected"; }
  else if (ev.structure === "single_country") { key = "focused_briefing"; why = "the edition is a deep dive on one place: its strongest development leads and the others are related context"; }
  else if (ev.structure === "news_roundup" || ev.coherence.verdict !== "COHERENT") { key = "global_roundup"; why = ev.structure === "news_roundup" ? "the developments were chosen as a multi-topic roundup and no shared theme is claimed" : `the coherence check is ${ev.coherence.verdict}, so no connection is claimed`; }
  else { key = "connected_edition"; why = `the coherence check found a shared theme ("${ev.theme}")`; }
  const overridden = !!override && (override as string) in FORMATS && override !== key;
  if (overridden) { key = override as FormatKey; why = "chosen by the editor (the rules suggested a different format)"; }
  return { key, label: FORMATS[key].label, why, connectionLabel: key === "connected_edition" ? "EDITORIAL INFERENCE: the connection comes from fixed-rule matching on headlines and snippets, not from verified reporting" : null, leadId: key === "focused_briefing" ? lead : null, overridden };
}

// ---------------- adaptive visual treatments ----------------
export type VisualKey = "political_legal" | "science_tech" | "energy_infra" | "economic" | "sport" | "human_interest" | "environment" | "conflict";
export type Composition = { id: string; text: string };
export const TREATMENT_SET: Record<VisualKey, { label: string; devices: string; compositions: Composition[]; illustrative: boolean }> = {
  political_legal: { label: "Political / legal", devices: "document plates, institutional maps, timelines, attributed claims", illustrative: false, compositions: [
    { id: "pl_document", text: "Document plate: a plain panel quoting only wording that appears in the evidence, with the issuing body named in a source line; key date in Archival Gold." },
    { id: "pl_timeline", text: "Dated timeline: three or four verified dates as a horizontal rail, the current step highlighted; nothing implied between steps." },
    { id: "pl_attributed", text: "Attributed-claim card: the claim in large type, who said it beneath, the evidence chip fixed in the corner." } ] },
  science_tech: { label: "Science / technology", devices: "explanatory diagrams, product mechanisms, labelled schematics", illustrative: true, compositions: [
    { id: "st_schematic", text: "Labelled schematic of the mechanism, built from shapes, step by step, marked ILLUSTRATIVE." },
    { id: "st_compare", text: "Before and after comparison panel showing only what the source states changed." },
    { id: "st_callout", text: "Large term and plain-language definition with one callout line to the key figure." } ] },
  energy_infra: { label: "Energy / infrastructure", devices: "geographic maps, network schematics, data comparisons", illustrative: false, compositions: [
    { id: "ei_map", text: "Geographic map locating the named place, with a label; no invented routes, lines or assets." },
    { id: "ei_network", text: "Simple network schematic of the named components only, marked ILLUSTRATIVE." },
    { id: "ei_data", text: "Zero-based bar comparison of the sourced figures with units and period." } ] },
  economic: { label: "Economic", devices: "zero-based charts, comparisons, numerical callouts", illustrative: false, compositions: [
    { id: "ec_chart", text: "Zero-based chart of the sourced figure, axis labelled with unit and period, source line beneath." },
    { id: "ec_callout", text: "One large number as a callout with its unit, period and a one-line meaning." },
    { id: "ec_compare", text: "Two-value comparison panel (this period against the stated earlier one), no extrapolation." } ] },
  sport: { label: "Sport", devices: "event typography, lane or score graphics, verified statistics", illustrative: false, compositions: [
    { id: "sp_type", text: "Event typography: name, place and date large, in Midnight Navy and Archival Gold." },
    { id: "sp_score", text: "Result or lane graphic built only from the verified result, no invented splits or positions." },
    { id: "sp_stat", text: "One verified statistic as a callout with its source." } ] },
  human_interest: { label: "Human interest", devices: "restrained typography, thoughtful pacing, minimal effects", illustrative: false, compositions: [
    { id: "hi_quiet", text: "Quiet typographic plate: one sentence of the verified fact, generous space, a slow fade." },
    { id: "hi_place", text: "Small place locator with the place name; nothing else moves." },
    { id: "hi_quote", text: "A short attributed quotation, only if a source gives it verbatim, in plain type." } ] },
  environment: { label: "Environment", devices: "geographic maps, verified satellite imagery, data visualisation", illustrative: false, compositions: [
    { id: "en_map", text: "Geographic map of the affected area from verified geometry, labelled." },
    { id: "en_data", text: "Data visualisation of the sourced measurement with unit and period." },
    { id: "en_imagery", text: "Verified satellite imagery ONLY if the editor supplies it with its rights; otherwise use the map or the data panel." } ] },
  conflict: { label: "International conflict", devices: "carefully sourced maps, timelines, verified documentation", illustrative: false, compositions: [
    { id: "ic_map", text: "Sourced locator map, neutral border treatment, no front lines, arrows or troop symbols unless the source supplies them." },
    { id: "ic_timeline", text: "Dated timeline of sourced events, attributed to who reports each." },
    { id: "ic_doc", text: "Document or statement plate quoting only the sourced wording, with the issuing party named." } ] },
};
const RX = {
  sport: /\b(match|championship|tournament|league|medal|olympic\w*|marathon|hyrox|race|cup|athletes?|football|cricket|tennis|rugby|basketball|goal|fixtures?|world record)\b/i,
  conflict: /\b(war|ceasefire|missiles?|troops|military|invasion|airstrikes?|hostages?|shelling|armed|frontline|offensive|truce)\b/i,
  energy: /\b(energy|pipeline|power (plant|station|grid)|grid|nuclear|oil|gas|solar|wind farm|electricity|railway|rail|port|bridge|airport|dam|infrastructure|broadband|undersea cable|refinery)\b/i,
  environment: /\b(climate|wildfires?|floods?|drought|earthquake|storm|cyclone|hurricane|typhoon|emissions?|biodiversity|glacier|ocean|forests?|pollution|species|heatwave)\b/i,
};
export function visualKey(d: Dev): VisualKey {
  const t = textOf(d);
  if (RX.sport.test(t)) return "sport";
  if (RX.conflict.test(t)) return "conflict";
  if (RX.energy.test(t)) return "energy_infra";
  if (d.a.type === "environmental_event" || RX.environment.test(t)) return "environment";
  if (d.a.type === "scientific_discovery" || d.a.type === "technology") return "science_tech";
  if (d.a.type === "economic_change") return "economic";
  if (["law_regulation", "government_decision", "institutional_decision", "international_development"].includes(d.a.type)) return "political_legal";
  return "human_interest";
}
const PLATES: Composition[] = [
  { id: "plate_a", text: "Static typographic plate: the headline in large type, the source chip fixed beneath it, nothing animated." },
  { id: "plate_b", text: "Static typographic plate, alternate layout: the key fact in large type on the left, the source and date on the right, nothing animated." },
];
/** Pick one composition per scene. A composition never repeats in consecutive scenes, and the least-used fits first. */
export function pickCompositions(items: { kind: VisualKey; intensity: Intensity }[], supplied: boolean[] = []): Composition[] {
  const used = new Map<string, number>(); const out: Composition[] = []; let prev = "";
  items.forEach((it, i) => {
    let pool = it.intensity === "MINIMAL" ? PLATES : TREATMENT_SET[it.kind].compositions;
    if (it.intensity !== "MINIMAL") pool = pool.filter((c) => (c.id === "en_imagery" ? !!supplied[i] : true));
    const pick = [...pool].filter((c) => c.id !== prev).sort((a, b) => (used.get(a.id) ?? 0) - (used.get(b.id) ?? 0))[0] ?? pool[0];
    used.set(pick.id, (used.get(pick.id) ?? 0) + 1); prev = pick.id; out.push(pick);
  });
  return out;
}
/** A map is only specified where the place was NAMED in the retrieved text. Publisher location alone is never an event location. */
export function mapSpec(d: Dev, intensity: Intensity, format: FormatKey): { use: boolean; text: string } {
  const loc = d.a.locations[0];
  if (!loc) return { use: false, text: "No map: no place could be established from the evidence." };
  if (loc.basis !== "mentioned in the retrieved text") return { use: false, text: `No map: ${loc.country} is only the publisher's location, not an established event location.` };
  const anim = intensity === "MINIMAL" ? "static marker only" : "marker lands with a short, calm camera move";
  return { use: true, text: `Locator map of ${loc.country} (named in the retrieved text), ${anim}. Country geometry from a verified free dataset (Natural Earth is the usual candidate; confirm the terms). ${format === "connected_edition" ? "Show each place in turn; draw no lines, routes or arrows between places." : "Locator only: no lines, routes or arrows."} Do not invent borders, routes, infrastructure or exact event positions; the position is an approximate country marker.` };
}

// ---------------- sound plan ----------------
export type SoundOpt = "subtle" | "minimal";
export function soundPlan(format: FormatKey, opt: SoundOpt) {
  const bed = opt === "minimal" ? "No music bed. Use a single short opening motif, a single closing motif and silence between." : "ONE low-intensity music bed for the whole programme, sparse and tonal, without a drum pulse or a build-up. Start with the bed roughly 18 to 24 dB below the narration and adjust by ear. Duck a further 3 to 6 dB under any spoken line that carries a number, a name or an allegation.";
  return {
    opening: "A subtle recurring sonic identity: one short tonal motif of about two seconds, original or CC0, played under the brand plate. Not a news sting, riser or boom.",
    bed,
    transitions: "Restrained transition cues of about a third of a second, all from one sound family (for example a soft tonal tick). One cue per story change, none within a story. No random whooshes.",
    mapData: "A very quiet marker tick only when a map marker lands or a figure appears, and only in scenes marked STANDARD intensity. None in RESTRAINED or MINIMAL scenes.",
    silence: "Use strategic silence: drop the bed for one beat before the first fact of a serious story and after a key figure. Leave a short silence before the closing line.",
    serious: "For human-impact, allegation and conflict items: bed ducked to near silence, no transition cue stronger than a soft tick, no swells, no impacts.",
    closing: "Resolve the opening motif once, quietly. No stinger.",
    avoid: "Generic news stings, random whooshes, excessive impacts, notification sounds, cinematic booms.",
    licence: "Every sound or music asset must be identified as GENERATED (say with what), PUBLIC DOMAIN, CC0 or LICENSED. For each asset record: its name, where it came from, its licence, a link to the licence terms, and the date checked. Free to download is NOT proof of commercial use. If the licence cannot be shown, do not use the asset. WorldFiled Desk does not generate or render audio.",
    formatNote: format === "focused_briefing" ? "Single-subject briefing: keep the bed even and use silence to let the central fact land." : format === "connected_edition" ? "Use the same transition cue for every story change so the edition feels continuous, without implying a causal link." : "Use the same transition cue for every story change; it marks only a change of story.",
  };
}

// ---------------- pronunciation ----------------
export const LEX_STATUSES = ["CONFIRMED_HUMAN", "SOURCED", "PROPOSED", "UNCONFIRMED"] as const;
export type LexEntry = { name: string; type: string; language: string; pronunciation: string; status: (typeof LEX_STATUSES)[number]; source: string; engineNotes: Record<string, string>; lastTested: string | null };
export function validateLexEntry(raw: any, today = new Date().toISOString().slice(0, 10)): { ok: true; entry: LexEntry } | { ok: false; errors: string[] } {
  const errors: string[] = []; const r = raw && typeof raw === "object" ? raw : {};
  const name = str(r.name, 120); if (!name) errors.push("A written name is required.");
  const status = LEX_STATUSES.includes(r.status) ? r.status : null; if (!status) errors.push("Status must be one of " + LEX_STATUSES.join(", ") + ".");
  const pronunciation = str(r.pronunciation, 200), source = str(r.source, 300);
  if (status === "CONFIRMED_HUMAN" && (!pronunciation || source.length < 3)) errors.push("A confirmed pronunciation needs the respelling and where or how you confirmed it.");
  if (status === "SOURCED" && (!pronunciation || source.length < 3)) errors.push("A sourced pronunciation needs the respelling and the source.");
  if (status === "PROPOSED" && !pronunciation) errors.push("A proposed pronunciation needs a respelling.");
  const lastTested = r.lastTested === null || r.lastTested === "" || r.lastTested === undefined ? null : r.lastTested;
  if (lastTested !== null && (!isDate(lastTested) || lastTested > today)) errors.push("Last tested must be a past date (YYYY-MM-DD).");
  const en: Record<string, string> = {}; if (r.engineNotes && typeof r.engineNotes === "object") for (const [k, v] of Object.entries(r.engineNotes).slice(0, 8)) if (typeof v === "string") en[str(k, 80)] = str(v, 300);
  if (errors.length) return { ok: false, errors };
  return { ok: true, entry: { name, type: str(r.type, 40) || "name", language: str(r.language, 60), pronunciation, status: status!, source, engineNotes: en, lastTested } };
}
export const lexKey = (n: string) => n.trim().toLowerCase();
export type PronItem = { name: string; entry: LexEntry | null; state: "CONFIRMED" | "SOURCED" | "CHECK_REQUIRED"; note: string };
/** Names and acronyms the edition's text uses. Nothing is guessed: unknown names are UNCONFIRMED and listed for the editor. */
export function namesIn(members: { dev: Dev }[]): string[] {
  const out = new Set<string>();
  for (const m of members) {
    for (const p of m.dev.proper) out.add(p);
    for (const w of textOf(m.dev).match(/\b[A-Z]{2,6}\b/g) ?? []) if (!/^(UK|US|UN|EU|AI|TV|ID|OK)$/.test(w)) out.add(w);
  }
  return [...out].slice(0, 40);
}
export function pronunciationCheck(names: string[], lex: LexEntry[]): PronItem[] {
  const map = new Map(lex.map((e) => [lexKey(e.name), e]));
  return names.map((name) => {
    const e = map.get(lexKey(name)) ?? null;
    if (e && e.status === "CONFIRMED_HUMAN") return { name, entry: e, state: "CONFIRMED" as const, note: "confirmed by the editor" };
    if (e && e.status === "SOURCED") return { name, entry: e, state: "SOURCED" as const, note: `sourced: ${e.source}` };
    return { name, entry: e, state: "CHECK_REQUIRED" as const, note: e ? `${e.status.toLowerCase()}${e.pronunciation ? ` (${e.pronunciation})` : ""}: not confirmed` : "unconfirmed: not in the lexicon" };
  });
}
export const namesInDev = (d: Dev, names: string[]) => names.filter((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(textOf(d)));

// ---------------- narration checks (rules for the written transcript) ----------------
export type NarrationIssue = { rule: string; detail: string };
const QUALIFIERS = /not independently (confirmed|verified)|unconfirmed|unverified|cannot be confirmed/gi;
export function checkNarration(text: string, opts: { maxWords?: number } = {}): NarrationIssue[] {
  const issues: NarrationIssue[] = []; const max = opts.maxWords ?? 18;
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  for (const s of sentences) { const w = s.split(/\s+/).length; if (w > max) issues.push({ rule: "sentence_length", detail: `${w} words (aim for at most ${max}): "${s.slice(0, 60)}..."` }); }
  const rq = sentences.filter((s) => s.endsWith("?")).length; if (rq > 1) issues.push({ rule: "rhetorical_questions", detail: `${rq} questions; use at most one per edition` });
  const first = sentences.map((s) => s.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z']/g, ""));
  for (let i = 2; i < first.length; i++) if (first[i] && first[i] === first[i - 1] && first[i] === first[i - 2]) { issues.push({ rule: "repeated_openings", detail: `three sentences in a row begin with "${first[i]}"` }); break; }
  if (/\[[^\]]*\]|\([^)]*(pause|beat|sfx|music|emphasis|slow|fast|smile)[^)]*\)|<[^>]+>|^\s*(SFX|MUSIC|VISUAL|CUE)\s*:/im.test(text)) issues.push({ rule: "stage_directions", detail: "stage or delivery directions inside the spoken transcript (they could be read aloud); keep them in the delivery sheet" });
  if (/\d/.test(text)) issues.push({ rule: "numbers_not_spelled", detail: "digits in the transcript; spell numbers for speech" });
  if (/%|\$|€|£|\b(km|kg|mph|Dr|St|Mr|Mrs|vs|etc)\b\.?/.test(text)) issues.push({ rule: "abbreviations_not_spelled", detail: "symbols or abbreviations in the transcript; write them out as spoken" });
  const q = text.match(QUALIFIERS) ?? []; if (q.length > 1) issues.push({ rule: "repeated_qualification", detail: `"${q[0]}" appears ${q.length} times; say it once where needed, the on-screen chip carries the rest` });
  return issues;
}

// ---------------- runtime allocation ----------------
export type RuntimeItem = { id: string; weight: number; min: number; cap: number };
export type Allocation = { hook: number; closing: number; recap: number; connection: number; items: Record<string, number>; total: number; ceiling: number; shorterThanCeiling: boolean; warnings: string[] };
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const TIER_W: Record<Tier, number> = { OFFICIAL: 1, CORROBORATED: 0.8, SINGLE_SOURCE: 0.5, CONFLICTING: 0.5, WEAK: 0.3 };
/** Weight by editorial significance, evidence and material; cap by how much sourced material exists, so a thin story is short and the edition is never padded. */
export function runtimeItem(d: Dev, et: EvidenceTreatment, pack: EvidencePack, secs: number): RuntimeItem {
  const material = Math.min(pack.sources.length, 4);
  const weight = 0.2 + 0.4 * (d.a.curiosityScore / 100) + 0.25 * TIER_W[et.tier] + 0.15 * (material / 4);
  // Short social clips use compact story slots. A daily bulletin needs room for explanation,
  // context and consequences, but only where the evidence supports it.
  const longForm = secs >= 480;
  return { id: d.id, weight, min: longForm ? 18 : 7, cap: Math.min(secs, longForm ? 45 + 20 * material : 12 + 9 * material) };
}
export function allocateRuntime(items: RuntimeItem[], secs: number, format: FormatKey, opts: { roundupRecap?: boolean } = {}): Allocation {
  const warnings: string[] = [];
  const hook = clamp(Math.round(secs * 0.06), 3, 6), closing = clamp(Math.round(secs * 0.06), 3, 6);
  const recap = format === "global_roundup" && items.length >= 3 && secs >= 90 && opts.roundupRecap !== false ? 4 : 0;
  const connection = format === "connected_edition" ? clamp(Math.round(secs * 0.08), 4, 8) : 0;
  const content = secs - hook - closing - recap - connection;
  const sumMin = items.reduce((a, i) => a + i.min, 0);
  const alloc: Record<string, number> = {}; let free = items.slice();
  let pool = content; const fixed = new Set<string>();
  if (sumMin > content) {
    warnings.push(`${items.length} developments need at least ${sumMin + secs - content} seconds at the minimum of ${items[0]?.min ?? 7} seconds each; this edition is set to ${secs}. Remove a development or choose a longer length. Each item below is given its minimum and the total runs over.`);
    for (const i of items) alloc[i.id] = i.min;
  } else {
    for (let guard = 0; guard < 10 && free.length; guard++) {
      const wsum = free.reduce((a, i) => a + i.weight, 0); let changed = false;
      for (const i of free) { const share = (pool * i.weight) / wsum; if (share > i.cap) { alloc[i.id] = i.cap; fixed.add(i.id); changed = true; } else if (share < i.min) { alloc[i.id] = i.min; fixed.add(i.id); changed = true; } }
      if (changed) { pool = content - [...fixed].reduce((a, id) => a + alloc[id], 0); free = items.filter((i) => !fixed.has(i.id)); continue; }
      for (const i of free) alloc[i.id] = (pool * i.weight) / wsum; break;
    }
    for (const i of items) if (alloc[i.id] === undefined) alloc[i.id] = i.min;
  }
  // Largest-remainder rounding: independent Math.round calls can spend more
  // than the available story-time budget when several fractional shares round up.
  // Preserve the intentional minimum-duration overrun branch above; otherwise
  // round the aggregate once, then award spare seconds by largest fractional share.
  const rounded: Record<string, number> = {};
  for (const i of items) rounded[i.id] = Math.floor(alloc[i.id]);
  if (sumMin <= content) {
    const target = Math.min(content, Math.round(items.reduce((sum, i) => sum + alloc[i.id], 0)));
    let spare = Math.max(0, target - Object.values(rounded).reduce((sum, value) => sum + value, 0));
    const order = items.slice().sort((a, b) => {
      const fraction = (alloc[b.id] - Math.floor(alloc[b.id])) - (alloc[a.id] - Math.floor(alloc[a.id]));
      return fraction || items.indexOf(a) - items.indexOf(b);
    });
    for (const i of order) {
      if (!spare) break;
      if (rounded[i.id] < Math.ceil(alloc[i.id]) && rounded[i.id] < i.cap) {
        rounded[i.id]++; spare--;
      }
    }
  }
  const total = hook + closing + recap + connection + Object.values(rounded).reduce((a, b) => a + b, 0);
  const shorter = total < secs - 2;
  if (shorter) warnings.push(`The sourced material supports about ${total} seconds, not ${secs}. The edition is shorter on purpose and is not padded.`);
  return { hook, closing, recap, connection, items: rounded, total, ceiling: secs, shorterThanCeiling: shorter, warnings };
}

// ---------------- configuration identity (invalidates saved prompts when it changes) ----------------
const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canon(x)])) : v;
export type CreativeSettings = { voice: VoiceConfig; toolsConfirmed: string[] };
export function configHash(settings: CreativeSettings, names: string[], lex: LexEntry[]): string {
  const rel = pronunciationCheck(names, lex).map((p) => ({ n: p.name, e: p.entry ? { ...p.entry } : null }));
  return createHash("sha256").update(JSON.stringify(canon({ v: PRESENTER_VERSION, voice: settings.voice, tools: [...settings.toolsConfirmed].sort(), lex: rel }))).digest("hex");
}
export const DEFAULT_SETTINGS: CreativeSettings = { voice: DEFAULT_VOICE, toolsConfirmed: [] };

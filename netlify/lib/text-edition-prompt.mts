// Evidence-bounded prompt builder for the daily written news edition.
import { brandBlock, brandChecklist, BRAND_VERSION } from "./brand.mts";
import { CLASS_MEANING, cleanField, classCounts, renderEvidence } from "./evidence-pack.mts";
import { selectTools } from "./production-tools.mts";
import { evidenceHash, MAX_EDITION_SNAPSHOT_BYTES, MAX_EDITION_PROMPT_CHARS, EditionPromptTooLarge, type EditionMember } from "./edition-prompt.mts";
import type { Evaluation } from "./editions.mts";
import type { StyleRuleIn } from "./prompt-architect.mts";

const bullets = (items: string[]) => items.map((x) => "- " + x).join("\n");

export function buildTextEditionPrompt(input: {
  title: string;
  members: EditionMember[];
  evaluation: Evaluation;
  angle?: string;
  conflictNotes?: string[];
  approvedRules: StyleRuleIn[];
}) {
  const members = input.members;
  const ev = input.evaluation;
  const n = members.length;
  const flagged = members.map((m, i) => !m.dev.a.corroborated ? "D" + (i + 1) : "").filter(Boolean);
  const evidence = members.map((m, i) => [
    "--- DEVELOPMENT D" + (i + 1) + ": " + cleanField(m.dev.headline, 220) + " ---",
    "Recommendation: " + m.dev.a.recommendation + ". Evidence strength: " + m.dev.a.evidenceStrength.label + " (" + m.dev.a.evidenceStrength.why + ")",
    renderEvidence(m.pack),
    "Still missing: " + (m.dev.a.missingEvidence.join(" | ") || "not specified"),
  ].join("\n")).join("\n\n");
  const classes = (Object.keys(CLASS_MEANING) as (keyof typeof CLASS_MEANING)[]).map((k) => "- " + k + ": " + CLASS_MEANING[k]).join("\n");
  const rules = input.approvedRules.length
    ? bullets(input.approvedRules.map((r) => r.statement + " [" + r.category + ", " + r.rule_key + " v" + r.version + "]"))
    : "No approved reference rules. Follow the WorldFiled brand specification; do not imitate another publisher.";
  const conflicts = [...(input.conflictNotes ?? []), ...ev.check.conflicts].map((x) => cleanField(x, 600)).filter(Boolean);
  const title = cleanField(input.title, 200);
  const angle = cleanField(input.angle ?? "", 200);
  const roundup = ev.structure === "news_roundup";
  const prompt = [
    "You are the senior editor and fact-checking desk for THE WORLD, FILED. Prepare the TEXT EDITION of the daily global news briefing. This is a written publication, not a video script. Do not publish it; return a complete editorial draft for human review.",
    "",
    "=== NON-NEGOTIABLE EVIDENCE RULES ===",
    "- Use ONLY facts in the evidence blocks in section 5. Do not invent context, dates, numbers, names, quotes, causes, legal details, locations or consequences.",
    "- Attribute material claims to supplied source refs (D#-S#). Distinguish official records, independently corroborated reporting, single-source reporting, conflicting accounts and unknown information.",
    "- Several outlets repeating one wire report or announcement are not automatically independent corroboration.",
    "- Single-outlet developments (" + (flagged.join(", ") || "none flagged") + ") must be described as reported, not independently confirmed.",
    "- Separate established facts from EDITORIAL INTERPRETATION and FUTURE POSSIBILITY. Label each clearly. Do not imply unrelated events caused or coordinated with one another.",
    "- Do not fill evidence gaps with memory or general knowledge. If evidence is insufficient, say what is missing and keep the claim narrow.",
    "- No invented quotes, eyewitness scenes, anonymous sources, statistics or background paragraphs.",
    "",
    "=== 1. EDITION PROFILE ===",
    "Edition: " + title,
    "Edition type: Daily text briefing",
    "Selected developments: " + n,
    "Editorial structure: " + ev.structureLabel,
    "Connection assessment: " + ev.coherence.verdict + (ev.coherence.score !== null ? " (" + ev.coherence.score + "/100)" : ""),
    roundup ? "This is a multi-topic roundup. The developments are separate; do not invent a common theme." : "Editorial theme: " + cleanField(ev.theme, 160) + ". Treat the connection as an editorial interpretation, not an established fact.",
    angle ? "Editor's angle: " + angle + ". Follow it only where the evidence supports it." : "",
    "The text edition is broader than the video bulletin. It may include stories that do not merit video airtime, but every item must have a clear public-interest reason.",
    "",
    "=== 2. EDITORIAL ALLOCATION ===",
    "- LEAD STORIES: normally 3-5 items, approximately 180-260 words each where evidence supports that depth.",
    "- NEWS BRIEFS: remaining items, normally 70-120 words each.",
    "- QUICK UPDATES: only for minor but useful developments, normally 35-60 words.",
    "- Total target approximately 1,500-2,200 words and a 5-8 minute read, but evidence and editorial value outrank word count. Never pad or force a quota.",
    "- If fewer than 8 strong developments are available, publish a shorter edition. If evidence cannot support 1,500 words, write less.",
    "- Do not repeat one development in multiple sections. Group duplicate coverage under one development and attribute each distinct contribution.",
    "",
    "=== 3. EDITORIAL SEQUENCE ===",
    "Strongest opening: " + ev.check.strongestOpening,
    "Why this selection matters: " + ev.check.valueVersusSeparate,
    ...ev.sequence.map((s, i) => (i + 1) + ". " + cleanField(s.headline, 220) + " — " + s.role + ". " + s.why),
    "",
    "=== 4. REQUIRED OUTPUT ===",
    "1. Edition headline — concise and factual.",
    "2. Standfirst — 2-3 sentences on the most important development and scope.",
    "3. The lead — the most consequential story: what changed, what is known, what remains uncertain and why it matters.",
    "4. The wider briefing — remaining developments under clear subheadings; allocate space by importance and evidence.",
    "5. What to watch — only sourced next steps, scheduled decisions or unresolved questions; do not predict outcomes.",
    "6. What we could not verify — material evidence gaps, conflicting accounts and single-source limitations.",
    "7. Sources and claim register — each material claim, source ref, evidence class, and fact/interpretation/future possibility label.",
    "8. Editor fact-check checklist — names, dates, numbers, locations, quotations, proposed versus enacted decisions, disputed claims.",
    "9. Corrections/update note — recheck against fresh reporting before publication.",
    "",
    "Writing style: clear, composed and authoritative. Put the news in the first sentence. Explain technical terms plainly. Avoid formulaic openings, repetitive transitions, sensational adjectives and manufactured suspense. Use short paragraphs, useful subheadings and varied sentence rhythm. Never present a paraphrase as a direct quote. Do not claim full articles were read; the supplied evidence is headlines and short feed snippets.",
    "",
    "=== 5. SOURCE EVIDENCE (THE ONLY FACTUAL BASIS) ===",
    evidence,
    "",
    "Evidence classes:",
    classes,
    conflicts.length ? "Editor-noted conflicts (not automatically detected): " + conflicts.join(" | ") + ". Present accounts separately and attribute them." : "",
    "",
    "=== 6. BRAND AND EDITORIAL QUALITY ===",
    rules,
    brandBlock(),
    "Brand checklist (answer separately from fact-checking):",
    bullets(brandChecklist()),
    "",
    "Do not publish, schedule or distribute this edition. Return a complete draft and identify anything requiring a human editor.",
  ].filter(Boolean).join("\n");

  if (prompt.length > MAX_EDITION_PROMPT_CHARS) throw new EditionPromptTooLarge("The text edition prompt exceeds the size limit. Remove a development; nothing was shortened.");
  const snapshot = {
    developments: members.map((m, i) => ({ story_id: m.dev.id, ref: "D" + (i + 1), headline: m.dev.headline, pack: m.pack })),
    evidence_limits: members[0]?.pack.evidence_limits ?? "",
    omitted_total: members.reduce((x, m) => x + m.pack.omitted_sources.count, 0),
    claim_class_counts: members.map((m) => classCounts(m.pack)),
  };
  if (Buffer.byteLength(JSON.stringify(snapshot)) > MAX_EDITION_SNAPSHOT_BYTES) throw new EditionPromptTooLarge("The evidence for this text edition exceeds the storage limit. Remove a development.");
  return {
    prompt,
    roles: [
      { role: "Senior news editor", why: "sets hierarchy, structure and public-interest focus" },
      { role: "News correspondent", why: "writes concise, attributed reports from the supplied evidence" },
      { role: "Editorial fact-checker", why: "checks every factual claim against its source ref and has final say" },
    ],
    tools: selectTools("script_storyboard", false),
    snapshot,
    evidenceHash: evidenceHash(members),
    brandVersion: BRAND_VERSION,
    rationale: { edition_kind: "text", structure: ev.structure, theme: ev.theme, sequence: ev.sequence, evidence_classes: members.map((m, i) => ({ ref: "D" + (i + 1), ...classCounts(m.pack) })), word_target: "1500-2200 (evidence-led, not mandatory)", approved_style_rules: input.approvedRules.map((r) => r.rule_key + "@v" + r.version) },
  };
}

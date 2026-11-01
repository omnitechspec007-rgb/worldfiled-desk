// Creative Prompt Architect: turns ONE approved story into a complete, story-specific production assignment for Claude.
// Rule-based and deterministic (no AI, no cost). It does not render, voice or publish anything.
import { BRAND_VERSION, brandBlock, brandChecklist } from "./brand.mts";
import { CLASS_MEANING, cleanField, classCounts, renderEvidence, type EvidencePack } from "./evidence-pack.mts";
import { DELIVERABLES, selectTools, type Deliverable, type ToolPlan } from "./production-tools.mts";
import { TREATMENTS, getTreatment, type Treatment } from "./treatments.mts";

export const MAX_PROMPT_CHARS = 120_000;
export class PromptTooLarge extends Error {}

export type StyleRuleIn = { rule_key: string; version: number; category: string; statement: string };
export type ArchitectInput = {
  pack: EvidencePack;
  treatmentKey: string;
  deliverable: Deliverable;
  durationSeconds: 30 | 60 | 90;
  angle?: string;
  curiosity?: { score: number; patterns: { label: string; why: string }[] };
  approvedRules: StyleRuleIn[];
};
export type ArchitectOutput = {
  prompt: string;
  treatment: Treatment;
  tools: ToolPlan;
  rationale: Record<string, unknown>;
  brandVersion: string;
};

// General narration guidance (production practice, not measured from the reference videos).
const WORDS_PER_SECOND: [number, number] = [2.2, 2.8];
export const wordBudget = (s: number) => ({ min: Math.round(s * WORDS_PER_SECOND[0]), max: Math.round(s * WORDS_PER_SECOND[1]), target: Math.round(s * 2.5) });

const bullets = (a: string[]) => a.map((x) => `- ${x}`).join("\n");

export function buildArchitectPrompt(input: ArchitectInput): ArchitectOutput {
  const treatment = getTreatment(input.treatmentKey) ?? TREATMENTS[TREATMENTS.length - 1];
  const d = DELIVERABLES.find((x) => x.key === input.deliverable) ?? DELIVERABLES[0];
  const mapNeeded = treatment.devices.includes("map");
  const tools = selectTools(d.key, mapNeeded);
  const secs = input.durationSeconds;
  const budget = wordBudget(secs);
  const angle = cleanField(input.angle, 160);
  const p = input.pack;

  const roleLines = treatment.roles.map((r) => `- ${r.role}: ${r.why}.`).join("\n");
  const counts = classCounts(p);
  const classLegend = (Object.keys(CLASS_MEANING) as (keyof typeof CLASS_MEANING)[]).map((k) => `- ${k}: ${CLASS_MEANING[k]}`).join("\n");

  const timings = (() => {
    let t = 0;
    return treatment.arc
      .map((b, i) => {
        const len = Math.round(b.fraction * secs);
        const from = t;
        t += len;
        return `Scene ${i + 1} (${from}s to ${Math.min(t, secs)}s): ${b.beat}. Guidance: ${b.content} For this scene write the narration, the on-screen text, the visual cue, the motion and the transition.`;
      })
      .join("\n");
  })();

  const curiosity = input.curiosity
    ? `Curiosity mechanisms detected by fixed keyword rules (EDITORIAL HYPOTHESIS, not measured audience behaviour; it never overrides the evidence): ${
        input.curiosity.patterns.length ? input.curiosity.patterns.map((x) => `${x.label} (${x.why})`).join("; ") : "none detected"
      }. Editorial curiosity score: ${input.curiosity.score}/100 (a hypothesis built from the same rules).`
    : "No curiosity analysis was available for this story.";

  const rules = input.approvedRules.length
    ? "Approved style rules from the editor's Reference Library (general principles from reference videos; take inspiration, do NOT copy any other creator's branding, wording or layout):\n" +
      bullets(input.approvedRules.map((r) => `${r.statement} [${r.category}, ${r.rule_key} v${r.version}]`))
    : "No reference style rules have been approved yet. Rely on the brand specification and the treatment above; do not imitate any other creator.";

  const evidenceSection = renderEvidence(p);
  const singleOnly = (counts.SINGLE_SOURCE ?? 0) > 0 && !(counts.INDEPENDENTLY_CORROBORATED || counts.OFFICIALLY_DOCUMENTED);

  const prompt = `You are being given a complete production assignment by the editor of ${"THE WORLD, FILED."} (tagline: "What happened. What changed. What matters."). Read every section. The work is for ONE approved story. Do not publish anything; the editor will review your output.

=== RULES THAT OVERRIDE EVERYTHING ELSE ===
- Use ONLY the facts in section B. Never invent numbers, dates, names, places, quotes, dialogue, people or events. If something needed is not in section B, say so and leave it out, or ask me.
- Every claim has an evidence class in section B. You may not state a claim more strongly than its class allows. Creative treatment (metaphor, visual device, pacing, reconstruction) may never turn a SINGLE_SOURCE, CONFLICTING or UNKNOWN item into an asserted fact.
- Anything illustrative (a diagram, a reconstruction, a symbolic image) must be visibly or verbally framed as illustrative, never presented as real footage or evidence.
- Everything must be free to produce: no paid services, trials, subscriptions or API keys. If something cannot be done free, say so instead of substituting a paid option.
${singleOnly ? "- This story rests on a single outlet only. Say so on screen and in the narration (\"reported by <outlet>, not independently confirmed\").\n" : ""}- Report honestly what you could not verify or complete.

=== A. PROFESSIONAL ROLE ASSIGNMENT ===
Act as this team for this story: ${treatment.roles.map((r) => r.role).join("; ")}.
${roleLines}
Why this team: the story matched ${treatment.label.toLowerCase()} signals, so these roles fit the presentation approach below. Behave as each specialist would, and let the fact-checker have the last word.

=== B. STORY AND EVIDENCE ===
${evidenceSection}

Evidence classes, defined:
${classLegend}

=== C. CREATIVE DIRECTION ===
Treatment: ${treatment.label}.
Approach: ${treatment.approach}
Visual devices to consider (use only those the evidence supports): ${treatment.devices.join(", ")}.
First thing the audience sees: ${treatment.firstSeen}
Opening hook: ${treatment.hook} The hook must be a verified fact or an honest question the evidence raises. It must not exaggerate, tease with withheld facts, or imply more than section B supports.
${angle ? `Editor's chosen angle: "${angle}". Follow it only where the evidence supports it.\n` : ""}What the audience should understand by the end: what happened, what changed and what matters, each only as far as section B supports.
Avoid (misleading or unnecessary):
${bullets(treatment.avoid)}
- A map, timeline or comparison that adds no information.

=== D. AUDIENCE AND PSYCHOLOGY ===
${curiosity}
Aim for genuine curiosity and understanding, not outrage or alarm. No clickbait: the hook must be answered by the evidence in the piece. This section is editorial reasoning; no audience performance has been measured.

=== E. SCRIPT ===
Write the narration for ${secs} seconds: ${budget.min} to ${budget.max} words in total (aim for about ${budget.target}), at roughly ${WORDS_PER_SECOND[0]} to ${WORDS_PER_SECOND[1]} words per second.
- Opening hook (first 5 seconds), progression through the scenes in section G, and a closing line that lands "what matters" without exceeding the evidence.
- Short, declarative, calm sentences. Attribute each factual statement ("according to ...", "reported by ...").
- Provide subtitles: one short caption group per line, with its start time in seconds.
${p.editor_notes.conflict ? "- The editor noted a conflict between accounts: present each account, attributed, and do not choose between them.\n" : ""}Brand voice applies (see the brand specification below).

=== F. VISUAL DIRECTION ===
${treatment.visual}
Layout and hierarchy: one idea per scene; the headline fact first; labels small and restrained; consistent grid; designed for a 9:16 phone screen.
${rules}
The brand specification below governs colour, typography, logo and voice.

=== G. STORYBOARD (${secs}-second structure; adapt to the evidence; skip any scene the evidence cannot support) ===
${timings}

=== H. VOICEOVER ===
Voice: ${treatment.voice}
Pacing and emphasis: steady pace, a short pause before each key fact, emphasis on the single most important word per sentence; never shout or dramatise.
Pronunciation: list every person, place and organisation name in the script with a plain-text phonetic guide, and mark any you are unsure of.
Audio mood and sound design: restrained and supportive. No music that competes with the narration; no sound effects that imply events the evidence does not state.
${d.key === "narrated_video" ? "Produce the narration as an audio file (see section I)." : "Deliver the voiceover direction as written notes only; do not generate audio."}

=== I. TECHNICAL IMPLEMENTATION ===
Deliverable type: ${d.label}.
${
  tools.needed.length
    ? "Tools that are genuinely needed for this deliverable (candidates; verify before using):\n" +
      tools.needed.map((t) => `- ${t.name} (${t.repo}): ${t.why}.\n  Verify: ${t.checks.join("; ")}.`).join("\n")
    : "Tools: none required."
}
${tools.optional.length ? "Optional, only if you have a specific reason:\n" + tools.optional.map((t) => `- ${t.name} (${t.repo}): ${t.why}.`).join("\n") : ""}
Not needed for this job: ${tools.notNeeded.map((n) => `${n.name} (${n.reason})`).join("; ")}.
${tools.note}
Do not install every repository you know of; install only what you have verified is needed. If anything fails or is unavailable, report it instead of working around it with a paid service.

=== J. DELIVERABLES ===
Produce: ${d.text}
Also always provide, in this order:
1. The script, one caption group per line with start time, and total word count.
2. The storyboard.
3. The deliverable files described above, if any.
4. A claim-to-source table: every number, date, name, place and quote that appears on screen or in the script, with its source ref (S1, S2, ...) and its evidence class. Anything you cannot source: mark UNSOURCED and remove it.
5. A list of scenes you skipped or softened because the evidence could not support them.
6. A tools note: what you used, how you verified it, and anything that could not be verified.
7. Two separate checklists: FACT CHECK and BRAND COMPLIANCE (section K), each answered honestly.

=== K. QUALITY CONTROL ===
Fact check (separate from brand):
- Every claim traces to a source ref and does not exceed its evidence class.
- No invented detail; illustrative elements are labelled; single-source items are framed as "reported by".
- Visual clarity and mobile readability: large high-contrast text, generous margins, one idea per scene.
- Voiceover quality and pronunciation list complete; timing matches the word budget.
- Technical correctness: files open and play as described; report what you tested.
Brand compliance (checked separately from facts):
${bullets(brandChecklist())}

=== BRAND (mandatory; applies to the whole production) ===
${brandBlock()}
`;

  if (prompt.length > MAX_PROMPT_CHARS) throw new PromptTooLarge("The generated prompt exceeds the size limit. Nothing was shortened; choose a shorter deliverable or fewer sources.");

  return {
    prompt,
    treatment,
    tools,
    brandVersion: BRAND_VERSION,
    rationale: {
      treatment: { key: treatment.key, label: treatment.label, approach: treatment.approach },
      roles: treatment.roles,
      curiosity: input.curiosity ?? null,
      voiceover: treatment.voice,
      visual: treatment.visual,
      avoid: treatment.avoid,
      deliverable: d.key,
      duration_seconds: secs,
      evidence_class_counts: counts,
      approved_style_rules: input.approvedRules.map((r) => `${r.rule_key}@v${r.version}`),
    },
  };
}

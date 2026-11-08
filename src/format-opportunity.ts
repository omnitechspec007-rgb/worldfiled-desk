export type FormatOpportunityInput = {
  curiosityScore: number;
  evidenceStrength: { score?: number; label?: string };
  sourceCount: number;
  fresh: boolean;
  recommendation: string;
  whyInteresting: string[];
  humanConsequences?: string | null;
  possibleImplications?: string | null;
  sensationalismFlags: string[];
  verificationStatus?: string;
  editorialDecision?: string | null;
};

export type FormatOpportunity = {
  lane: "long_video" | "static_text_card" | "research_first";
  label: string;
  score: number;
  reason: string;
  suggestedRuntimeMinutes: 8 | 10 | 12 | null;
  productionReady: boolean;
  holdReason: string;
};

const bounded = (value: number, max: number) => Math.max(0, Math.min(max, Number.isFinite(value) ? value : 0));

/**
 * Format sorting is a planning hypothesis, not a fact or audience-performance prediction.
 * Curiosity is the leading signal; evidence and narrative depth decide whether a longer
 * treatment is even worth considering. This helper never grants factual or editorial clearance.
 */
export function recommendFormatOpportunity(input: FormatOpportunityInput): FormatOpportunity {
  const curiosity = bounded(input.curiosityScore, 100);
  const evidence = bounded(input.evidenceStrength?.score ?? 0, 5);
  const sourceCount = Math.max(0, Math.floor(input.sourceCount || 0));
  const hooks = input.whyInteresting?.length ?? 0;
  const narrativeDepth = (input.humanConsequences ? 1 : 0) + (input.possibleImplications ? 1 : 0) + (hooks >= 2 ? 1 : 0);
  const sensational = (input.sensationalismFlags?.length ?? 0) > 0;
  const freshness = input.fresh ? 100 : 40;
  const evidenceScore = evidence * 20;

  const longScore = Math.round(
    curiosity * 0.55 + evidenceScore * 0.25 + Math.min(narrativeDepth, 3) / 3 * 15 + freshness * 0.05 - (sensational ? 20 : 0)
  );
  const cardScore = Math.round(curiosity * 0.7 + evidenceScore * 0.2 + freshness * 0.1 - (sensational ? 15 : 0));

  let lane: FormatOpportunity["lane"] = "research_first";
  let label = "Research first";
  let score = Math.max(longScore, cardScore);
  let reason = "Current curiosity and evidence signals do not justify allocating this story to a production format yet.";
  let suggestedRuntimeMinutes: FormatOpportunity["suggestedRuntimeMinutes"] = null;

  if (!sensational && input.fresh && curiosity >= 35) {
    lane = "static_text_card";
    label = "Static text-card candidate";
    score = cardScore;
    reason = "A concise, timely development may fit the presenter-free text-card roundup after its material claims are verified.";
  }

  if (!sensational && input.fresh && curiosity >= 60 && evidence >= 3 && sourceCount >= 2 && narrativeDepth >= 1) {
    lane = "long_video";
    label = "Narrated-video candidate";
    score = longScore;
    reason = "The curiosity signal, available source breadth and narrative questions justify deeper research before considering a longer narrated treatment.";
    suggestedRuntimeMinutes = curiosity >= 85 && evidence >= 4 && sourceCount >= 4 && narrativeDepth >= 2
      ? 12
      : curiosity >= 72 && evidence >= 3.5 && sourceCount >= 3
        ? 10
        : 8;
  }

  const productionReady = input.verificationStatus === "verified" && input.editorialDecision === "approved";
  const holdReason = productionReady
    ? "Claim register is marked verified and the story has current editorial approval; final edition-level clearance is still required."
    : input.verificationStatus !== "verified"
      ? "Material claims have not passed factual verification. Internal verification preparation is allowed; public news output is held."
      : "Factual verification is marked complete, but the human editorial decision is not approved.";

  return { lane, label, score: bounded(score, 100), reason, suggestedRuntimeMinutes, productionReady, holdReason };
}

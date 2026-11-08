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

  if (!sensational && input.fresh && curiosity >= 35 && evidence >= 2 && sourceCount >= 1) {
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

export type EditionRuntimeInput = {
  curiosityScore: number;
  evidenceStrength: { score?: number; label?: string };
  sourceCount: number;
  fresh: boolean;
  recommendation: string;
  whyInteresting: string[];
  humanConsequences?: string | null;
  possibleImplications?: string | null;
  sensationalismFlags: string[];
};

export type EditionRuntimeRecommendation = {
  minutes: 8 | 10 | 12;
  storiesConsidered: number;
  averageCuriosity: number;
  averageEvidence: number;
  reason: string;
};

/** Recommend a whole-programme ceiling from the strongest eligible selected stories.
 * The editor can override the suggestion. It is a planning heuristic, not measured watch time.
 */
export function recommendEditionRuntime(inputs: EditionRuntimeInput[]): EditionRuntimeRecommendation | null {
  const eligible = inputs
    .map((input) => ({ input, fit: recommendFormatOpportunity({ ...input }) }))
    .filter((item) => item.fit.lane === "long_video")
    .sort((a, b) => b.fit.score - a.fit.score)
    .slice(0, 3);
  if (!eligible.length) return null;
  const avg = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const averageCuriosity = avg(eligible.map((item) => bounded(item.input.curiosityScore, 100)));
  const averageEvidence = avg(eligible.map((item) => bounded(item.input.evidenceStrength?.score ?? 0, 5)));
  const minutes: 8 | 10 | 12 = eligible.length === 3 && averageCuriosity >= 82 && averageEvidence >= 4.1
    ? 12
    : eligible.length >= 2 && averageCuriosity >= 70 && averageEvidence >= 3.5
      ? 10
      : 8;
  const reason = minutes === 12
    ? "The three strongest selected stories have unusually high curiosity potential, strong evidence and enough narrative depth to sustain a longer programme."
    : minutes === 10
      ? "At least two selected stories combine strong curiosity potential with sufficient evidence and narrative substance."
      : "The strongest selected story material supports a focused programme. Keep it shorter rather than padding.";
  return {
    minutes,
    storiesConsidered: eligible.length,
    averageCuriosity: Math.round(averageCuriosity),
    averageEvidence: Math.round(averageEvidence * 10) / 10,
    reason,
  };
}

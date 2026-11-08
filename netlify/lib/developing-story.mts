// Developing-story follow-up detection. Deterministic editorial cues only; never verifies facts,
// merges stories, or declares that an update is material without human review.
export type FollowUpSource = {
  id: string;
  title: string;
  summary?: string | null;
  publishedAt?: string | null;
};
export type FollowUpSignal = {
  kind: "official_action" | "legal_step" | "outcome" | "timeline" | "numeric_change" | "new_statement" | "status_change";
  label: string;
  explanation: string;
  matchedText: string;
};
export type FollowUpAssessment = {
  classification: "potential_material_development" | "new_coverage_only" | "insufficient_comparison";
  confidence: "low" | "moderate";
  newSourceIds: string[];
  signals: FollowUpSignal[];
  newestPriorAt: string | null;
  newestIncomingAt: string | null;
  reasons: string[];
  humanReviewRequired: true;
};

const RULES: { kind: FollowUpSignal["kind"]; label: string; re: RegExp; explanation: string }[] = [
  { kind: "official_action", label: "Official action", re: /\b(announces?|announced|approves?|approved|signs?|signed|orders?|ordered|issues?|issued|adopts?|adopted|launches?|launched|suspends?|suspended|withdraws?|withdrawn|resigns?|resigned|arrests?|arrested|files?|filed|publishes?|published)\b/gi, explanation: "New coverage contains wording that may indicate a formal action." },
  { kind: "legal_step", label: "Legal or regulatory step", re: /\b(court|judge|tribunal|ruling|rules? that|appeal|lawsuit|indictment|charged|charges|convicted|sentenced|regulator|regulatory|investigation|inquiry|hearing|verdict)\b/gi, explanation: "New coverage refers to a legal, judicial or regulatory step." },
  { kind: "outcome", label: "Outcome or decision", re: /\b(wins?|won|loses?|lost|reaches? agreement|agreed|settles?|settled|cleared|blocked|rejected|passes|passed|fails?|failed|takes effect|effective immediately|concludes?|concluded)\b/gi, explanation: "New coverage may describe an outcome rather than another account of the same event." },
  { kind: "timeline", label: "Timeline change", re: /\b(deadline|postponed|delayed|rescheduled|brought forward|extended|expires?|expired|takes effect|effective from|by [0-3]?\d\s+(?:January|February|March|April|May|June|July|August|September|October|November|December))\b/gi, explanation: "New coverage contains a date, deadline or timing change cue." },
  { kind: "status_change", label: "Status change", re: /\b(now|no longer|remains|resumes?|resumed|reopens?|reopened|shuts? down|closed|suspended|reinstated|reversed|backtracks?|withdraws?)\b/gi, explanation: "New coverage may indicate that the status has changed." },
  { kind: "new_statement", label: "New statement or response", re: /\b(says?|said|states?|stated|confirms?|confirmed|denies?|denied|responds?|responded|warns?|warned|admits?|admitted|reveals?|revealed)\b/gi, explanation: "New coverage contains a statement or response cue that may add a new position." },
];

function dateValue(value?: string | null): number | null {
  if (!value) return null;
  const n = Date.parse(value);
  return Number.isFinite(n) ? n : null;
}
function uniqueMatches(text: string, re: RegExp): string[] {
  return [...new Set([...text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))]
    .map((m) => m[0].toLowerCase()))];
}
function numbers(text: string): string[] {
  return [...new Set(text.match(/\b\d+(?:[,.]\d+)*(?:\s?(?:%|percent|million|billion|trillion|thousand|km|miles?|days?|weeks?|months?|years?))?\b/gi) ?? [])]
    .map((x) => x.toLowerCase().replace(/\s+/g, " "));
}

export function assessDevelopingStory(
  prior: FollowUpSource[],
  incoming: FollowUpSource[],
): FollowUpAssessment {
  const priorIds = new Set(prior.map((s) => s.id));
  const newSources = incoming.filter((s) => s.id && !priorIds.has(s.id));
  const priorDates = prior.map((s) => dateValue(s.publishedAt)).filter((n): n is number => n !== null);
  const newDates = newSources.map((s) => dateValue(s.publishedAt)).filter((n): n is number => n !== null);
  const newestPrior = priorDates.length ? Math.max(...priorDates) : null;
  const newestIncoming = newDates.length ? Math.max(...newDates) : null;
  const reasons: string[] = [];
  const signals: FollowUpSignal[] = [];

  if (!prior.length || !newSources.length) {
    return {
      classification: "insufficient_comparison", confidence: "low",
      newSourceIds: newSources.map((s) => s.id), signals,
      newestPriorAt: newestPrior === null ? null : new Date(newestPrior).toISOString(),
      newestIncomingAt: newestIncoming === null ? null : new Date(newestIncoming).toISOString(),
      reasons: [!prior.length ? "No earlier linked coverage is available for comparison." : "No newly linked source is available to compare."],
      humanReviewRequired: true,
    };
  }
  if (newestPrior === null || newestIncoming === null) {
    return {
      classification: "insufficient_comparison", confidence: "low",
      newSourceIds: newSources.map((s) => s.id), signals,
      newestPriorAt: newestPrior === null ? null : new Date(newestPrior).toISOString(),
      newestIncomingAt: newestIncoming === null ? null : new Date(newestIncoming).toISOString(),
      reasons: ["A usable publication date is missing from prior or newly linked coverage; freshness cannot be established."],
      humanReviewRequired: true,
    };
  }
  if (newestIncoming <= newestPrior) {
    return {
      classification: "new_coverage_only", confidence: "low",
      newSourceIds: newSources.map((s) => s.id), signals,
      newestPriorAt: new Date(newestPrior).toISOString(),
      newestIncomingAt: new Date(newestIncoming).toISOString(),
      reasons: ["Newly linked coverage is not later than the newest dated prior coverage."],
      humanReviewRequired: true,
    };
  }

  const priorText = prior.map((s) => [s.title, s.summary ?? ""].join(" ")).join(" ");
  const incomingText = newSources.map((s) => [s.title, s.summary ?? ""].join(" ")).join(" ");
  for (const rule of RULES) {
    const before = new Set(uniqueMatches(priorText, rule.re));
    const added = uniqueMatches(incomingText, rule.re).filter((match) => !before.has(match));
    if (added.length) signals.push({ kind: rule.kind, label: rule.label, explanation: rule.explanation, matchedText: added.slice(0, 3).join(", ") });
  }

  const beforeNumbers = new Set(numbers(priorText));
  const addedNumbers = numbers(incomingText).filter((n) => !beforeNumbers.has(n));
  if (addedNumbers.length) {
    signals.push({
      kind: "numeric_change", label: "New figures or quantities",
      explanation: "New coverage contains numeric details not present in the earlier headlines or snippets; confirm whether they are genuinely changed figures, added context or unrelated numbers.",
      matchedText: addedNumbers.slice(0, 5).join(", "),
    });
  }

  if (signals.length) {
    reasons.push("Newer linked coverage contains one or more change cues absent from the earlier retrieved headlines and snippets.");
    reasons.push("These cues are leads for human review, not proof that the underlying event changed.");
  } else {
    reasons.push("Newer linked coverage was found, but no distinct change cue was detected in the available headlines and snippets.");
    reasons.push("Treat this as additional coverage, not a confirmed material development.");
  }
  return {
    classification: signals.length ? "potential_material_development" : "new_coverage_only",
    confidence: signals.length ? "moderate" : "low",
    newSourceIds: newSources.map((s) => s.id),
    signals,
    newestPriorAt: new Date(newestPrior).toISOString(),
    newestIncomingAt: new Date(newestIncoming).toISOString(),
    reasons,
    humanReviewRequired: true,
  };
}

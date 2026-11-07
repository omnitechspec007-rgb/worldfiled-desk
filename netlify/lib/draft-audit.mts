/**
 * Deterministic, advisory editorial lint for WorldFiled drafts.
 *
 * This module detects prose patterns only. It cannot establish truth,
 * semantic support, source independence, or editorial approval.
 */
export type FindingSeverity = "review" | "suggestion";
export type DraftFinding = {
  ruleId: string;
  severity: FindingSeverity;
  message: string;
  start: number;
  end: number;
  excerpt: string;
  recommendation: string;
};

const FILLER_PATTERNS: Array<[string, RegExp, string]> = [
  ["generic-importance", /\\b(in a significant development|in a major development|in a landmark moment)\\b/gi, "Replace generic importance language with the specific documented change."],
  ["empty-superlative", /\\b(game[- ]changing|groundbreaking|unprecedented|historic|shocking|stunning)\\b/gi, "Keep only if the description is attributed and demonstrably justified; otherwise use precise wording."],
  ["fake-suspense", /\\b(what happened next|the truth is|what you need to know|here is why it matters)\\b/gi, "State the relevant fact or consequence directly instead of using a formulaic hook."],
  ["vague-attribution", /\\b(experts say|observers believe|many people think|sources indicate|reports suggest)\\b/gi, "Name the source or remove the unsupported attribution."],
  ["boilerplate-transition", /\\b(needless to say|it goes without saying|at the end of the day|in today's world)\\b/gi, "Remove the stock transition unless it adds precise information."],
];

function finding(ruleId: string, severity: FindingSeverity, message: string, text: string, start: number, end: number, recommendation: string): DraftFinding {
  return { ruleId, severity, message, start, end, excerpt: text.slice(start, end), recommendation };
}

function normalizedSentence(value: string): string {
  return value.toLocaleLowerCase("en").replace(/[^\\p{L}\\p{N}]+/gu, " ").trim();
}

/** Return stable, source-independent style findings with offsets into the original draft. */
export function lintDraft(input: unknown): DraftFinding[] {
  if (typeof input !== "string" || !input.trim()) return [];
  const text = input;
  const findings: DraftFinding[] = [];

  for (const [ruleId, pattern, recommendation] of FILLER_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      findings.push(finding(ruleId, ruleId === "vague-attribution" ? "review" : "suggestion",
        `Potentially weak or formulaic wording: “${match[0]}”.`, text, start, end, recommendation));
    }
  }

  const sentencePattern = /[^.!?\\n]+[.!?]?/g;
  const seen = new Map<string, { start: number; end: number }>();
  for (const match of text.matchAll(sentencePattern)) {
    const raw = match[0];
    const key = normalizedSentence(raw);
    if (key.length < 28) continue;
    const start = match.index ?? 0;
    const end = start + raw.length;
    const prior = seen.get(key);
    if (prior) {
      findings.push(finding("duplicate-sentence", "review",
        "A sentence repeats earlier wording; check whether it adds new information.", text, start, end,
        "Remove the duplicate or make the distinct update explicit."));
    } else {
      seen.set(key, { start, end });
    }
  }

  const paragraphs = text.split(/\\n\\s*\\n/);
  let offset = 0;
  const openings = new Map<string, number>();
  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    const leading = paragraph.indexOf(trimmed);
    const first = trimmed.split(/\\s+/).slice(0, 3).join(" ").toLocaleLowerCase("en");
    if (first.length >= 10) {
      const start = offset + Math.max(0, leading);
      const prior = openings.get(first);
      if (prior !== undefined) {
        findings.push(finding("repeated-paragraph-opening", "suggestion",
          "Paragraphs begin with the same short phrase.", text, start, start + Math.min(trimmed.length, first.length),
          "Vary the structure only when it improves clarity; do not rewrite merely to avoid a pattern."));
      } else openings.set(first, start);
    }
    offset += paragraph.length + 2;
  }

  return findings.sort((a, b) => a.start - b.start || a.ruleId.localeCompare(b.ruleId));
}

export type ClaimAuditInput = {
  claims: Array<{ id: string; status: "supported" | "unsupported" | "unresolved" | "contradicted"; decisionEvidenceVersion?: number; currentEvidenceVersion?: number }>;
  evidence: Array<{ id: string; claimId: string; sourceId: string; extractionStatus: "extracted" | "metadata_only" | "inaccessible"; passage?: string | null; isContradiction?: boolean }>;
};

export type ClaimAuditFinding = { ruleId: string; severity: "blocker" | "review"; claimId: string; evidenceId?: string; message: string };

/**
 * Validate evidence readiness only. This does not decide whether a passage
 * semantically entails a claim and never upgrades a claim to supported.
 */
export function auditClaimEvidence(input: ClaimAuditInput): ClaimAuditFinding[] {
  const out: ClaimAuditFinding[] = [];
  const evidence = Array.isArray(input?.evidence) ? input.evidence : [];
  for (const claim of Array.isArray(input?.claims) ? input.claims : []) {
    const linked = evidence.filter((item) => item.claimId === claim.id);
    if (!linked.length) {
      out.push({ ruleId: "claim-without-evidence", severity: "blocker", claimId: claim.id, message: "Material claim has no linked evidence." });
      continue;
    }
    const checked = linked.filter((item) => item.extractionStatus === "extracted" && typeof item.passage === "string" && item.passage.trim().length > 0);
    if (!checked.length) out.push({ ruleId: "no-checked-passage", severity: "blocker", claimId: claim.id, message: "Linked sources contain no checked passage; metadata and snippets are leads, not supporting evidence." });
    if (linked.some((item) => item.isContradiction)) {
      out.push({ ruleId: "contradictory-evidence", severity: "review", claimId: claim.id, message: "Contradictory evidence is present and requires a specific editor reconciliation." });
    }
    if (claim.status === "supported" && claim.decisionEvidenceVersion !== undefined && claim.currentEvidenceVersion !== undefined && claim.decisionEvidenceVersion !== claim.currentEvidenceVersion) {
      out.push({ ruleId: "stale-claim-decision", severity: "blocker", claimId: claim.id, message: "The claim decision predates the current evidence version and must be reviewed again." });
    }
    if (claim.status !== "supported") {
      out.push({ ruleId: "claim-not-cleared", severity: "blocker", claimId: claim.id, message: `Claim status is ${claim.status}; the audit cannot treat it as factually cleared.` });
    }
  }
  for (const item of evidence) {
    if (!item.sourceId) out.push({ ruleId: "evidence-source-missing", severity: "blocker", claimId: item.claimId, evidenceId: item.id, message: "Evidence does not resolve to a source." });
  }
  return out;
}

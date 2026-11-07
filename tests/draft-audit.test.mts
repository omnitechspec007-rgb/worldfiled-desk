import assert from "node:assert/strict";
import { auditClaimEvidence, lintDraft } from "../netlify/lib/draft-audit.mts";

const draft = [
  "In a significant development, the minister announced a new policy.",
  "Experts say the policy is groundbreaking.",
  "",
  "In a significant development, the minister announced a new policy.",
].join("\n");
const findings = lintDraft(draft);
assert(findings.some((x) => x.ruleId === "generic-importance"));
assert(findings.some((x) => x.ruleId === "vague-attribution" && x.severity === "review"));
assert(findings.some((x) => x.ruleId === "empty-superlative"));
assert(findings.some((x) => x.ruleId === "duplicate-sentence"));
for (const item of findings) {
  assert(item.start >= 0 && item.end > item.start);
  assert.equal(draft.slice(item.start, item.end), item.excerpt);
}
assert.deepEqual(lintDraft(""), []);
assert.deepEqual(lintDraft(null), []);

const metadataOnly = auditClaimEvidence({
  claims: [{ id: "c1", status: "unresolved" }],
  evidence: [{ id: "e1", claimId: "c1", sourceId: "s1", extractionStatus: "metadata_only" }],
});
assert(metadataOnly.some((x) => x.ruleId === "no-checked-passage" && x.severity === "blocker"));
assert(metadataOnly.some((x) => x.ruleId === "claim-not-cleared"));

const stale = auditClaimEvidence({
  claims: [{ id: "c2", status: "supported", decisionEvidenceVersion: 1, currentEvidenceVersion: 2 }],
  evidence: [{ id: "e2", claimId: "c2", sourceId: "s2", extractionStatus: "extracted", passage: "Checked source passage." , isContradiction: true }],
});
assert(stale.some((x) => x.ruleId === "stale-claim-decision" && x.severity === "blocker"));
assert(stale.some((x) => x.ruleId === "contradictory-evidence" && x.severity === "review"));
assert.equal(auditClaimEvidence({ claims: [], evidence: [] }).length, 0);
console.log("PASS: deterministic draft lint and evidence-readiness checks.");

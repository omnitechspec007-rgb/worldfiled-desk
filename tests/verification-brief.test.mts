import assert from "node:assert/strict";
import { buildEvidencePack } from "../netlify/lib/evidence-pack.mts";
import { buildVerificationBrief } from "../netlify/lib/verification-brief.mts";
import { VERIFICATION_SOURCE_STARTERS, verificationStartersFor } from "../netlify/lib/verification-sources.mts";

const pack = buildEvidencePack({
  headline: "Central bank announces a policy change in Nigeria",
  category: "Business and economic developments",
  sources: [{
    outlet: "Daily Example", region: "Africa", tier: "reporting",
    url: "https://example.test/story", title: "Central bank announces policy change",
    summary: "The central bank said a new policy would take effect next month.",
    publishedAt: "2026-11-08T08:00:00Z", retrievedAt: "2026-11-08T08:05:00Z",
  }],
});
const dev = {
  id: "story-1",
  headline: "Central bank announces a policy change in Nigeria",
  a: {
    curiosityScore: 72,
    evidenceStrength: { label: "LIMITED", score: 2 },
    whyInteresting: ["A policy decision may affect borrowing costs."],
    audienceQuestion: "What changes for households and businesses?",
    keyQuestions: ["What exactly changed?", "When does it take effect?"],
    missingEvidence: ["The original policy circular has not been retrieved."],
    locations: [{ country: "Nigeria", basis: "mentioned in the retrieved text" }],
  },
} as any;
const result = buildVerificationBrief({
  title: "Daily verification queue",
  angle: "Check the exact policy terms and effective date",
  members: [{ dev, pack }],
});
assert.equal(result.storyCount, 1);
assert.equal(result.sourceCount, 1);
assert.match(result.prompt, /INTERNAL RESEARCH ASSIGNMENT ONLY/);
assert.match(result.prompt, /Do NOT write a news article/);
assert.match(result.prompt, /original document/);
assert.match(result.prompt, /two publisher labels do NOT establish independence/i);
assert.match(result.prompt, /SUPPORTED, PARTIALLY_SUPPORTED, CONTRADICTED, INSUFFICIENT, UNKNOWN/);
assert.match(result.prompt, /READY FOR HUMAN CLAIM REVIEW is not VERIFIED/);
assert.match(result.prompt, /Central Bank of Nigeria/);
assert.match(result.prompt, /https:\/\/www\.cbn\.gov\.ng/);
assert.match(result.prompt, /The original policy circular has not been retrieved/);
assert.match(result.prompt, /https:\/\/example\.test\/story/);

const nigerian = verificationStartersFor(["Nigeria"]);
assert.ok(nigerian.some((s) => s.name === "Central Bank of Nigeria"));
assert.ok(!nigerian.some((s) => s.name === "Legislation.gov.uk"));
assert.ok(VERIFICATION_SOURCE_STARTERS.every((s) => s.url.startsWith("https://")));
assert.ok(VERIFICATION_SOURCE_STARTERS.filter((s) => s.class === "independent_reporting").every((s) => Boolean(s.standardsUrl)));
console.log("PASS: pre-clearance brief requests verification only and forbids public-facing news copy.");
console.log("PASS: Nigeria source starters are jurisdiction-aware and clearly distinguished from claim verification.");

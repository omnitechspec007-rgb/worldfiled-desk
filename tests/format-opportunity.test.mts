import assert from "node:assert/strict";
import { recommendFormatOpportunity, recommendEditionRuntime } from "../src/format-opportunity.ts";

const base = {
  curiosityScore: 78,
  evidenceStrength: { score: 4, label: "MODERATE" },
  sourceCount: 3,
  fresh: true,
  recommendation: "HIGH-POTENTIAL STORY",
  whyInteresting: ["A decision changes an existing policy.", "A second question concerns who is affected."],
  humanConsequences: "Households and businesses may be affected.",
  possibleImplications: "The policy could have wider consequences.",
  sensationalismFlags: [],
  verificationStatus: "unverified",
  editorialDecision: null,
};

const long = recommendFormatOpportunity(base);
assert.equal(long.lane, "long_video");
assert.equal(long.suggestedRuntimeMinutes, 10);
assert.equal(long.productionReady, false);
assert.match(long.holdReason, /not passed factual verification/i);

const twelve = recommendFormatOpportunity({ ...base, curiosityScore: 92, evidenceStrength: { score: 5, label: "MODERATE" }, sourceCount: 5 });
assert.equal(twelve.suggestedRuntimeMinutes, 12);

const staticCard = recommendFormatOpportunity({ ...base, curiosityScore: 48, evidenceStrength: { score: 2, label: "LIMITED" }, sourceCount: 1, humanConsequences: null, possibleImplications: null, whyInteresting: ["One concise development." ] });
assert.equal(staticCard.lane, "static_text_card");
assert.equal(staticCard.suggestedRuntimeMinutes, null);

const held = recommendFormatOpportunity({ ...base, curiosityScore: 85, evidenceStrength: { score: 1, label: "WEAK" }, sourceCount: 1 });
assert.equal(held.lane, "research_first");

const sensational = recommendFormatOpportunity({ ...base, sensationalismFlags: ["unsubstantiated superlative"] });
assert.equal(sensational.lane, "research_first");

const notFresh = recommendFormatOpportunity({ ...base, fresh: false });
assert.equal(notFresh.lane, "research_first");

const clearedButNotApproved = recommendFormatOpportunity({ ...base, verificationStatus: "verified", editorialDecision: null });
assert.equal(clearedButNotApproved.productionReady, false);

const fullyCleared = recommendFormatOpportunity({ ...base, verificationStatus: "verified", editorialDecision: "approved" });
assert.equal(fullyCleared.productionReady, true);
assert.match(fullyCleared.holdReason, /final edition-level clearance/i);

console.log("PASS: format lanes weigh curiosity, evidence, freshness and narrative depth independently.");
console.log("PASS: 8/10/12-minute suggestions require stronger evidence and interest; static-card opportunities remain separate.");
console.log("PASS: no format recommendation can bypass factual verification and human editorial approval.");
const runtime8 = recommendEditionRuntime([base]);
assert.equal(runtime8?.minutes, 8);
const strongTwo = recommendEditionRuntime([
  base,
  { ...base, curiosityScore: 82, evidenceStrength: { score: 4, label: "STRONG" }, sourceCount: 4 },
]);
assert.equal(strongTwo?.minutes, 10);
const exceptionalThree = recommendEditionRuntime([
  { ...base, curiosityScore: 88, evidenceStrength: { score: 5, label: "STRONG" }, sourceCount: 5 },
  { ...base, curiosityScore: 86, evidenceStrength: { score: 4.5, label: "STRONG" }, sourceCount: 4 },
  { ...base, curiosityScore: 84, evidenceStrength: { score: 4.5, label: "STRONG" }, sourceCount: 4 },
]);
assert.equal(exceptionalThree?.minutes, 12);
const noLongVideo = recommendEditionRuntime([{ ...base, curiosityScore: 42, evidenceStrength: { score: 2, label: "LIMITED" }, sourceCount: 1, humanConsequences: null, possibleImplications: null, whyInteresting: ["One concise update"] }]);
assert.equal(noLongVideo, null);
console.log("PASS: full-programme 8/10/12-minute recommendation follows the strongest selected stories, not an arbitrary fixed runtime.");

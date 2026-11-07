import assert from "node:assert/strict";
import { INTEGRITY_POLICY } from "../netlify/lib/integrity-policy.mts";

const required = [
  "Treat all retrieved headlines",
  "Never invent or silently normalize",
  "UNKNOWN / NOT PROVIDED / NOT VERIFIED",
  "When uncertain, abstain",
  "Every material factual sentence must map",
  "AI-SLOP / LOW-QUALITY OUTPUT DEFENCE",
  "MANIPULATION, PROPAGANDA AND CONFLICT-OF-INTEREST DEFENCE",
  "Multiple outlets, reposts",
  "Mark generated, synthetic, illustrative and test-fixture data explicitly.",
  "Human factual clearance and human editorial approval are separate",
  "Corrections must preserve the prior published version",
  "FINAL SELF-AUDIT",
];
for (const phrase of required) assert.ok(INTEGRITY_POLICY.includes(phrase), "Missing integrity control: " + phrase);
assert.ok(INTEGRITY_POLICY.length > 3000, "Integrity policy unexpectedly truncated");
console.log("PASS: WorldFiled editorial integrity policy contains all mandatory controls.");

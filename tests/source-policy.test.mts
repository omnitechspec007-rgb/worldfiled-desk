import assert from "node:assert/strict";
import {
  CONTENT_POLICIES,
  canRetrieveMetadata,
  canUsePassageEvidence,
  policyForSource,
  retrievalContentStatus,
} from "../netlify/lib/source-policy.mts";

const rows = [
  { source_id: "blocked", policy: "blocked" },
  { source_id: "metadata", policy: "metadata_only" },
  { source_id: "allowed", policy: "extraction_allowed" },
  { source_id: "malformed", policy: "allow_everything" },
];

assert.deepEqual(CONTENT_POLICIES, ["blocked", "metadata_only", "extraction_allowed"]);
assert.equal(policyForSource(rows, "missing"), "metadata_only", "missing policy defaults to metadata-only");
assert.equal(policyForSource(rows, "blocked"), "blocked");
assert.equal(policyForSource(rows, "metadata"), "metadata_only");
assert.equal(policyForSource(rows, "allowed"), "extraction_allowed");
assert.equal(policyForSource(rows, "malformed"), "blocked", "unknown policy values fail closed");

assert.equal(canRetrieveMetadata("blocked"), false);
assert.equal(canRetrieveMetadata("metadata_only"), true);
assert.equal(canRetrieveMetadata("extraction_allowed"), true);
assert.equal(canUsePassageEvidence("blocked"), false);
assert.equal(canUsePassageEvidence("metadata_only"), false);
assert.equal(canUsePassageEvidence("extraction_allowed"), true);

for (const row of rows) assert.equal(retrievalContentStatus(policyForSource(rows, row.source_id)), "metadata_only");
console.log("PASS: source policy defaults to metadata-only, unknown values fail closed, and only extraction_allowed permits passage evidence.");

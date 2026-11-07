import assert from "node:assert/strict";
import { canRetrieveMetadata, policyForSource, retrievalContentStatus } from "../netlify/lib/source-policy.mts";

const rows = [
  { source_id: "blocked", policy: "blocked" },
  { source_id: "metadata", policy: "metadata_only" },
  { source_id: "allowed", policy: "extraction_allowed" },
  { source_id: "malformed", policy: "allow_everything" },
];

assert.equal(policyForSource(rows, "missing"), "metadata_only", "missing policy defaults to metadata-only");
assert.equal(policyForSource(rows, "blocked"), "blocked");
assert.equal(canRetrieveMetadata(policyForSource(rows, "blocked")), false);
assert.equal(policyForSource(rows, "metadata"), "metadata_only");
assert.equal(canRetrieveMetadata(policyForSource(rows, "metadata")), true);
assert.equal(policyForSource(rows, "allowed"), "extraction_allowed");
assert.equal(policyForSource(rows, "malformed"), "blocked", "unknown policy values fail closed");
for (const row of rows) assert.equal(retrievalContentStatus(policyForSource(rows, row.source_id)), "metadata_only");
console.log("PASS source policy defaults, allowlist, fail-closed handling and metadata-only extraction boundary");

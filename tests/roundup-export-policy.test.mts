import assert from "node:assert/strict";
import { canExportRoundup } from "../src/roundup-export-policy.mts";

assert.equal(canExportRoundup(false, 3), false, "editorial clearance is mandatory");
assert.equal(canExportRoundup(true, 3), true, "a cleared roundup with stories can export");
assert.equal(canExportRoundup(true, 1), true, "a single-story roundup remains valid");
assert.equal(canExportRoundup(true, 0), false, "an empty roundup cannot export");
assert.equal(canExportRoundup(false, 0), false, "empty and uncleared roundups cannot export");
assert.equal(canExportRoundup(true, -1), false, "negative story counts are invalid");
assert.equal(canExportRoundup(true, 1.5), false, "fractional story counts are invalid");

console.log("ALL STATIC ROUNDUP EXPORT POLICY CHECKS PASSED");

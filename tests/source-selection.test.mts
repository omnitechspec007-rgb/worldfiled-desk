import assert from "node:assert/strict";
import { shouldProbeSource, canUseSourceForResearch, eligibleResearchSourceIds } from "../netlify/lib/source-selection.mts";

const source = (id: string, patch: Record<string, unknown> = {}) => ({
  id, enabled: false, retrieval_status: "untested", feed_url: "https://feed.example/rss",
  reliability_note: "tier:reporting; built-in candidate, health tested automatically",
  ...patch,
});

assert.equal(shouldProbeSource(source("new-candidate")), true, "new built-in candidates may be checked for feed health");
assert.equal(shouldProbeSource(source("healthy", { enabled: true, retrieval_status: "healthy" })), true);
assert.equal(shouldProbeSource(source("manually-disabled", { enabled: false, retrieval_status: "healthy" })), false);
assert.equal(shouldProbeSource(source("degraded-retry", { enabled: false, retrieval_status: "degraded" })), true, "a later research run should retry a previously degraded feed");
assert.equal(shouldProbeSource(source("failing-retry", { enabled: false, retrieval_status: "failing" })), true, "a later research run should retry a previously failing feed");
assert.equal(shouldProbeSource(source("manually-disabled-failing", { enabled: false, retrieval_status: "failing", reliability_note: "tier:reporting; manually disabled by editor" })), false, "manual source disablement must not be overridden by retry logic");
assert.equal(shouldProbeSource(source("retired", { enabled: false, retrieval_status: "disabled" })), false);
assert.equal(shouldProbeSource(source("unreviewed-custom", { reliability_note: "new source", retrieval_status: "untested" })), false);
assert.equal(shouldProbeSource(source("no-feed", { feed_url: null })), false);

assert.equal(canUseSourceForResearch(source("healthy", { enabled: true, retrieval_status: "healthy" })), true);
assert.equal(canUseSourceForResearch(source("candidate")), false);
assert.equal(canUseSourceForResearch(source("failed", { enabled: true, retrieval_status: "failing" })), false);
assert.equal(canUseSourceForResearch(source("retrying", { enabled: false, retrieval_status: "failing" })), false, "retry eligibility is not research eligibility");
assert.equal(canUseSourceForResearch(source("unknown", { enabled: undefined, retrieval_status: undefined })), false);

const ids = eligibleResearchSourceIds([
  source("active-a", { enabled: true, retrieval_status: "healthy" }),
  source("active-b", { enabled: true, retrieval_status: "healthy" }),
  source("disabled", { enabled: false, retrieval_status: "healthy" }),
  source("degraded", { enabled: false, retrieval_status: "degraded" }),
]);
assert.deepEqual([...ids].sort(), ["active-a", "active-b"]);
console.log("PASS: only healthy, enabled sources enter clustering and scoring; fresh built-in candidates are probed separately.");

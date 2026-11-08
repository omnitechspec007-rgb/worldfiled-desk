import assert from "node:assert/strict";
import { buildResearchReport } from "../netlify/lib/research-report.mts";

const complete = buildResearchReport({
  total: 2,
  finished: 2,
  results: {
    a: { name: "Alpha News", status: "healthy", items: 4, newItems: 2, refreshedItems: 2 },
    b: { name: "Beta News", status: "healthy", items: 3, newItems: 3, refreshedItems: 0 },
  },
});
assert.equal(complete.coverage, "complete");
assert.equal(complete.reachable, 2);
assert.equal(complete.items, 7);
assert.equal(complete.newItems, 5);
assert.equal(complete.refreshedItems, 2);
assert.match(complete.note, /does not mean every news source/);

const limited = buildResearchReport({
  total: 3,
  finished: 3,
  results: {
    a: { name: "Alpha", status: "healthy", items: 1 },
    b: { name: "Beta", status: "failing", error: "timeout" },
    c: { name: "Gamma", status: "blocked", policy: "metadata_only" },
  },
});
assert.equal(limited.coverage, "limited");
assert.equal(limited.needsAttention, 1);
assert.equal(limited.policyBlocked, 1);
assert.match(limited.note, /limited coverage/);

const incomplete = buildResearchReport({
  total: 5,
  finished: 2,
  results: {
    a: { name: "Alpha", status: "healthy" },
    b: { name: "Beta", status: "degraded", error: "No fresh items" },
  },
});
assert.equal(incomplete.coverage, "incomplete");
assert.equal(incomplete.checked, 2);
assert.match(incomplete.note, /incomplete/);

const empty = buildResearchReport();
assert.equal(empty.coverage, "complete");
assert.equal(empty.total, 0);

console.log("Research report tests passed.");

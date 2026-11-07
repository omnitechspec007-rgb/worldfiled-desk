import { summarizeSourceIndependence } from "../netlify/lib/source-independence.mts";

let pass = 0, fail = 0;
const check = (name: string, value: boolean) => {
  console.log((value ? "PASS " : "FAIL ") + name);
  value ? pass++ : fail++;
};

const independent = summarizeSourceIndependence([
  { outlet: "North News", ownershipStatus: "verified", publisherGroupKey: "group-north", originStatus: "verified", originType: "original_reporting" },
  { outlet: "South Journal", ownershipStatus: "verified", publisherGroupKey: "group-south", originStatus: "verified", originType: "original_reporting" },
]);
check("two verified publisher groups with verified original reporting count as independent origins", independent.status === "confirmed_independent" && independent.confirmedIndependentOrigins === 2);

const sameOwner = summarizeSourceIndependence([
  { outlet: "North News", ownershipStatus: "verified", publisherGroupKey: "group-one", originStatus: "verified", originType: "original_reporting" },
  { outlet: "North Daily", ownershipStatus: "verified", publisherGroupKey: "group-one", originStatus: "verified", originType: "original_reporting" },
]);
check("two outlets in one verified ownership group do not count as independent", sameOwner.namedOutlets === 2 && sameOwner.confirmedIndependentOrigins === 1 && sameOwner.status === "unknown");

const wire = summarizeSourceIndependence([
  { outlet: "North News", ownershipStatus: "verified", publisherGroupKey: "group-one", originStatus: "verified", originType: "wire_copy", upstreamSourceRegistryId: "wire-registry" },
  { outlet: "South Journal", ownershipStatus: "verified", publisherGroupKey: "group-two", originStatus: "verified", originType: "syndicated", upstreamSourceRegistryId: "wire-registry" },
]);
check("verified wire and syndicated copies are not counted as independent original reporting", wire.confirmedIndependentOrigins === 0 && wire.confirmedSharedOrigins === 1 && wire.status === "known_shared_origin");

const unknown = summarizeSourceIndependence([
  { outlet: "North News", ownershipStatus: "unverified", publisherGroupKey: null, originStatus: "unverified", originType: "unknown" },
  { outlet: "South Journal", ownershipStatus: "unverified", publisherGroupKey: null, originStatus: "unverified", originType: "unknown" },
]);
check("unknown ownership and lineage remain unknown rather than being assumed independent", unknown.status === "unknown" && unknown.confirmedIndependentOrigins === 0);

const partial = summarizeSourceIndependence([
  { outlet: "North News", ownershipStatus: "verified", publisherGroupKey: "group-north", originStatus: "verified", originType: "original_reporting" },
  { outlet: "South Journal", ownershipStatus: "unverified", originStatus: "unverified", originType: "unknown" },
]);
check("one confirmed origin plus unknown source remains partially verified", partial.status === "partially_verified");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;

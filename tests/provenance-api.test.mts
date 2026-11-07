import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import provenance from "../netlify/functions/provenance.mts";

process.env.SESSION_SECRET = "provenance-test-secret-".padEnd(40, "x");
process.env.EDITOR_PASSPHRASE = "test editor";
process.env.SUPABASE_URL = "https://worldfiled-test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";

const expiry = String(Math.floor(Date.now() / 1000) + 3600);
const signature = createHmac("sha256", process.env.SESSION_SECRET).update(expiry).digest("base64url");
const cookie = `wf_session=${expiry}.${signature}`;

const originalFetch = globalThis.fetch;
const requests: string[] = [];
const rpcBodies: any[] = [];
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  requests.push(url);
  const path = new URL(url).pathname;
  if (path.startsWith("/rest/v1/rpc/")) {
    const payload = JSON.parse(String(init?.body ?? "{}"));
    rpcBodies.push({ path, payload });
    const isCreate = path.endsWith("create_publication_relationship_candidate");
    const isLineage = path.endsWith("review_article_lineage");
      return new Response(JSON.stringify({
      status: isCreate ? 201 : 200,
      body: isCreate
        ? { relationshipId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", relationshipType: "same_owner", reviewStatus: "unverified", provenanceRevision: 1 }
        : isLineage
          ? { lineageId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", originType: payload.p_origin_type, reviewStatus: payload.p_review_status, provenanceRevision: 2 }
          : isPolicy
            ? { sourceId: payload.p_source_id, policy: payload.p_policy, provenanceRevision: 3 }
            : { relationshipId: payload.p_relationship_id, reviewStatus: payload.p_review_status, provenanceRevision: 2 },
      replayed: false,
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  const data: Record<string, unknown[]> = {
    "/rest/v1/source_registry": [{
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Example News", publisher: "Example Media",
      country_scope: "UK", category: "news", feed_url: "https://example.test/feed.xml",
      source_type: "feed", retrieval_status: "healthy", last_checked_at: null, last_success_at: null, last_error: null,
    }],
    "/rest/v1/source_content_policies": [],
    "/rest/v1/publication_relationships": [],
    "/rest/v1/article_lineage": [],
    "/rest/v1/source_provenance_state": [{ revision: 0, updated_at: "2026-11-07T00:00:00Z" }],
  };
  if (!(path in data)) return new Response(JSON.stringify({ message: "unexpected request" }), { status: 404 });
  return new Response(JSON.stringify(data[path]), { status: 200, headers: { "content-type": "application/json" } });
};

try {
  const unauthenticated = await provenance(new Request("https://desk.test/.netlify/functions/provenance"));
  assert.equal(unauthenticated.status, 401);

  const response = await provenance(new Request("https://desk.test/.netlify/functions/provenance", { headers: { cookie } }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json() as any;
  assert.equal(body.totals.sources, 1);
  assert.equal(body.totals.relationships, 0);
  assert.equal(body.totals.lineage, 0);
  assert.equal(body.revision, 0);
  assert.equal(body.sources[0].contentPolicy.policy, "metadata_only");
  assert.equal(body.sources[0].contentPolicy.reviewed_at, null);
  assert(requests.every((url) => url.startsWith("https://worldfiled-test.supabase.co/rest/v1/")));

  const originMismatch = await provenance(new Request("https://desk.test/.netlify/functions/provenance", {
    method: "POST", headers: { cookie, origin: "https://attacker.test", "content-type": "application/json" },
    body: JSON.stringify({}),
  }));
  assert.equal(originMismatch.status, 403, "cross-origin mutations are rejected");

  const candidateBody = {
    action: "create_relationship_candidate",
    sourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    relatedSourceId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    relationshipType: "same_owner",
    evidenceUrl: "https://example.org/ownership",
    reviewNotes: "Both publisher disclosures identify the same parent.",
  };
  const candidateKey = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const candidateResponse = await provenance(new Request("https://desk.test/.netlify/functions/provenance", {
    method: "POST",
    headers: { cookie, origin: "https://desk.test", "content-type": "application/json", "idempotency-key": candidateKey },
    body: JSON.stringify(candidateBody),
  }));
  assert.equal(candidateResponse.status, 201);
  const candidateResult = await candidateResponse.json() as any;
  assert.equal(candidateResult.reviewStatus, "unverified");
  assert.equal(candidateResult.replayed, false);
  assert.equal(rpcBodies.length, 1);
  assert.equal(rpcBodies[0].p_idempotency_key, candidateKey);
  assert.equal(rpcBodies[0].p_source_id, candidateBody.sourceId);
  assert.equal(rpcBodies[0].p_relationship_type, "same_owner");
  assert.match(rpcBodies[0].p_request_hash, /^[0-9a-f]{64}$/);


  const reviewResponse = await provenance(new Request("https://desk.test/.netlify/functions/provenance", {
    method: "POST",
    headers: { cookie, origin: "https://desk.test", "content-type": "application/json", "idempotency-key": "ffffffff-ffff-4fff-8fff-ffffffffffff" },
    body: JSON.stringify({
      action: "review_relationship", relationshipId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      reviewStatus: "verified", evidenceUrl: "https://example.org/ownership-proof", reviewNotes: "Corporate filing identifies the shared parent.",
    }),
  }));
  assert.equal(reviewResponse.status, 200);
  assert.equal(rpcBodies[1].path, "https://worldfiled-test.supabase.co/rest/v1/rpc/review_publication_relationship");
  assert.equal(rpcBodies[1].payload.p_review_status, "verified");

  const lineageResponse = await provenance(new Request("https://desk.test/.netlify/functions/provenance", {
    method: "POST",
    headers: { cookie, origin: "https://desk.test", "content-type": "application/json", "idempotency-key": "11111111-1111-4111-8111-111111111111" },
    body: JSON.stringify({
      action: "review_article_lineage", lineageId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      originType: "syndicated", reviewStatus: "verified", upstreamSourceRegistryId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      upstreamUrl: "https://wire.example.org/story", evidenceUrl: "https://example.org/republication", reviewNotes: "The article credits the wire service.",
    }),
  }));
  assert.equal(lineageResponse.status, 200);
  assert.equal(rpcBodies[2].path, "https://worldfiled-test.supabase.co/rest/v1/rpc/review_article_lineage");
  assert.equal(rpcBodies[2].payload.p_origin_type, "syndicated");
  assert.equal(rpcBodies[2].payload.p_upstream_source_registry_id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

  const noBasis = await provenance(new Request("https://desk.test/.netlify/functions/provenance", {
    method: "POST",
    headers: { cookie, origin: "https://desk.test", "content-type": "application/json", "idempotency-key": candidateKey },
    body: JSON.stringify({ ...candidateBody, evidenceUrl: "", reviewNotes: "" }),
  }));
  assert.equal(noBasis.status, 400, "candidate requires an evidence URL or written rationale");

  console.log("PASS authenticated provenance read, metadata-only default, no-store, candidate creation and evidence-backed review RPC contracts");
} finally {
  globalThis.fetch = originalFetch;
}

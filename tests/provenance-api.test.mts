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
globalThis.fetch = async (input: RequestInfo | URL) => {
  const url = String(input);
  requests.push(url);
  const path = new URL(url).pathname;
  const data: Record<string, unknown[]> = {
    "/rest/v1/source_registry": [{
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Example News", publisher: "Example Media",
      country_scope: "UK", category: "news", feed_url: "https://example.test/feed.xml",
      source_type: "rss", retrieval_status: "healthy", last_checked_at: null, last_success_at: null, last_error: null,
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

  const response = await provenance(new Request("https://desk.test/.netlify/functions/provenance", {
    headers: { cookie },
  }));
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
  console.log("PASS authenticated provenance read, metadata-only default, revision and no-store response");
} finally {
  globalThis.fetch = originalFetch;
}

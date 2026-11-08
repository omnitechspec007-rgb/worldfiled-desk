import assert from "node:assert/strict";

process.env.EDITOR_PASSPHRASE = "blue lantern river 42";
process.env.SESSION_SECRET = "z".repeat(40);
process.env.SUPABASE_URL = "https://abc.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test";

const root = new URL("../netlify/", import.meta.url).pathname;
const session = await import(`${root}lib/session.mts`);
const handler = (await import(`${root}functions/publications.mts`)).default;
const cookie = session.makeSessionCookie().split(";")[0];
const editionId = "11111111-1111-4111-8111-111111111111";
const storyIds = ["22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
const publicationId = "44444444-4444-4444-8444-444444444444";
const { membersKey } = await import(`${root}lib/editions.mts`);
const tables: Record<string, any[]> = {
  editions: [{ id: editionId, title: "Test edition", edition_kind: "video", theme: "World", status: "draft" }],
  edition_developments: storyIds.map((story_id, i) => ({ edition_id: editionId, story_id, position: i + 1 })),
  edition_decisions: [{ edition_id: editionId, decision: "approved", members_hash: membersKey(storyIds), created_at: "2026-11-08T10:00:00Z" }],
  stories: storyIds.map((id, i) => ({ id, headline: "Verified story " + i, verification_status: "verified", editorial_status: "approved" })),
  publication_records: [], publication_story_attributions: [], performance_snapshots: [], audit_events: [],
};
let publicationSequence = 0;
const match = (row: any, params: URLSearchParams) => {
  for (const [key, value] of params) {
    if (["select", "order", "limit"].includes(key)) continue;
    if (value.startsWith("eq.") && String(row[key]) !== value.slice(3)) return false;
    if (value.startsWith("in.(") && !value.slice(4, -1).split(",").includes(String(row[key]))) return false;
  }
  return true;
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input: any, init: any = {}) => {
  const url = new URL(String(input));
  const table = url.pathname.split("/rest/v1/")[1];
  const rows = tables[table] ?? (tables[table] = []);
  const method = init.method ?? "GET";
  if (method === "GET") {
    let found = rows.filter((row) => match(row, url.searchParams));
    const order = url.searchParams.get("order");
    if (order) {
      const [field, direction] = order.split(",")[0].split(".");
      found = [...found].sort((a, b) => String(a[field] ?? "").localeCompare(String(b[field] ?? "")) * (direction === "desc" ? -1 : 1));
    }
    const limit = Number(url.searchParams.get("limit") ?? 0);
    if (limit) found = found.slice(0, limit);
    return new Response(JSON.stringify(found), { status: 200 });
  }
  if (method === "POST") {
    const parsed = JSON.parse(init.body);
    const incoming = Array.isArray(parsed) ? parsed : [parsed];
    const created = incoming.map((row) => {
      const value = table === "publication_records" ? { ...row, id: publicationId, created_at: new Date().toISOString() }
        : table === "performance_snapshots" ? { ...row, id: "55555555-5555-4555-8555-555555555555" }
        : { ...row };
      rows.push(value);
      return value;
    });
    return new Response((init.headers?.Prefer ?? "").includes("return=representation") ? JSON.stringify(created) : null, { status: 201 });
  }
  if (method === "DELETE") {
    tables[table] = rows.filter((row) => !match(row, url.searchParams));
    return new Response(null, { status: 204 });
  }
  return new Response("{}", { status: 200 });
};

const request = (method: string, body?: unknown) => new Request("https://abc.supabase.co/.netlify/functions/publications", {
  method, headers: { cookie, ...(method === "POST" ? { origin: "https://abc.supabase.co", "content-type": "application/json" } : {}), ...(body ? {} : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});
try {
  const listed = await handler(request("GET"));
  const listJson = await listed.json();
  assert.equal(listJson.eligibleEditions.length, 1, "only current approved and verified editions are eligible");

  const created = await handler(request("POST", {
    action: "record_publication", editionId, platform: "youtube", contentFormat: "narrated_video",
    publishedAt: "2026-11-08T12:00:00.000Z", postUrl: "https://youtube.com/watch?v=example",
  }));
  assert.equal(created.status, 200);
  assert.equal((await created.json()).storyCount, 2);
  assert.equal(tables.publication_story_attributions.length, 2, "publication inherits exact edition story membership");

  const snapshot = await handler(request("POST", {
    action: "record_snapshot", publicationId, views: 1000, completionRate: 65.5, shares: 20, saves: 12,
    averageViewDurationSeconds: 31.2, sourceNote: "YouTube Studio at 24 hours",
  }));
  assert.equal(snapshot.status, 200);
  assert.equal(tables.performance_snapshots[0].completion_rate, 0.655);
  assert.equal(tables.performance_snapshots[0].views, 1000);

  const invalid = await handler(request("POST", {
    action: "record_snapshot", publicationId, views: 1.5,
  }));
  assert.equal(invalid.status, 400, "count metrics must be whole numbers");

  tables.edition_decisions[0].members_hash = "stale-approval";
  const blocked = await handler(request("POST", {
    action: "record_publication", editionId, platform: "facebook", contentFormat: "text_card",
  }));
  assert.equal(blocked.status, 409, "stale edition approval blocks publication logging");
  assert.equal(tables.publication_records.length, 1, "blocked attempt does not create a record");
  console.log("PASS publication log enforces current approval, preserves story attribution and validates snapshots");
} finally {
  globalThis.fetch = originalFetch;
}

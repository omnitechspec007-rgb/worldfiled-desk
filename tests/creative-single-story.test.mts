import assert from "node:assert/strict";

process.env.EDITOR_PASSPHRASE = "blue lantern river 42";
process.env.SESSION_SECRET = "z".repeat(40);
process.env.SUPABASE_URL = "https://abc.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test";

const root = new URL("../netlify/", import.meta.url).pathname;
const session = await import(root + "lib/session.mts");
const handler = (await import(root + "functions/creative.mts")).default;
const cookie = session.makeSessionCookie().split(";")[0];
const storyId = "11111111-1111-4111-8111-111111111111";
const decisionId = "22222222-2222-4222-8222-222222222222";
const sourceId = "33333333-3333-4333-8333-333333333333";
const promptId = "44444444-4444-4444-8444-444444444444";
const registry = { id: "55555555-5555-4555-8555-555555555555", name: "Test Official Record", country_scope: "Africa · Nigeria", reliability_note: "tier:primary", enabled: true, retrieval_status: "healthy" };
const stories: any[] = [{ id: storyId, headline: "Nigeria publishes a new fiscal report", category: "Government and institutional decisions", created_at: new Date().toISOString(), verification_status: "in_progress" }];
const sources: any[] = [{ id: sourceId, registry_id: registry.id, title: "Official fiscal report", url: "https://example.test/report", published_at: new Date().toISOString(), retrieved_at: new Date().toISOString(), content_status: "metadata_only", extract: "The ministry published its fiscal report.", source_registry: registry }];
const links = [{ story_id: storyId, source_id: sourceId }];
const decisions: any[] = [{ id: decisionId, story_id: storyId, decision: "approved", notes: "Cleared for drafting only", created_at: new Date().toISOString() }];
const prompts: any[] = [];
const audits: any[] = [];
let claimText = "The ministry published its fiscal report.";
const claimRow = () => ({
  id: "claim-1", story_id: storyId, claim_text: claimText,
  claim_evidence: [{ id: "evidence-1", source_id: sourceId, passage: "The report was published on the ministry website.", passage_location: "opening paragraph", extraction_status: "extracted", is_contradiction: false, created_at: new Date(Date.parse(stories[0].created_at) - 60_000).toISOString(), retrieved_sources: { ...sources[0], source_registry: registry } }],
  verification_results: [{ id: "verification-1", outcome: "SUPPORTED", reviewer_notes: "Checked against the official report.", created_at: stories[0].created_at }],
});
function matches(row: any, params: URLSearchParams) {
  for (const [key, value] of params) {
    if (["select", "order", "limit", "on_conflict"].includes(key)) continue;
    if (value.startsWith("eq.")) { if (String(row[key]) !== value.slice(3)) return false; }
    else if (value.startsWith("in.(")) { if (!value.slice(4, -1).split(",").includes(String(row[key]))) return false; }
  }
  return true;
}
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = new URL(String(input));
  if (url.hostname !== "abc.supabase.co") throw new Error("unexpected request " + url);
  const table = url.pathname.split("/rest/v1/")[1];
  const method = init.method ?? "GET";
  const params = url.searchParams;
  if (method === "GET") {
    if (table === "style_rules") return new Response("{}", { status: 404 });
    if (table === "source_content_policies") return new Response(JSON.stringify([{ source_id: registry.id, policy: "extraction_allowed" }]), { status: 200 });
    if (table === "stories") {
      const selected = stories.filter((row) => matches(row, params));
      const expanded = params.get("select")?.includes("story_source_links(");
      const output = expanded ? selected.map((row) => ({
        ...row,
        story_source_links: links.filter((link) => link.story_id === row.id).map((link) => {
          const src = sources.find((item) => item.id === link.source_id);
          return { retrieved_sources: src ? { ...src, source_registry: registry } : null };
        }),
      })) : selected.map((row) => ({ id: row.id, verification_status: row.verification_status }));
      return new Response(JSON.stringify(output), { status: 200 });
    }
    if (table === "claims") {
      const selected = stories.filter((row) => matches({ story_id: row.id }, params));
      return new Response(JSON.stringify(selected.map(() => claimRow())), { status: 200 });
    }
    if (table === "editorial_decisions") {
      const selected = decisions.filter((row) => matches(row, params)).sort((a, b) => b.created_at.localeCompare(a.created_at));
      return new Response(JSON.stringify(selected.slice(0, Number(params.get("limit") ?? selected.length))), { status: 200 });
    }
    if (table === "creative_prompts") {
      return new Response(JSON.stringify(prompts.filter((row) => matches(row, params))), { status: 200 });
    }
    return new Response("[]", { status: 200 });
  }
  if (method === "POST" && table === "creative_prompts") {
    const body = JSON.parse(init.body);
    const row = { id: promptId, created_at: new Date().toISOString(), ...body, approval_decision_id: decisions.at(-1).id };
    prompts.push(row);
    return new Response(JSON.stringify([row]), { status: 201 });
  }
  if (method === "POST" && table === "audit_events") {
    audits.push(JSON.parse(init.body));
    return new Response(null, { status: 201 });
  }
  return new Response("{}", { status: 200 });
}) as any;

const request = (method: "GET" | "POST", body?: unknown, query = "") => handler(new Request("https://desk.example/.netlify/functions/creative" + query, {
  method,
  headers: { cookie, ...(method === "POST" ? { origin: "https://desk.example", "content-type": "application/json" } : {}) },
  ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
}));

const blockedPreview = await request("GET", undefined, "?storyId=" + storyId);
assert.equal(blockedPreview.status, 409);
assert.equal((await blockedPreview.json()).error, "verification_blocked");
const blockedGenerate = await request("POST", { storyId, deliverable: "script_storyboard", durationSeconds: 60 });
assert.equal(blockedGenerate.status, 409);
assert.equal((await blockedGenerate.json()).error, "verification_blocked");
assert.equal(prompts.length, 0);
assert.equal(audits.length, 0);
console.log("PASS: story-level Editorial Review approval alone cannot produce a news prompt while claims remain unverified.");

stories[0].verification_status = "verified";
const preview = await request("GET", undefined, "?storyId=" + storyId);
assert.equal(preview.status, 200);
const generated = await request("POST", { storyId, deliverable: "script_storyboard", durationSeconds: 60 });
assert.equal(generated.status, 200);
const generatedBody = await generated.json();
assert.equal(generatedBody.saved, true);
assert.equal(prompts.length, 1);
assert.equal(audits.length, 1);
assert.match(generatedBody.prompt, /CURRENT HUMAN CLAIM-VERIFICATION REGISTER/);
assert.match(generatedBody.prompt, /The ministry published its fiscal report/);
assert.match(generatedBody.prompt, /The report was published on the ministry website/);
assert.match(generatedBody.prompt, /only entries in the CURRENT HUMAN CLAIM-VERIFICATION REGISTER/i);
console.log("PASS: a single-story production prompt is available only after claim-register clearance and human editorial approval.");
console.log("PASS: it carries the exact current-supported claim statement and extracted passage, not only the research snippet.");

// Altering the registered statement must invalidate the saved prompt, even if its URL is unchanged.
claimText = "The ministry released a revised fiscal report.";
const changedClaim = await request("GET", undefined, "?id=" + promptId);
const changedClaimBody = await changedClaim.json();
assert.equal(changedClaimBody.prompt, null);
assert.equal(changedClaimBody.evidenceCurrent, false);
assert.match(changedClaimBody.withheld, /source snapshot or verified claim register changed/i);
assert.equal(prompts.length, 1, "stale prompt remains in history rather than being deleted");
console.log("PASS: a changed verified claim statement invalidates the saved single-story prompt.");

stories[0].verification_status = "in_progress";
const stale = await request("GET", undefined, "?id=" + promptId);
const staleBody = await stale.json();
assert.equal(staleBody.prompt, null);
assert.equal(staleBody.factualClearanceCurrent, false);
assert.match(staleBody.withheld, /no longer has current factual clearance/i);
console.log("PASS: saved single-story prompts are withheld when factual clearance later becomes stale.");

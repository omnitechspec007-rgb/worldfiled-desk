import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
process.env.EDITOR_PASSPHRASE = "blue lantern river 42";
process.env.SESSION_SECRET = "z".repeat(40);
process.env.SUPABASE_URL = "https://abc.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test";
const root = new URL("../netlify/", import.meta.url).pathname;
const { makeSessionCookie } = await import(root + "lib/session.mts");
const handler = (await import(root + "functions/decide.mts")).default;
const cookie = makeSessionCookie().split(";")[0];
const storyId = "11111111-1111-4111-8111-111111111111";
const key = randomUUID();
let calls = 0;
let rpcCalls = 0;
let verificationStatus = "unverified";
let rpcBody: any = null;
globalThis.fetch = (async (input: any, init: any) => {
  calls++;
  const url = String(input);
  if (url.includes("/rest/v1/stories?")) {
    return new Response(JSON.stringify([{ id: storyId, verification_status: verificationStatus }]), { status: 200 });
  }
  rpcCalls++;
  assert.match(url, /\/rest\/v1\/rpc\/record_story_editorial_decision$/);
  rpcBody = JSON.parse(init.body);
  return new Response(JSON.stringify({ status: 200, body: { ok: true, status: "approved" }, replayed: true }), { status: 200 });
}) as any;
const call = (idempotencyKey?: string) => handler(new Request("https://desk.example/.netlify/functions/decide", {
  method: "POST",
  headers: { origin: "https://desk.example", cookie, "content-type": "application/json", ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) },
  body: JSON.stringify({ storyId, decision: "approved", notes: "Reviewed sources", acknowledged: true }),
}));
const missing = await call();
assert.equal(missing.status, 400);
assert.equal(calls, 0, "missing key must be rejected before database access");
const invalid = await call("not-a-uuid");
assert.equal(invalid.status, 400);
assert.equal(calls, 0, "invalid key must be rejected before database access");
const blocked = await call(key);
assert.equal(blocked.status, 409);
assert.equal((await blocked.json()).error, "verification_incomplete");
assert.equal(rpcCalls, 0, "unverified stories must not reach the editorial decision RPC");
verificationStatus = "verified";
const response = await call(key);
assert.equal(response.status, 200);
const result = await response.json();
assert.equal(result.replayed, true);
assert.equal(rpcCalls, 1, "verified story approval should perform one RPC");
assert.equal(calls, 3, "the unverified check, verified check and RPC are explicit database operations");
assert.equal(rpcBody.p_idempotency_key, key);
assert.equal(rpcBody.p_story_id, storyId);
assert.equal(rpcBody.p_decision, "approved");
assert.equal(rpcBody.p_request_hash, createHash("sha256").update(JSON.stringify({ storyId, decision: "approved", notes: "Reviewed sources", acknowledged: true })).digest("hex"));
console.log("PASS: missing and malformed idempotency keys are rejected before database access.");
console.log("PASS: valid story decisions call the atomic RPC with a canonical SHA-256 payload hash.");
console.log("PASS: a replayed server result is exposed clearly to the editor.");

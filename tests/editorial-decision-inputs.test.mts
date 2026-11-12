import assert from "node:assert/strict";
process.env.EDITOR_PASSPHRASE = "blue lantern river 42";
process.env.SESSION_SECRET = "z".repeat(40);
process.env.SUPABASE_URL = "https://abc.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test";
const root = new URL("../netlify/", import.meta.url).pathname;
const { makeSessionCookie } = await import(root + "lib/session.mts");
const handler = (await import(root + "functions/decide.mts")).default;
const cookie = makeSessionCookie().split(";")[0];
let databaseCalls = 0;
let databaseStatus = 200;
globalThis.fetch = (async () => { databaseCalls++; return new Response("{}", { status: databaseStatus }); }) as any;
const storyId = "11111111-1111-4111-8111-111111111111";
const call = (body: unknown, origin = "https://desk.example") => handler(new Request("https://desk.example/.netlify/functions/decide", {
  method: "POST",
  headers: { origin, cookie, "content-type": "application/json", "idempotency-key": "22222222-2222-4222-8222-222222222222" },
  body: JSON.stringify(body),
}));
const longNotes = await call({ storyId, decision: "needs_research", notes: "x".repeat(1001) });
assert.equal(longNotes.status, 400);
assert.equal((await longNotes.json()).error, "field_too_long");
assert.equal(databaseCalls, 0, "overlong notes must be rejected before any database mutation");
const wrongType = await call({ storyId, decision: "needs_research", notes: 123 });
assert.equal(wrongType.status, 400);
assert.equal((await wrongType.json()).error, "bad_notes");
assert.equal(databaseCalls, 0);
const nullBody = await call(null);
assert.equal(nullBody.status, 400);
assert.equal(databaseCalls, 0, "null JSON bodies must be rejected before database access");
for (const decision of ["__proto__", "constructor", "toString"]) {
  const prototypeDecision = await call({ storyId, decision });
  assert.equal(prototypeDecision.status, 400, decision + " must not be accepted as an editorial decision");
}
assert.equal(databaseCalls, 0, "prototype property names must never reach the database");
const wrongOrigin = await call({ storyId, decision: "needs_research" }, "https://attacker.invalid");
assert.equal(wrongOrigin.status, 403);
assert.equal(databaseCalls, 0);

// A missing RPC is a definite setup failure, not an ambiguous write outcome.
databaseStatus = 404;
const missingMigration = await call({ storyId, decision: "approved", acknowledged: true });
assert.equal(missingMigration.status, 503);
const missingBody = await missingMigration.json();
assert.equal(missingBody.error, "editorial_setup_required");
assert.equal(missingBody.outcome, "not_saved");
assert.equal(missingBody.retryWithSameKey, true);

// A database 5xx may have an ambiguous commit outcome and must retain safe same-key retry.
databaseStatus = 500;
const uncertainWrite = await call({ storyId, decision: "approved", acknowledged: true });
assert.equal(uncertainWrite.status, 502);
const uncertainBody = await uncertainWrite.json();
assert.equal(uncertainBody.outcome, "unknown");
assert.equal(uncertainBody.retryWithSameKey, true);

console.log("PASS: missing editorial RPC is reported as a definite setup failure, not an uncertain save.");
console.log("PASS: database 5xx failures retain an explicit unknown outcome and same-key retry.");
console.log("PASS: story decision notes reject overlong and non-string values without truncation or database writes.");
console.log("PASS: hostile origin is rejected before database access.");
console.log("PASS: null bodies and prototype property names are rejected safely.");

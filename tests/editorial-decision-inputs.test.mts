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
globalThis.fetch = (async () => { databaseCalls++; return new Response("[]", { status: 200 }); }) as any;
const storyId = "11111111-1111-4111-8111-111111111111";
const call = (body: unknown, origin = "https://desk.example") => handler(new Request("https://desk.example/.netlify/functions/decide", {
  method: "POST",
  headers: { origin, cookie, "content-type": "application/json" },
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
const wrongOrigin = await call({ storyId, decision: "needs_research" }, "https://attacker.invalid");
assert.equal(wrongOrigin.status, 403);
assert.equal(databaseCalls, 0);
console.log("PASS: story decision notes reject overlong and non-string values without truncation or database writes.");
console.log("PASS: hostile origin is rejected before database access.");

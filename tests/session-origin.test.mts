import assert from "node:assert/strict";
import { hasSameOrigin } from "../netlify/lib/session.mts";

const request = (url: string, origin: string | null) => new Request(url, {
  method: "POST",
  headers: origin === null ? {} : { origin },
});

assert.equal(hasSameOrigin(request("https://desk.example/.netlify/functions/decide", "https://desk.example")), true);
assert.equal(hasSameOrigin(request("https://desk.example/api/write", "https://evil.example")), false);
assert.equal(hasSameOrigin(request("https://desk.example/api/write", null)), false);
assert.equal(hasSameOrigin(request("https://desk.example/api/write", "http://desk.example")), false);
assert.equal(hasSameOrigin(request("https://desk.example/api/write", "https://desk.example:444")), false);
assert.equal(hasSameOrigin(request("https://desk.example/api/write", "not a URL")), false);
assert.equal(hasSameOrigin(request("https://desk.example/api/write", "https://desk.example.attacker.invalid")), false);

console.log("PASS: same-origin validation rejects missing, malformed, insecure and cross-origin requests.");

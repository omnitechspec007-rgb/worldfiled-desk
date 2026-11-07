import assert from "node:assert/strict";
import provenance from "../netlify/functions/provenance.mts";

const unauthorized = await provenance(new Request("https://worldfiled.test/.netlify/functions/provenance"));
assert.equal(unauthorized.status, 401);
assert.equal((await unauthorized.json()).error, "unauthorized");

const method = await provenance(new Request("https://worldfiled.test/.netlify/functions/provenance", { method: "POST" }));
assert.equal(method.status, 401, "authentication is checked before method handling");

console.log("PASS provenance explorer refuses unauthenticated reads and writes");

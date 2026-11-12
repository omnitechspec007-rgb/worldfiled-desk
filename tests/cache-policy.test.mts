import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../netlify/functions/", import.meta.url);
const files = readdirSync(root).filter((name) => name.endsWith(".mts"));
assert.ok(files.length > 0, "Expected Netlify API route files");
const missing = files.filter((name) => {
  const source = readFileSync(join(root.pathname, name), "utf8");
  return !/["']Cache-Control["']\s*:\s*["']no-store["']/.test(source);
});
assert.deepEqual(missing, [], "Every API route must explicitly disable caching of responses");
console.log(`PASS: all ${files.length} Netlify API routes declare Cache-Control: no-store.`);

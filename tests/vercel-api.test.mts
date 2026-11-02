// Vercel hosting: the api/*.js functions are generated from the same handlers, and the routing maps the existing URLs.
import assert from "node:assert";
import { readFileSync, readdirSync, existsSync } from "node:fs";

process.env.EDITOR_PASSPHRASE = "blue lantern river 42";
process.env.SESSION_SECRET = "z".repeat(40);
const root = new URL("../", import.meta.url).pathname;
const ok = (m: string) => console.log("PASS " + m);

const { names, bundle } = await import(root + "scripts/build-api.mjs");
for (const n of names) assert.equal(readFileSync(`${root}api/${n}.js`, "utf8"), await bundle(n), `api/${n}.js is stale: run npm run build:api`);
ok(`all ${names.length} api functions are up to date with netlify/functions (run npm run build:api after changing a function)`);
const extra = readdirSync(root + "api").filter((f) => f.endsWith(".js") && !names.includes(f.slice(0, -3)));
assert.deepEqual(extra, []); ok("no stray api files");

const used = new Set<string>();
for (const f of readdirSync(root + "src").filter((x) => x.endsWith(".tsx"))) for (const m of readFileSync(root + "src/" + f, "utf8").matchAll(/\.netlify\/functions\/([a-z-]+)/g)) used.add(m[1]);
for (const u of used) assert(existsSync(`${root}api/${u}.js`), `front end calls ${u} but api/${u}.js is missing`);
ok(`every function the front end calls exists (${[...used].join(", ")})`);

const vj = JSON.parse(readFileSync(root + "vercel.json", "utf8"));
const rw = vj.rewrites as { source: string; destination: string }[];
assert.equal(rw[0].source, "/.netlify/functions/:name"); assert.equal(rw[0].destination, "/api/:name");
assert(rw[1].destination === "/index.html" && /\(\?!api\//.test(rw[1].source)); assert.equal(vj.outputDirectory, "dist");
ok("vercel.json maps the existing /.netlify/functions/* URLs to /api/* and keeps the single-page fallback after it");

// run the generated files on plain Node, exactly as Vercel will call them: default export { fetch }
const auth = (await import(root + "api/auth.js")).default;
const editions = (await import(root + "api/editions.js")).default;
const status = (await import(root + "api/status.js")).default;
assert.equal(typeof auth.fetch, "function");
const me = await (await auth.fetch(new Request("https://x/.netlify/functions/auth"))).json(); assert.equal(me.authenticated, false);
assert.equal((await editions.fetch(new Request("https://x/", { headers: {} }))).status, 401);
assert.equal((await status.fetch(new Request("https://x/"))).status, 401); ok("generated functions load on plain Node and refuse requests without a session");
const bad = await auth.fetch(new Request("https://x/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "login", passphrase: "wrong" }) })); assert.equal(bad.status, 401);
const good = await auth.fetch(new Request("https://x/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "login", passphrase: "blue lantern river 42" }) }));
assert.equal(good.status, 200); const cookie = good.headers.get("set-cookie")!.split(";")[0]; assert(/HttpOnly/.test(good.headers.get("set-cookie")!));
assert.equal((await (await auth.fetch(new Request("https://x/", { headers: { cookie } }))).json()).authenticated, true); ok("sign-in works through the Vercel entry point (wrong passphrase refused, right one sets the HttpOnly cookie)");
console.log("\nAll Vercel hosting checks passed");

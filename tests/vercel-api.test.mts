// Vercel hosting: the api/*.js functions are generated from the same handlers, and the routing maps the existing URLs.
import assert from "node:assert";
import { readFileSync, readdirSync, existsSync } from "node:fs";

process.env.EDITOR_PASSPHRASE = "blue lantern river 42";
process.env.SESSION_SECRET = "z".repeat(40);
const root = new URL("../", import.meta.url).pathname;
const ok = (m: string) => console.log("PASS " + m);

const { names, bundleRouter, ROUTER_FILE } = await import(root + "scripts/build-api.mjs");
assert.equal(readFileSync(root + ROUTER_FILE, "utf8"), await bundleRouter(), `${ROUTER_FILE} is stale: run npm run build:api`);
ok(`the single api function is up to date with netlify/functions (${names.length} routes; run npm run build:api after changing a function)`);
const apiFiles = readdirSync(root + "api"); assert.deepEqual(apiFiles, ["[name].js"]);
assert(apiFiles.length <= 12, "Vercel Hobby allows at most 12 functions"); ok(`only ${apiFiles.length} serverless function is deployed (Hobby plan limit is 12), so adding handlers cannot hit the limit`);

const used = new Set<string>();
for (const f of readdirSync(root + "src").filter((x) => x.endsWith(".tsx"))) for (const m of readFileSync(root + "src/" + f, "utf8").matchAll(/\.netlify\/functions\/([a-z-]+)/g)) used.add(m[1]);
for (const u of used) assert(names.includes(u), `front end calls ${u} but there is no netlify/functions/${u}.mts`);
ok(`every function the front end calls is routed (${[...used].join(", ")})`);

const vj = JSON.parse(readFileSync(root + "vercel.json", "utf8"));
const rw = vj.rewrites as { source: string; destination: string }[];
assert.equal(rw[0].source, "/.netlify/functions/:name"); assert.equal(rw[0].destination, "/api/:name");
assert(rw[1].destination === "/index.html" && /\(\?!api\//.test(rw[1].source)); assert.equal(vj.outputDirectory, "dist");
ok("vercel.json maps the existing /.netlify/functions/* URLs to /api/* and keeps the single-page fallback after it");

// run the generated function on plain Node, exactly as Vercel will call it: default export { fetch }
const router = (await import(root + ROUTER_FILE)).default;
assert.equal(typeof router.fetch, "function");
const call = (path: string, init?: any) => router.fetch(new Request("https://x" + path, init));
const me = await (await call("/.netlify/functions/auth")).json(); assert.equal(me.authenticated, false);
assert.equal((await call("/api/auth")).status, 200); ok("both /api/<name> and /.netlify/functions/<name> reach the handler");
for (const n of names.filter((x) => x !== "auth" && x !== "health")) assert.equal((await call(`/api/${n}`)).status, 401, n + " must refuse requests without a session");
ok(`all ${names.length - 2} protected routes refuse requests without a session`);
assert.equal((await call("/api/nope")).status, 404); assert.equal((await call("/api/__proto__")).status, 404); assert.equal((await call("/api/constructor")).status, 404); ok("unknown routes (including prototype names) return 404");
const q = await call("/api/cycles?preview=1"); assert.equal(q.status, 401); ok("query strings reach the handler");
const auth = { fetch: (r: Request) => router.fetch(new Request("https://x/api/auth", { method: r.method, headers: r.headers, body: r.body, ...(r.method !== "GET" ? { duplex: "half" } : {}) } as any)) };
const bad = await auth.fetch(new Request("https://x/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "login", passphrase: "wrong" }) })); assert.equal(bad.status, 401);
const good = await auth.fetch(new Request("https://x/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "login", passphrase: "blue lantern river 42" }) }));
assert.equal(good.status, 200); const cookie = good.headers.get("set-cookie")!.split(";")[0]; assert(/HttpOnly/.test(good.headers.get("set-cookie")!));
assert.equal((await (await auth.fetch(new Request("https://x/", { headers: { cookie } }))).json()).authenticated, true); ok("sign-in works through the Vercel entry point (wrong passphrase refused, right one sets the HttpOnly cookie)");
console.log("\nAll Vercel hosting checks passed");

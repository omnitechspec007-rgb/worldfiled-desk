import assert from "node:assert";
process.env.EDITOR_PASSPHRASE = "blue lantern river 42";
process.env.SESSION_SECRET = "z".repeat(40);
process.env.SUPABASE_URL = "https://abc.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test";
const root = new URL("../netlify/", import.meta.url).pathname;
const { makeSessionCookie } = await import(root + "lib/session.mts");
const handler = (await import(root + "functions/claim-verification.mts")).default;
const cookie = makeSessionCookie().split(";")[0];
const storyId = "11111111-1111-4111-8111-111111111111";
const sourceId = "22222222-2222-4222-8222-222222222222";
const claims: any[] = [], evidence: any[] = [], decisions: any[] = [];
const stories: any[] = [{ id: storyId, headline: "Test story", verification_status: "unverified", editorial_status: "pending" }];
const sources: any[] = [{ id: sourceId, title: "Primary source", url: "https://example.org/report", publisher: "Example", published_at: new Date().toISOString() }];
const links = [{ story_id: storyId, source_id: sourceId, role: "primary" }];
const response = (x: any, status=200) => new Response(x === null ? null : JSON.stringify(x), { status });
const filter = (rows: any[], p: URLSearchParams) => rows.filter(row => [...p.entries()].every(([k,v]) => ["select","order","on_conflict"].includes(k) || (v.startsWith("eq.") && String(row[k]) === v.slice(3))));
globalThis.fetch = (async (input: any, init: any = {}) => {
  const u = new URL(String(input)), table = u.pathname.split("/rest/v1/")[1], method = init.method || "GET", p = u.searchParams;
  const tableRows: Record<string,any[]> = { stories, claims, claim_evidence:evidence, verification_results:decisions, story_source_links:links, retrieved_sources:sources };
  const rows = tableRows[table] || [];
  if (method === "GET") {
    if (table === "stories") return response(filter(stories,p));
    if (table === "claims") return response(filter(claims,p).map(c=>({...c,claim_evidence:evidence.filter(e=>e.claim_id===c.id).map(e=>({...e,retrieved_sources:sources.find(s=>s.id===e.source_id)})),verification_results:decisions.filter(d=>d.claim_id===c.id)})));
    if (table === "claim_evidence") return response(filter(evidence,p));
    if (table === "verification_results") return response(filter(decisions,p));
    if (table === "story_source_links") return response(filter(links,p).map(l=>({...l,retrieved_sources:sources.find(s=>s.id===l.source_id)})));
    if (table === "retrieved_sources") return response(filter(sources,p));
    return response([]);
  }
  const body = JSON.parse(init.body || "{}");
  if (method === "POST") {
    const row = { id: crypto.randomUUID(), created_at: new Date(Date.now()+Math.random()*1000).toISOString(), ...body };
    rows.push(row);
    return response(init.headers?.Prefer?.includes("return=representation") ? [row] : null, 201);
  }
  if (method === "PATCH") {
    for (const row of filter(rows,p)) Object.assign(row,body);
    return response(null,204);
  }
  return response({},405);
}) as any;
const req = (method:string, body?:any, authenticated=true) => new Request("https://desk.example/?storyId="+storyId,{method,headers:{...(authenticated?{cookie}:{}),...(body?{"content-type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})});
const post = (body:any, auth=true) => handler(req("POST",body,auth));
const get = (auth=true) => handler(req("GET",undefined,auth));
const ok = (s:string) => console.log("PASS "+s);

assert.equal((await get(false)).status,401); assert.equal((await post({action:"add_claim",storyId,claimText:"A valid claim"},false)).status,401); ok("all verification operations require the signed editor session");
assert.equal((await post({action:"add_claim",storyId:"bad",claimText:"A valid claim"})).status,400); ok("invalid story identifiers are rejected");
let r=await post({action:"add_claim",storyId,claimText:"The agency announced the policy on 5 November.",category:"date"}); assert.equal(r.status,200); const claim=(await r.json()).claim; assert(claim.id); assert.equal(stories[0].verification_status,"in_progress"); ok("a material claim is stored and story status moves to in progress");
assert.equal((await post({action:"add_evidence",storyId,claimId:claim.id,sourceId:"33333333-3333-4333-8333-333333333333",passage:"Official text"})).status,400); ok("evidence from a source not linked to the story is rejected");
assert.equal((await post({action:"decide_claim",storyId,claimId:claim.id,outcome:"SUPPORTED"})).status,400); ok("SUPPORTED is refused without an extracted passage");
assert.equal((await post({action:"complete_story",storyId,acknowledged:true})).status,409); ok("story clearance is refused while claims remain unresolved");
r=await post({action:"add_evidence",storyId,claimId:claim.id,sourceId,passage:"The agency announced the policy on 5 November.",location:"Official notice, paragraph 1"}); assert.equal(r.status,200); assert.equal(evidence.length,1); ok("checked passage is attached to a source already linked to the story");
assert.equal((await post({action:"decide_claim",storyId,claimId:claim.id,outcome:"SUPPORTED",notes:"Confirmed against the official notice."})).status,200); ok("editor decision is appended to verification history");
assert.equal((await post({action:"complete_story",storyId,acknowledged:false})).status,400); assert.equal(stories[0].verification_status,"in_progress"); ok("clearance requires explicit completeness acknowledgement");
r=await post({action:"complete_story",storyId,acknowledged:true}); assert.equal(r.status,200); assert.equal(stories[0].verification_status,"verified"); ok("story becomes verified only after every recorded claim has a passage and supported editor decision");
assert.equal((await post({action:"add_evidence",storyId,claimId:claim.id,sourceId,passage:"A newly checked passage."})).status,200); assert.equal(stories[0].verification_status,"in_progress"); ok("adding or changing evidence invalidates prior story-level clearance");
console.log("\nALL CLAIM VERIFICATION API CHECKS PASSED");

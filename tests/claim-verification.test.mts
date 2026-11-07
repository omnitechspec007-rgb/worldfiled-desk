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
const idempotency = new Map<string,any>();
const auditEvents: any[] = [];
let testClock = Date.now();
const response = (x: any, status=200) => new Response(x === null ? null : JSON.stringify(x), { status });
const filter = (rows: any[], p: URLSearchParams) => rows.filter(row => [...p.entries()].every(([k,v]) => ["select","order","on_conflict"].includes(k) || (v.startsWith("eq.") && String(row[k]) === v.slice(3))));
globalThis.fetch = (async (input: any, init: any = {}) => {
  const u = new URL(String(input)), table = u.pathname.split("/rest/v1/")[1], method = init.method || "GET", p = u.searchParams;
  if (table === "rpc/record_claim_verification_decision" && method === "POST") {
    const b = JSON.parse(init.body || "{}");
    const old = idempotency.get(b.p_idempotency_key);
    if (old) {
      if (old.hash !== b.p_request_hash) return response({status:409,body:{error:"idempotency_key_reused"}});
      return response({status:old.status,body:old.body,replayed:true});
    }
    const claim = claims.find(x=>x.id===b.p_claim_id && x.story_id===b.p_story_id);
    if (!claim) return response({status:404,body:{error:"claim_not_found"}});
    const rows = evidence.filter(e=>e.claim_id===b.p_claim_id && e.passage && e.extraction_status==="extracted");
    const support = rows.some(e=>!e.is_contradiction), contra = rows.some(e=>e.is_contradiction);
    if (b.p_outcome==="SUPPORTED" && !support) return response({status:400,body:{error:"supported_claim_requires_checked_passage"}});
    if (b.p_outcome==="SUPPORTED" && contra && String(b.p_contradiction_resolution||"").trim().length<80) return response({status:409,body:{error:"contradiction_review_required"}});
    const reviewer_notes = b.p_outcome==="SUPPORTED" && contra
      ? "CONTRADICTION RECONCILIATION:\n"+b.p_contradiction_resolution.trim()+(b.p_reviewer_notes ? "\n\nEDITOR NOTES:\n"+b.p_reviewer_notes : "")
      : b.p_reviewer_notes || null;
    const result = {id:crypto.randomUUID(),claim_id:b.p_claim_id,outcome:b.p_outcome,determined_by:"editor",reviewer_notes,created_at:new Date(Math.max(++testClock,Date.now())).toISOString()};
    decisions.push(result);
    stories.find(x=>x.id===b.p_story_id).verification_status=b.p_outcome==="CONTRADICTED"?"failed":"in_progress";
    auditEvents.push({event_type:"claim_verification_"+b.p_outcome.toLowerCase(),entity_id:b.p_claim_id,detail:{idempotency_key:b.p_idempotency_key}});
    const body={result,note:"Decision recorded atomically. Story-level clearance remains a separate step."};
    idempotency.set(b.p_idempotency_key,{hash:b.p_request_hash,status:200,body});
    return response({status:200,body,replayed:false});
  }
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
    const row = { id: crypto.randomUUID(), created_at: new Date(Math.max(++testClock, Date.now())).toISOString(), ...body };
    rows.push(row);
    return response(init.headers?.Prefer?.includes("return=representation") ? [row] : null, 201);
  }
  if (method === "PATCH") {
    for (const row of filter(rows,p)) Object.assign(row,body);
    return response(null,204);
  }
  return response({},405);
}) as any;
const req = (method:string, body?:any, authenticated=true, idem?:string) => new Request("https://desk.example/?storyId="+storyId,{method,headers:{origin:"https://desk.example",...(authenticated?{cookie}:{}),...(body?{"content-type":"application/json"}:{}),...(idem?{"idempotency-key":idem}:{})},...(body?{body:JSON.stringify(body)}:{})});
const post = (body:any, auth=true, idem?:string) => handler(req("POST",body,auth,idem ?? (body?.action==="decide_claim" ? crypto.randomUUID() : undefined)));
const get = (auth=true) => handler(req("GET",undefined,auth));
const ok = (s:string) => console.log("PASS "+s);

assert.equal((await get(false)).status,401); assert.equal((await post({action:"add_claim",storyId,claimText:"A valid claim"},false)).status,401); ok("all verification operations require the signed editor session");
assert.equal((await post({action:"add_claim",storyId:"bad",claimText:"A valid claim"})).status,400); ok("invalid story identifiers are rejected");
assert.equal((await post({action:"add_claim",storyId,claimText:"x".repeat(1201)})).status,400); ok("overlong claims are rejected rather than silently truncated");
let r=await post({action:"add_claim",storyId,claimText:"The agency announced the policy on 5 November.",category:"date"}); assert.equal(r.status,200); const claim=(await r.json()).claim; assert(claim.id); assert.equal(stories[0].verification_status,"in_progress"); ok("a material claim is stored and story status moves to in progress");
assert.equal((await post({action:"add_evidence",storyId,claimId:claim.id,sourceId:"33333333-3333-4333-8333-333333333333",passage:"Official text"})).status,400); ok("evidence from a source not linked to the story is rejected");
assert.equal((await post({action:"decide_claim",storyId,claimId:claim.id,outcome:"SUPPORTED"})).status,400); ok("SUPPORTED is refused without an extracted passage");
assert.equal((await post({action:"complete_story",storyId,acknowledged:true})).status,409); ok("story clearance is refused while claims remain unresolved");
assert.equal((await post({action:"add_evidence",storyId,claimId:claim.id,sourceId,passage:"x".repeat(4001)})).status,400); ok("overlong evidence passages are rejected without truncation");
assert.equal((await post({action:"add_evidence",storyId,claimId:claim.id,sourceId,passage:"Text",isContradiction:"false"})).status,400); ok("string booleans are rejected and cannot silently become contradiction flags");
r=await post({action:"add_evidence",storyId,claimId:claim.id,sourceId,passage:"The agency announced the policy on 5 November.",location:"Official notice, paragraph 1"}); assert.equal(r.status,200); assert.equal(evidence.length,1); ok("checked passage is attached to a source already linked to the story");
assert.equal((await post({action:"decide_claim",storyId,claimId:claim.id,outcome:"SUPPORTED",notes:"Confirmed against the official notice."})).status,200); ok("editor decision is appended to verification history");
const replayKey = crypto.randomUUID();
const decisionBody = {action:"decide_claim",storyId,claimId:claim.id,outcome:"SUPPORTED",notes:"Confirmed against the official notice."};
const firstDecision = await post(decisionBody,true,replayKey);
assert.equal(firstDecision.status,200);
const decisionCount = decisions.length, auditCount = auditEvents.length;
const replayDecision = await post(decisionBody,true,replayKey);
assert.equal(replayDecision.status,200);
assert.equal((await replayDecision.json()).replayed,true);
assert.equal(decisions.length,decisionCount);
assert.equal(auditEvents.length,auditCount);
ok("same claim-decision request key replays without duplicate decision or audit event");
assert.equal((await post({...decisionBody,notes:"Changed payload"},true,replayKey)).status,409);
ok("reusing a claim-decision key with changed data is rejected");
assert.equal((await post({action:"complete_story",storyId,acknowledged:false})).status,400); assert.equal(stories[0].verification_status,"in_progress"); ok("clearance requires explicit completeness acknowledgement");
r=await post({action:"complete_story",storyId,acknowledged:true}); assert.equal(r.status,200); assert.equal(stories[0].verification_status,"verified"); ok("story becomes verified only after every recorded claim has a passage and supported editor decision");
assert.equal((await post({action:"add_evidence",storyId,claimId:claim.id,sourceId,passage:"A newly checked passage."})).status,200); assert.equal(stories[0].verification_status,"in_progress"); ok("adding or changing evidence invalidates prior story-level clearance");
assert.equal((await post({action:"add_evidence",storyId,claimId:claim.id,sourceId,passage:"A report gives a conflicting date.",isContradiction:true})).status,200); ok("contradictory evidence is recorded distinctly");
assert.equal((await post({action:"decide_claim",storyId,claimId:claim.id,outcome:"SUPPORTED",notes:"I checked it."})).status,409); ok("SUPPORTED is blocked when contradictory evidence has only generic notes");
assert.equal((await post({action:"decide_claim",storyId,claimId:claim.id,outcome:"SUPPORTED",notes:"I reviewed the record.",contradictionResolution:""})).status,409); ok("SUPPORTED requires a separate contradiction reconciliation rationale");
assert.equal((await post({action:"complete_story",storyId,acknowledged:true})).status,409); ok("story clearance rejects contradictory evidence without a recorded reconciliation");
assert.equal((await post({action:"decide_claim",storyId,claimId:claim.id,outcome:"SUPPORTED",notes:"I reviewed the record.",contradictionResolution:"The conflicting report refers to a different agency notice and date. The official notice and its publication record identify the date stated in this claim, while the conflicting passage concerns a separate event."})).status,200); ok("editor can record a specific reconciliation distinct from general reviewer notes");
assert.equal((await post({action:"complete_story",storyId,acknowledged:true})).status,200); assert.equal(stories[0].verification_status,"verified"); ok("contradictory evidence clearance requires both support and documented reconciliation");
console.log("\\nALL CLAIM VERIFICATION API CHECKS PASSED");

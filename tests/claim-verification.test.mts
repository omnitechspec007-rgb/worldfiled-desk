import assert from "node:assert";
process.env.EDITOR_PASSPHRASE = "blue lantern river 42";
process.env.SESSION_SECRET = "z".repeat(40);
process.env.SUPABASE_URL = "https://abc.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test";
const root = new URL("../netlify/", import.meta.url).pathname;
const { makeSessionCookie } = await import(root + "lib/session.mts");
const handler = (await import(root + "functions/claim-verification.mts")).default;
const { hasContradictionReconciliation } = await import(root + "lib/claim-clearance.mts");
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
  if (table === "rpc/add_material_claim" && method === "POST") {
    const b=JSON.parse(init.body||"{}");
    const mapKey="material-claim:"+b.p_idempotency_key;
    const old=idempotency.get(mapKey);
    if(old){if(old.hash!==b.p_request_hash)return response({status:409,body:{error:"idempotency_key_reused"}});return response({status:old.status,body:old.body,replayed:true});}
    if(!stories.some(x=>x.id===b.p_story_id))return response({status:404,body:{error:"not_found"}});
    let row=claims.find(x=>x.story_id===b.p_story_id&&x.claim_hash===b.p_claim_hash);
    let isNew=false;
    if(row){
      if(row.claim_text!==b.p_claim_text||(row.category||"")!==(b.p_category||""))return response({status:409,body:{error:"claim_fingerprint_conflict"}});
    }else{
      row={id:crypto.randomUUID(),story_id:b.p_story_id,claim_text:b.p_claim_text,claim_hash:b.p_claim_hash,category:b.p_category,created_at:(testClock=Math.max(testClock+1,Date.now()),new Date(testClock).toISOString())};
      claims.push(row);isNew=true;
      stories.find(x=>x.id===b.p_story_id).verification_status="in_progress";
      auditEvents.push({event_type:"material_claim_added",entity_id:row.id,detail:{idempotency_key:b.p_idempotency_key}});
    }
    const body={claim:row,note:isNew?"Claim saved atomically. It remains unverified until sources and an editor decision are recorded.":"This exact claim was already recorded. No duplicate claim or audit event was created."};
    idempotency.set(mapKey,{hash:b.p_request_hash,status:200,body});
    return response({status:200,body,replayed:false});
  }
  if (table === "rpc/add_claim_evidence" && method === "POST") {
    const b = JSON.parse(init.body || "{}");
    const mapKey = "evidence:" + b.p_idempotency_key;
    const old = idempotency.get(mapKey);
    if (old) {
      if (old.hash !== b.p_request_hash) return response({status:409,body:{error:"idempotency_key_reused"}});
      return response({status:old.status,body:old.body,replayed:true});
    }
    if (!claims.some(x=>x.id===b.p_claim_id && x.story_id===b.p_story_id)) return response({status:404,body:{error:"claim_not_found"}});
    if (!links.some(x=>x.story_id===b.p_story_id && x.source_id===b.p_source_id)) return response({status:400,body:{error:"source_not_linked_to_story"}});
    const source=sources.find(x=>x.id===b.p_source_id);
    if (!source) return response({status:404,body:{error:"source_not_found"}});
    const extraction_status = b.p_passage && b.p_passage.trim() ? "extracted" : "inaccessible";
    let row=evidence.find(x=>x.claim_id===b.p_claim_id && x.source_id===b.p_source_id && x.passage_hash===b.p_passage_hash);
    let isNew=false;
    if (row) {
      if ((row.passage||"")!==(b.p_passage||"") || (row.passage_location||"")!==(b.p_passage_location||"") || row.is_contradiction!==b.p_is_contradiction || row.extraction_status!==extraction_status)
        return response({status:409,body:{error:"evidence_fingerprint_conflict"}});
    } else {
      row={id:crypto.randomUUID(),claim_id:b.p_claim_id,source_id:b.p_source_id,passage:b.p_passage,passage_hash:b.p_passage_hash,passage_location:b.p_passage_location,source_published_at:source.published_at,extraction_status,is_contradiction:b.p_is_contradiction,created_at:(testClock=Math.max(testClock+1,Date.now()),new Date(testClock).toISOString())};
      evidence.push(row); isNew=true;
      stories.find(x=>x.id===b.p_story_id).verification_status="in_progress";
      auditEvents.push({event_type:"claim_evidence_added",entity_id:b.p_claim_id,detail:{idempotency_key:b.p_idempotency_key}});
    }
    const body={evidence:row,note:isNew ? (extraction_status==="extracted" ? "Evidence passage saved atomically. The editor must assess what it supports." : "Source linked without an extracted passage. This is a lead, not supporting evidence.") : "This exact evidence passage was already recorded. No duplicate evidence or audit event was created."};
    idempotency.set(mapKey,{hash:b.p_request_hash,status:200,body});
    return response({status:200,body,replayed:false});
  }
  if (table === "rpc/record_claim_verification_decision" && method === "POST") {
    const b = JSON.parse(init.body || "{}");
    const mapKey = "claim:" + b.p_idempotency_key;
    const old = idempotency.get(mapKey);
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
    const result = {id:crypto.randomUUID(),claim_id:b.p_claim_id,outcome:b.p_outcome,determined_by:"editor",reviewer_notes,created_at:(testClock = Math.max(testClock + 1, Date.now()), new Date(testClock).toISOString())};
    decisions.push(result);
    stories.find(x=>x.id===b.p_story_id).verification_status=b.p_outcome==="CONTRADICTED"?"failed":"in_progress";
    auditEvents.push({event_type:"claim_verification_"+b.p_outcome.toLowerCase(),entity_id:b.p_claim_id,detail:{idempotency_key:b.p_idempotency_key}});
    const body={result,note:"Decision recorded atomically. Story-level clearance remains a separate step."};
    idempotency.set(mapKey,{hash:b.p_request_hash,status:200,body});
    return response({status:200,body,replayed:false});
  }
  if (table === "rpc/complete_story_verification" && method === "POST") {
    const b = JSON.parse(init.body || "{}");
    const mapKey = "clearance:" + b.p_idempotency_key;
    const old = idempotency.get(mapKey);
    if (old) {
      if (old.hash !== b.p_request_hash) return response({status:409,body:{error:"idempotency_key_reused"}});
      return response({status:old.status,body:old.body,replayed:true});
    }
    const story = stories.find(x=>x.id===b.p_story_id);
    if (!story) return response({status:404,body:{error:"not_found"}});
    const storyClaims = claims.filter(x=>x.story_id===b.p_story_id);
    if (!storyClaims.length) return response({status:400,body:{error:"no_material_claims_recorded"}});
    const unresolved = storyClaims.filter(claim=>{
      const latest = [...decisions.filter(d=>d.claim_id===claim.id)].sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id))[0];
      const rows = evidence.filter(e=>e.claim_id===claim.id && e.passage && e.extraction_status==="extracted");
      const support = rows.some(e=>!e.is_contradiction), contra = rows.some(e=>e.is_contradiction);
      const latestEvidenceAt = Math.max(0,...evidence.filter(e=>e.claim_id===claim.id).map(e=>Date.parse(e.created_at||"")||0));
      return !latest || latest.outcome!=="SUPPORTED" || !support || (contra && !hasContradictionReconciliation(latest.reviewer_notes)) || Date.parse(latest.created_at||"")<latestEvidenceAt;
    });
    if (unresolved.length) return response({status:409,body:{error:"claims_unresolved",unresolvedCount:unresolved.length}});
    story.verification_status="verified";
    auditEvents.push({event_type:"story_verification_verified",entity_id:b.p_story_id,detail:{idempotency_key:b.p_idempotency_key}});
    const body={verificationStatus:"verified",note:"Story marked verified for the claims recorded. The editor confirmed the material-claim list is complete."};
    idempotency.set(mapKey,{hash:b.p_request_hash,status:200,body});
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
    const row = { id: crypto.randomUUID(), created_at: (testClock = Math.max(testClock + 1, Date.now()), new Date(testClock).toISOString()), ...body };
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
const post = (body:any, auth=true, idem?:string) => handler(req("POST",body,auth,idem ?? (body?.action==="decide_claim" || body?.action==="complete_story" || body?.action==="add_evidence" || body?.action==="add_claim" ? crypto.randomUUID() : undefined)));
const get = (auth=true) => handler(req("GET",undefined,auth));
const ok = (s:string) => console.log("PASS "+s);

assert.equal((await get(false)).status,401); assert.equal((await post({action:"add_claim",storyId,claimText:"A valid claim"},false)).status,401); ok("all verification operations require the signed editor session");
assert.equal((await post({action:"add_claim",storyId:"bad",claimText:"A valid claim"})).status,400); ok("invalid story identifiers are rejected");
assert.equal((await post({action:"add_claim",storyId,claimText:"x".repeat(1201)})).status,400); ok("overlong claims are rejected rather than silently truncated");
let r=await post({action:"add_claim",storyId,claimText:"The agency announced the policy on 5 November.",category:"date"}); assert.equal(r.status,200); const claim=(await r.json()).claim; assert(claim.id); assert.equal(stories[0].verification_status,"in_progress"); ok("a material claim is stored and story status moves to in progress");
const claimAddKey=crypto.randomUUID();
const claimAddBody={action:"add_claim",storyId,claimText:"The agency announced the policy on 5 November.",category:"date"};
const claimReplay=await post(claimAddBody,true,claimAddKey); assert.equal(claimReplay.status,200); assert.equal((await claimReplay.json()).replayed,true);
assert.equal(claims.length,1);
ok("material claim request safely replays without duplicate claim creation");
assert.equal((await post({...claimAddBody,category:"different"},true,claimAddKey)).status,409);
ok("material claim idempotency key rejects changed payload");
const claimDuplicate=await post(claimAddBody); assert.equal(claimDuplicate.status,200); assert.ok((await claimDuplicate.json()).note.includes("already recorded")); assert.equal(claims.length,1);
ok("same claim fingerprint does not create a duplicate or overwrite");
assert.equal((await post({...claimAddBody,claimText:"THE AGENCY ANNOUNCED THE POLICY ON 5 NOVEMBER."})).status,409);
ok("claim fingerprint cannot silently merge different displayed wording");
assert.equal((await post({action:"add_evidence",storyId,claimId:claim.id,sourceId:"33333333-3333-4333-8333-333333333333",passage:"Official text"})).status,400); ok("evidence from a source not linked to the story is rejected");
assert.equal((await post({action:"decide_claim",storyId,claimId:claim.id,outcome:"SUPPORTED"})).status,400); ok("SUPPORTED is refused without an extracted passage");
assert.equal((await post({action:"complete_story",storyId,acknowledged:true})).status,409); ok("story clearance is refused while claims remain unresolved");
assert.equal((await post({action:"add_evidence",storyId,claimId:claim.id,sourceId,passage:"x".repeat(4001)})).status,400); ok("overlong evidence passages are rejected without truncation");
assert.equal((await post({action:"add_evidence",storyId,claimId:claim.id,sourceId,passage:"Text",isContradiction:"false"})).status,400); ok("string booleans are rejected and cannot silently become contradiction flags");
r=await post({action:"add_evidence",storyId,claimId:claim.id,sourceId,passage:"The agency announced the policy on 5 November.",location:"Official notice, paragraph 1"}); assert.equal(r.status,200); assert.equal(evidence.length,1); ok("checked passage is attached to a source already linked to the story");
const evidenceKey=crypto.randomUUID();
const evidenceBody={action:"add_evidence",storyId,claimId:claim.id,sourceId,passage:"The agency announced the policy on 5 November.",location:"Official notice, paragraph 1"};
const evidenceFirst=await post(evidenceBody,true,evidenceKey); assert.equal(evidenceFirst.status,200);
const evidenceCount=evidence.length, evidenceAuditCount=auditEvents.filter(x=>x.event_type==="claim_evidence_added").length;
const evidenceReplay=await post(evidenceBody,true,evidenceKey); assert.equal(evidenceReplay.status,200); assert.equal((await evidenceReplay.json()).replayed,true);
assert.equal(evidence.length,evidenceCount); assert.equal(auditEvents.filter(x=>x.event_type==="claim_evidence_added").length,evidenceAuditCount);
ok("evidence addition replays without duplicate evidence or audit event");
assert.equal((await post({...evidenceBody,location:"Changed location"},true,evidenceKey)).status,409);
ok("evidence request key cannot be reused with changed passage metadata");
assert.equal((await post({...evidenceBody,isContradiction:true})).status,409);
ok("an existing passage fingerprint cannot be silently reclassified as contradictory");
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
const clearanceKey=crypto.randomUUID(); r=await post({action:"complete_story",storyId,acknowledged:true},true,clearanceKey); assert.equal(r.status,200); assert.equal(stories[0].verification_status,"verified"); const clearanceReplay=await post({action:"complete_story",storyId,acknowledged:true},true,clearanceKey); assert.equal(clearanceReplay.status,200); assert.equal((await clearanceReplay.json()).replayed,true); ok("story clearance is atomic and replays without duplicate audit events");
assert.equal((await post({action:"add_evidence",storyId,claimId:claim.id,sourceId,passage:"A newly checked passage."})).status,200); assert.equal(stories[0].verification_status,"in_progress"); ok("adding or changing evidence invalidates prior story-level clearance");
assert.equal((await post({action:"add_evidence",storyId,claimId:claim.id,sourceId,passage:"A report gives a conflicting date.",isContradiction:true})).status,200); ok("contradictory evidence is recorded distinctly");
assert.equal((await post({action:"decide_claim",storyId,claimId:claim.id,outcome:"SUPPORTED",notes:"I checked it."})).status,409); ok("SUPPORTED is blocked when contradictory evidence has only generic notes");
assert.equal((await post({action:"decide_claim",storyId,claimId:claim.id,outcome:"SUPPORTED",notes:"I reviewed the record.",contradictionResolution:""})).status,409); ok("SUPPORTED requires a separate contradiction reconciliation rationale");
assert.equal((await post({action:"complete_story",storyId,acknowledged:true})).status,409); ok("story clearance rejects contradictory evidence without a recorded reconciliation");
assert.equal((await post({action:"decide_claim",storyId,claimId:claim.id,outcome:"SUPPORTED",notes:"I reviewed the record.",contradictionResolution:"The conflicting report refers to a different agency notice and date. The official notice and its publication record identify the date stated in this claim, while the conflicting passage concerns a separate event."})).status,200); ok("editor can record a specific reconciliation distinct from general reviewer notes");
r=await post({action:"complete_story",storyId,acknowledged:true}); assert.equal(r.status,200); assert.equal(stories[0].verification_status,"verified"); ok("contradictory evidence clearance requires both support and documented reconciliation");
console.log("\\nALL CLAIM VERIFICATION API CHECKS PASSED");

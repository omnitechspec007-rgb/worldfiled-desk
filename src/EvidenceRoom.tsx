import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Scores, type Score } from "./Scores";

type Source = { id: string; title: string; url: string; outlet: string; scope: string | null; region: string; tier: string; publishedAt: string | null; retrievedAt: string | null; depth: string; summary?: string | null };
type Claim = { id: string; claim_text: string; category: string | null; claim_evidence: { id: string; passage: string | null; passage_location: string | null; is_contradiction: boolean; extraction_status: string; policyBlocked?: boolean; passageWithheld?: boolean; retrieved_sources?: { title: string; url: string } }[]; verification_results: { id: string; outcome: string; determined_by: string; reviewer_notes: string | null; created_at: string }[] };
type PendingClaimDecision = { storyId: string; body: Record<string,unknown>; key: string };
type Story = { id: string; headline: string; category: string | null; outlets: number; regions: string[]; sources: Source[]; scores?: Score[]; decisions?: { decision: string; notes: string | null; created_at: string }[]; verificationStatus?: string };
const outcomes = ["SUPPORTED", "PARTIALLY_SUPPORTED", "CONTRADICTED", "INSUFFICIENT_EVIDENCE", "UNVERIFIED", "NOT_APPLICABLE"];
const dateText = (v: string | null) => v ? new Date(v).toLocaleString() : "date not given by source";

export default function EvidenceRoom() {
  const { id } = useParams();
  const [story, setStory] = useState<Story | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [claimText, setClaimText] = useState("");
  const [category, setCategory] = useState("factual");
  const [sourceChoice, setSourceChoice] = useState<Record<string,string>>({});
  const [passage, setPassage] = useState<Record<string,string>>({});
  const [location, setLocation] = useState<Record<string,string>>({});
  const [contradiction, setContradiction] = useState<Record<string,boolean>>({});
  const [outcome, setOutcome] = useState<Record<string,string>>({});
  const [reason, setReason] = useState<Record<string,string>>({});
  const [contradictionResolution, setContradictionResolution] = useState<Record<string,string>>({});
  const [completeAck, setCompleteAck] = useState(false);
  const [pendingDecision, setPendingDecision] = useState<PendingClaimDecision | null>(() => {
    try {
      const raw = sessionStorage.getItem("wf:pending-claim-decision");
      const value = raw ? JSON.parse(raw) as PendingClaimDecision : null;
      return value && typeof value.storyId === "string" && (value.body?.action === "decide_claim" || value.body?.action === "complete_story" || value.body?.action === "add_evidence" || value.body?.action === "add_claim") && typeof value.key === "string" ? value : null;
    } catch { return null; }
  });
  const [decisionUncertain, setDecisionUncertain] = useState(() => Boolean(pendingDecision));

  const load = useCallback(async () => {
    if (!id) return;
    setError("");
    try {
      const a = await fetch("/.netlify/functions/stories?id=" + encodeURIComponent(id));
      if (!a.ok) throw new Error("Could not load this story.");
      const storyData = await a.json();
      setStory(storyData.story);
      const b = await fetch("/.netlify/functions/claim-verification?storyId=" + encodeURIComponent(id));
      const data = await b.json();
      if (!b.ok) throw new Error(data.detail || data.error || "Could not load the verification register.");
      setClaims(data.claims || []);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load this story."); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const act = async (body: Record<string,unknown>, retryOperation?: PendingClaimDecision) => {
    if (!id) return null;
    const isDecision = body.action === "decide_claim" || body.action === "complete_story" || body.action === "add_evidence" || body.action === "add_claim";
    if (decisionUncertain && !retryOperation) {
      setError("A previous claim decision has an uncertain result. Retry that exact decision before starting another action.");
      return null;
    }
    const operation: PendingClaimDecision | null = isDecision
      ? retryOperation ?? { storyId: id, body: { ...body }, key: crypto.randomUUID() }
      : null;
    setBusy(true); setError(""); setMessage("");
    if (operation) {
      setPendingDecision(operation);
      try { sessionStorage.setItem("wf:pending-claim-decision", JSON.stringify(operation)); } catch { /* in-memory retry remains available */ }
    }
    try {
      const r = await fetch("/.netlify/functions/claim-verification", {
        method:"POST",
        headers:{"Content-Type":"application/json", ...(operation ? {"Idempotency-Key":operation.key} : {})},
        body:JSON.stringify({storyId:operation ? operation.storyId : id,...(operation ? operation.body : body)})
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (operation && (data.outcome === "unknown" || r.status >= 500)) {
          setDecisionUncertain(true);
          setError("We couldn't confirm whether this decision was saved. Your work is preserved. Retry the same decision safely.");
        } else {
          if (operation) {
            setPendingDecision(null);
            setDecisionUncertain(false);
            try { sessionStorage.removeItem("wf:pending-claim-decision"); } catch { /* ignore unavailable storage */ }
          }
          setError(data.note || data.detail || data.error || "Could not save.");
        }
        return null;
      }
      if (operation) {
        setPendingDecision(null);
        setDecisionUncertain(false);
        try { sessionStorage.removeItem("wf:pending-claim-decision"); } catch { /* ignore unavailable storage */ }
      }
      setMessage(data.replayed ? "Already saved. No duplicate decision was created." : data.note || "Saved.");
      await load();
      return data;
    } catch(e) {
      if (operation) {
        setDecisionUncertain(true);
        setError("Connection interrupted. We couldn't confirm whether this decision was saved. Your work is preserved; retry safely using the same request.");
      } else {
        setError(e instanceof Error ? e.message : "Could not save.");
      }
      return null;
    } finally { setBusy(false); }
  };

  if (!id) return <section><h1>Evidence Room</h1><div className="panel"><p>Pick a story in the <Link to="/stories">Story Desk</Link> to inspect its sources.</p></div></section>;

  return <section>
    <h1>Evidence Room</h1>
    {error && <div className={decisionUncertain ? "panel state-warning" : "status bad"} role={decisionUncertain ? "status" : "alert"}><p>{error}</p>{decisionUncertain && pendingDecision && (pendingDecision.storyId === id ? <button className="primary" disabled={busy} onClick={()=>void act(pendingDecision.body,pendingDecision)}>{busy ? "CHECKING…" : "RETRY SAME OPERATION"}</button> : <p><Link to={"/evidence/"+pendingDecision.storyId}>Return to the story with the pending decision to retry it safely.</Link></p>)}</div>}
    {message && <p className="status good" role="status">{message}</p>}
    {!story && !error && <p className="status">Loading story and verification record…</p>}
    {story && <>
      <div className="panel"><h2>{story.headline}</h2><p className="meta">{story.category || "Uncategorised"} · {story.regions.join(", ")}</p><p className="caution">Factual verification status: <strong>{story.verificationStatus || "unverified"}</strong>. Editorial approval is separate.</p></div>
      <div className="panel">
        <h2>Sources ({story.sources.length} items from {story.outlets} publisher labels)</h2>
        <p className="caution">The research importer collected headlines and short summaries, not full article text. Open sources yourself and record the relevant passage below. Publisher-label count is not proof of independent corroboration. Shared ownership, syndication and common original reporting are not fully traced.</p>
        {story.sources.map(s=><div className="source" key={s.id}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a><p className="meta">{s.outlet} · {s.scope || s.region} · {s.tier === "primary" ? "official or primary source" : "news reporting"}</p><p className="meta">Published: {dateText(s.publishedAt)} · Retrieved: {dateText(s.retrievedAt)} · {s.depth}</p>{s.summary && <p className="summary">{s.summary}</p>}</div>)}
      </div>
      <div className="panel">
        <h2>Claim register ({claims.length})</h2>
        <p>Record each material factual assertion separately, including important numbers, dates, quotations and attributions. Do not enter a whole article summary as one claim.</p>
        <label>Material factual claim<textarea rows={3} maxLength={1200} value={claimText} onChange={e=>setClaimText(e.target.value)} placeholder="Write one precise, checkable assertion…" /></label>
        <label>Claim type<select value={category} onChange={e=>setCategory(e.target.value)}><option value="factual">Factual assertion</option><option value="number">Number / statistic</option><option value="date">Date / chronology</option><option value="quote">Quotation</option><option value="attribution">Attribution</option><option value="location">Location</option><option value="causal">Causal / interpretive</option></select></label>
        <button className="primary" disabled={busy || decisionUncertain || claimText.trim().length<8} onClick={async()=>{const r=await act({action:"add_claim",claimText,category});if(r)setClaimText("");}}>ADD CLAIM</button>
        {claims.map((c,i)=>{
          const latest=[...(c.verification_results||[])].sort((a,b)=>b.created_at.localeCompare(a.created_at))[0];
          const hasContradiction=(c.claim_evidence||[]).some(ev=>ev.is_contradiction && ev.passage && ev.extraction_status==="extracted");
          const needsReconciliation=hasContradiction && (outcome[c.id]||"UNVERIFIED")==="SUPPORTED";
          return <div className="panel" key={c.id}>
            <p className="rank">CLAIM {String(i+1).padStart(2,"0")} · {c.category || "factual"} · <strong>{latest?.outcome || "UNVERIFIED"}</strong></p>
            <p>{c.claim_text}</p>
            <h3>Evidence ({(c.claim_evidence||[]).length})</h3>
            {(c.claim_evidence||[]).map(ev=><div className="source" key={ev.id}><p><strong>{ev.is_contradiction ? "Potential contradiction" : "Supporting / contextual evidence"}</strong> · {ev.policyBlocked ? "Blocked by content policy · passage withheld" : ev.passageWithheld ? "Passage withheld · metadata-only policy" : ev.extraction_status}</p>{ev.retrieved_sources && <a href={ev.retrieved_sources.url} target="_blank" rel="noopener noreferrer">{ev.retrieved_sources.title}</a>}{ev.passage && <blockquote>{ev.passage}</blockquote>}{ev.passage_location && <p className="meta">Location: {ev.passage_location}</p>}</div>)}
            <label>Linked source<select value={sourceChoice[c.id]||""} onChange={e=>setSourceChoice(p=>({...p,[c.id]:e.target.value}))}><option value="">Choose source</option>{story.sources.map(s=><option key={s.id} value={s.id}>{s.outlet} — {s.title}</option>)}</select></label>
            <label>Relevant passage<textarea rows={3} maxLength={4000} value={passage[c.id]||""} onChange={e=>setPassage(p=>({...p,[c.id]:e.target.value}))} placeholder="Paste the short passage you personally checked." /></label>
            <label>Passage location<input maxLength={300} value={location[c.id]||""} onChange={e=>setLocation(p=>({...p,[c.id]:e.target.value}))} placeholder="Paragraph, page, section or timestamp" /></label>
            <label className="inline"><input type="checkbox" checked={Boolean(contradiction[c.id])} onChange={e=>setContradiction(p=>({...p,[c.id]:e.target.checked}))}/> This passage challenges or contradicts the claim</label>
            <button disabled={busy || decisionUncertain || !sourceChoice[c.id] || !passage[c.id]?.trim()} onClick={()=>void act({action:"add_evidence",claimId:c.id,sourceId:sourceChoice[c.id],passage:passage[c.id]||"",location:location[c.id]||"",isContradiction:Boolean(contradiction[c.id])})}>ADD EVIDENCE</button>
            <label>Editor decision<select value={outcome[c.id]||"UNVERIFIED"} onChange={e=>setOutcome(p=>({...p,[c.id]:e.target.value}))}>{outcomes.map(o=><option key={o} value={o}>{o.replace(/_/g," ")}</option>)}</select></label>
            {needsReconciliation && <label>Specific contradiction reconciliation (required)<textarea rows={3} maxLength={1000} value={contradictionResolution[c.id]||""} onChange={e=>setContradictionResolution(p=>({...p,[c.id]:e.target.value}))} placeholder="Address the conflicting passage directly. Explain what it says, why it conflicts, and what evidence justifies your conclusion." /></label>}
            <label>General reviewer notes<textarea rows={2} maxLength={400} value={reason[c.id]||""} onChange={e=>setReason(p=>({...p,[c.id]:e.target.value}))} placeholder="What does the evidence establish? What remains uncertain?" /></label>
            <button className="primary" disabled={busy || decisionUncertain || (outcome[c.id]||"UNVERIFIED")==="UNVERIFIED" || (needsReconciliation && (contradictionResolution[c.id]||"").trim().length<80)} onClick={()=>void act({action:"decide_claim",claimId:c.id,outcome:outcome[c.id]||"UNVERIFIED",notes:reason[c.id]||"",contradictionResolution:contradictionResolution[c.id]||""})}>RECORD EDITOR DECISION</button>
            {(c.verification_results||[]).length>0 && <details><summary>Decision history</summary>{c.verification_results.map(v=><p className="meta" key={v.id}>{dateText(v.created_at)} · {v.outcome} · {v.determined_by}{v.reviewer_notes ? " — "+v.reviewer_notes : ""}</p>)}</details>}
          </div>;
        })}
      </div>
      <div className="panel">
        <h2>Story verification clearance</h2>
        <p>Every material claim must be listed, supported by a passage you checked, and recorded as SUPPORTED by an editor. Contradicted, disputed or incomplete claims must keep the story out of verified coverage.</p>
        <label className="inline"><input type="checkbox" checked={completeAck} onChange={e=>setCompleteAck(e.target.checked)}/> I confirm this register contains all material factual claims for the proposed coverage.</label>
        <button className="primary" disabled={busy || decisionUncertain || !completeAck || claims.length===0} onClick={async()=>{const r=await act({action:"complete_story",acknowledged:true});if(r)setCompleteAck(false);}}>COMPLETE VERIFICATION</button>
      </div>
      <div className="panel"><h2>Scores and editorial decisions</h2><Scores scores={story.scores||[]}/>{story.decisions?.map((d,i)=><p className="meta" key={i}>{dateText(d.created_at)}: {d.decision.replace("_"," ")}{d.notes ? " — "+d.notes : ""}</p>)}</div>
    </>}
  </section>;
}

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Scores, type Score } from "./Scores";

type Pick = { id: string; headline: string; category: string | null; outlets: number; regions: string[]; hasPrimary: boolean; rank: number; reason: string; flags: string[]; scores: Score[]; editorialStatus?: string; verificationStatus?: string };
type PendingDecision = { storyId: string; decision: "approved" | "rejected" | "needs_research"; notes: string; acknowledged: boolean; key: string };

const STATUS: Record<string, string> = { in_review: "Awaiting your decision", approved: "Editorially approved", rejected: "Rejected", needs_research: "Needs more research", pending: "Not reviewed" };

export default function EditorialReview() {
  const [picks, setPicks] = useState<Pick[] | null>(null);
  const [notInstalled, setNotInstalled] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState<PendingDecision | null>(() => {
    try {
      const raw = sessionStorage.getItem("wf:pending-story-decision");
      return raw ? JSON.parse(raw) as PendingDecision : null;
    } catch { return null; }
  });
  const [msg, setMsg] = useState(() => pending ? "A previous decision may not have received confirmation. Retry the same operation to safely check its result." : "");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(() => Boolean(pending));

  const load = useCallback(async () => {
    try {
      const requestedIds = new URLSearchParams(window.location.search).get("ids");
      const endpoint = requestedIds
        ? "/.netlify/functions/stories?view=review&ids=" + encodeURIComponent(requestedIds)
        : "/.netlify/functions/stories?view=shortlist";
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error();
      const d = await res.json();
      setNotInstalled(Boolean(d.notInstalled));
      setPicks(d.picks ?? []);
      if (d.missing?.length) setMsg(d.missing.length + " selected story record(s) could not be found. Review the remaining stories and refresh the package.");
    } catch {
      setMsg("Could not load the shortlist.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submitDecision = async (operation: PendingDecision) => {
    setBusy(true);
    setMsg("");
    setPending(operation);
    try { sessionStorage.setItem("wf:pending-story-decision", JSON.stringify(operation)); } catch { /* in-memory retry remains available */ }
    try {
      const res = await fetch("/.netlify/functions/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": operation.key },
        body: JSON.stringify({ storyId: operation.storyId, decision: operation.decision, notes: operation.notes, acknowledged: operation.acknowledged }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.outcome === "unknown" || res.status >= 500) {
          setUncertain(true);
          setMsg("We couldn't confirm whether this decision was saved. Your work is preserved. Retry safely using the same request.");
        } else {
          setPending(null);
          setUncertain(false);
          try { sessionStorage.removeItem("wf:pending-story-decision"); } catch { /* ignore unavailable storage */ }
          setMsg(data.detail || data.error || "The decision was not saved. Review the message and try again.");
        }
        setBusy(false);
        return;
      }
      setPending(null);
      setUncertain(false);
      try { sessionStorage.removeItem("wf:pending-story-decision"); } catch { /* ignore unavailable storage */ }
      setOpen(null);
      setAck(false);
      setNotes("");
      setMsg(data.replayed ? "Already saved. No duplicate decision was created." : operation.decision === "approved" ? "Editorially approved. This is not factual verification; production remains blocked until the claim register is verified." : operation.decision === "rejected" ? "Rejected." : "Marked as needing more research.");
      await load();
    } catch {
      setUncertain(true);
      setMsg("Connection interrupted. We couldn't confirm whether this decision was saved. Your work is preserved; retry safely using the same request.");
    }
    setBusy(false);
  };

  const decide = (id: string, decision: "approved" | "rejected" | "needs_research") => {
    if (uncertain && pending) return;
    const operation: PendingDecision = {
      storyId: id,
      decision,
      notes: decision === "approved" ? notes : "",
      acknowledged: decision === "approved" && ack,
      key: crypto.randomUUID(),
    };
    void submitDecision(operation);
  };

  return (
    <section>
      <h1>Verification and approval</h1>
      {new URLSearchParams(window.location.search).has("ids") && <p className="meta"><a href="/editions">← Return to your prepared production package</a></p>}
      <p className="status">Two separate human checks are required. First verify the material claims in the Evidence Room; then make the editorial decision here. Editorial approval does not mean the facts are verified. Production prompts remain blocked until both checks are complete.</p>
      {msg && <div className={uncertain ? "panel state-warning" : "panel state-error"} role={uncertain ? "status" : "alert"}><p className={uncertain ? "status" : "status bad"}>{msg}</p>{uncertain && pending ? <div className="actions"><button className="primary" disabled={busy} onClick={() => void submitDecision(pending)}>{busy ? "CHECKING…" : "RETRY SAME DECISION"}</button><button disabled={busy} onClick={() => void load()}>Refresh shortlist</button></div> : <button onClick={() => void load()}>Refresh shortlist</button>}</div>}
      {!picks && !msg && <div className="panel state-loading" role="status"><p className="meta">Loading stories for review…</p></div>}
      {notInstalled && <div className="panel"><p className="caution">One-time setup needed: run supabase/migrations/002_scoring.sql in the Supabase SQL Editor, then click RUN RESEARCH.</p></div>}
      {picks && picks.length === 0 && !notInstalled && <div className="panel"><p>Nothing to review yet. Click RUN RESEARCH on the Dashboard.</p></div>}
      {picks?.map((s) => (
        <div className="panel story" key={s.id}>
          <p className="rank">#{s.rank} · EDITORIAL: {STATUS[s.editorialStatus ?? "pending"]}</p>
          <p className={s.verificationStatus === "verified" ? "status good" : "status bad"}>FACTUAL VERIFICATION: {s.verificationStatus === "verified" ? "Complete — human-reviewed claim register" : s.verificationStatus === "in_progress" ? "In progress — claims still need review" : "Not complete — open the Evidence Room"} · <Link to={`/evidence/${s.id}`}>Verify this story →</Link></p>
          <h2><Link to={`/evidence/${s.id}`}>{s.headline}</Link></h2>
          <p className="meta">{s.category ?? "Uncategorised"} · {s.regions?.join(", ")} · {s.outlets === 1 ? "single outlet" : `${s.outlets} outlets`}{s.hasPrimary ? " · includes an official source" : ""}</p>
          <p className="why"><strong>Why selected:</strong> {s.reason}</p>
          {s.flags.map((f) => <p className="caution" key={f}>⚠ {f}</p>)}
          <Scores scores={s.scores} compact />
          {open === s.id ? (
            <div className="confirm">
              <label className="inline">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                I have opened the sources in the Evidence Room. I understand the claims are not yet verified and I take responsibility for this decision.
              </label>
              <label>Notes (optional)<input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} /></label>
              <div className="actions">
                <button className="primary" disabled={!ack || busy || uncertain} onClick={() => decide(s.id, "approved")}>{busy ? "SAVING…" : "CONFIRM APPROVAL"}</button>
                <button onClick={() => { setOpen(null); setAck(false); }}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="actions">
              <button className="primary" onClick={() => { setOpen(s.id); setAck(false); }} disabled={s.editorialStatus === "approved" || uncertain || s.verificationStatus !== "verified"}>{s.verificationStatus === "verified" ? "Approve for editorial use…" : "Verify first to approve"}</button>
              <button onClick={() => decide(s.id, "rejected")} disabled={busy || uncertain}>Reject</button>
              <button onClick={() => void decide(s.id, "needs_research")} disabled={busy || uncertain}>Needs more research</button>
              <Link to={`/evidence/${s.id}`}>Open sources</Link>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

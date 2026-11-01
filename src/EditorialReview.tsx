import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Scores, type Score } from "./Scores";

type Pick = { id: string; headline: string; category: string | null; outlets: number; regions: string[]; hasPrimary: boolean; rank: number; reason: string; flags: string[]; scores: Score[]; editorialStatus?: string };

const STATUS: Record<string, string> = { in_review: "Awaiting your decision", approved: "Approved", rejected: "Rejected", needs_research: "Needs more research", pending: "Not reviewed" };

export default function EditorialReview() {
  const [picks, setPicks] = useState<Pick[] | null>(null);
  const [notInstalled, setNotInstalled] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/.netlify/functions/stories?view=shortlist");
      if (!res.ok) throw new Error();
      const d = await res.json();
      setNotInstalled(Boolean(d.notInstalled));
      setPicks(d.picks ?? []);
    } catch {
      setMsg("Could not load the shortlist.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (id: string, decision: "approved" | "rejected" | "needs_research") => {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/.netlify/functions/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId: id, decision, notes, acknowledged: ack }),
      });
      if (!res.ok) throw new Error();
      setMsg(decision === "approved" ? "Approved. It is now available in the Prompt Architect." : decision === "rejected" ? "Rejected." : "Marked as needing more research.");
      setOpen(null);
      setAck(false);
      setNotes("");
      await load();
    } catch {
      setMsg("The decision was NOT saved. Try again, or check System Health.");
    }
    setBusy(false);
  };

  return (
    <section>
      <h1>Editorial Review</h1>
      <p className="status">Nothing moves forward without your decision. Approval means "cleared for drafting", not "verified": claims have not been checked yet.</p>
      {msg && <p className="status">{msg}</p>}
      {notInstalled && <div className="panel"><p className="caution">One-time setup needed: run supabase/migrations/002_scoring.sql in the Supabase SQL Editor, then click RUN RESEARCH.</p></div>}
      {picks && picks.length === 0 && !notInstalled && <div className="panel"><p>Nothing to review yet. Click RUN RESEARCH on the Dashboard.</p></div>}
      {picks?.map((s) => (
        <div className="panel story" key={s.id}>
          <p className="rank">#{s.rank} · {STATUS[s.editorialStatus ?? "pending"]}</p>
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
                <button className="primary" disabled={!ack || busy} onClick={() => void decide(s.id, "approved")}>CONFIRM APPROVAL</button>
                <button onClick={() => { setOpen(null); setAck(false); }}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="actions">
              <button className="primary" onClick={() => { setOpen(s.id); setAck(false); }} disabled={s.editorialStatus === "approved"}>Approve…</button>
              <button onClick={() => void decide(s.id, "rejected")} disabled={busy}>Reject</button>
              <button onClick={() => void decide(s.id, "needs_research")} disabled={busy}>Needs more research</button>
              <Link to={`/evidence/${s.id}`}>Open sources</Link>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

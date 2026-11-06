import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

type Stage = { stage: string; status: string; error: string | null; finished: number | null; total: number | null; healthy: number | null; problems: number | null; items: number | null; newItems: number | null; refreshedItems: number | null; stories: number | null; multiSource: number | null; shortlisted: number | null; candidates: number | null };
type RunHistory = { id: string; status: string; created_at: string; completed_at: string | null; config: { windowDays?: number; region?: string }; newItems: number; refreshedItems: number; stories: number; newStories: number; shortlisted: number };
type Status = {
  history: RunHistory[];
  latest: { id: string; status: string; error_summary: string | null; created_at: string; completed_at: string | null } | null;
  stages: Stage[];
  counts: { awaitingReview: number; approved: number; stories: number; multiOutlet: number; sourcesHealthy: number; sourcesNeedAttention: number; sourcesUntested: number; sourcesTotal: number };
  regions: { region: string; healthy: number; total: number }[];
};

const LABEL: Record<string, string> = {
  prepare: "Load built-in sources",
  discover: "Check sources and collect stories",
  cluster: "Group coverage into stories",
  rank: "Score stories and build the shortlist",
};

const newKey = () => crypto.randomUUID().replace(/-/g, "");

function describe(s: Stage) {
  if (s.status === "completed" && s.stage === "discover")
    return `${s.healthy} of ${s.total} sources reachable · ${s.newItems ?? 0} new · ${s.refreshedItems ?? 0} refreshed${s.problems ? ` · ${s.problems} need attention` : ""}`;
  if (s.status === "completed" && s.stage === "cluster") return `${s.stories} stories (${s.multiSource} covered by more than one outlet)`;
  if (s.status === "completed" && s.stage === "rank") return `${s.shortlisted} stories shortlisted from ${s.candidates} candidates`;
  if (s.status === "running" && s.stage === "discover") return `${s.finished ?? 0} of ${s.total ?? "…"} sources checked`;
  if (s.status === "failed") return `Failed: ${s.error}`;
  return s.status === "pending" ? "Waiting" : s.status === "completed" ? "Done" : "Working…";
}

export default function Dashboard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [bad, setBad] = useState(false);
  const [viewCleared, setViewCleared] = useState(false);
  const [windowDays, setWindowDays] = useState("3");
  const [region, setRegion] = useState("all");
  const lock = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/.netlify/functions/status");
      if (!res.ok) throw new Error();
      const data: Status = await res.json();
      setStatus(data);
      setStages(data.stages);
      setViewCleared(false);
    } catch {
      setMsg("Could not load the latest status.");
      setBad(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const unfinished = status?.latest && ["created", "running", "incomplete"].includes(status.latest.status);

  const run = async () => {
    if (lock.current) return; // ignore double clicks while a run is in progress
    lock.current = true;
    setViewCleared(false);
    setBusy(true);
    setBad(false);
    setMsg("Starting…");
    try {
      const start = await fetch("/.netlify/functions/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: newKey(), windowDays: Number(windowDays), region }),
      });
      if (!start.ok) throw new Error("start");
      const { run, resumed } = await start.json();
      setMsg(resumed ? "Resuming the unfinished run…" : "Run started.");
      for (let i = 0; i < 60; i++) {
        const res = await fetch("/.netlify/functions/run-step", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId: run.id }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data) throw new Error("step");
        if (data.stages) setStages(data.stages);
        if (data.error) {
          setBad(true);
          setMsg(`Stopped: ${data.error}. Completed work is saved. Click Resume to continue.`);
          break;
        }
        if (data.done) {
          setMsg("Research run finished.");
          break;
        }
      }
    } catch {
      setBad(true);
      setMsg("Connection problem. Progress is saved. Click again to resume.");
    }
    await load();
    setBusy(false);
    lock.current = false;
  };

  const c = status?.counts;
  return (
    <section>
      <h1>Dashboard</h1>
      <div className="panel hero">
        <div className="row" style={{ alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <button className="primary big" onClick={() => void run()} disabled={busy}>
          {busy ? "RESEARCH RUNNING…" : unfinished ? "RESUME RESEARCH" : "RUN RESEARCH"}
        </button>
        <label>Coverage window<select value={windowDays} onChange={(e) => setWindowDays(e.target.value)} disabled={busy}><option value="1">Past 24 hours</option><option value="3">Past 3 days</option><option value="7">Past 7 days</option><option value="14">Past 14 days</option></select></label>
        <label>Region<select value={region} onChange={(e) => setRegion(e.target.value)} disabled={busy}><option value="all">All regions</option>{["Africa","Asia","Europe","Latin America","Middle East","North America","Oceania"].map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
        <button type="button" onClick={() => { if (window.confirm("Clear the current Dashboard view? Saved stories, editions and research history will not be deleted.")) { setStatus(null); setStages([]); setMsg(""); setBad(false); setViewCleared(true); } }} disabled={busy || (!status && stages.length === 0 && !msg)}>CLEAR RESULTS</button>
        </div>
        <p>The desk checks its configured source registry and coverage. You review what it discovers; a new run refreshes the feed items it finds.</p>
        {viewCleared && <p className="status">Dashboard results cleared from this view. Saved stories and research history remain available in Story Desk.</p>}
        {msg && <p className={bad ? "status bad" : "status"}>{msg}</p>}
        {!viewCleared && stages.some((s) => s.status !== "pending") && (
          <ol className="steps">
            {stages.map((s) => (
              <li key={s.stage} className={s.status}>
                <strong>{LABEL[s.stage] ?? s.stage}</strong>
                <span>{describe(s)}</span>
              </li>
            ))}
          </ol>
        )}
        {!viewCleared && status?.latest?.error_summary && !busy && <p className="status bad">Last run note: {status.latest.error_summary}</p>}
        {!viewCleared && (msg + (status?.latest?.error_summary ?? "")).includes("002_scoring.sql") && (
          <p className="caution">One-time setup needed: open Supabase, go to SQL Editor, paste the contents of supabase/migrations/002_scoring.sql from your repo, run it, then click Resume.</p>
        )}
      </div>

      {!viewCleared && <div className="grid">
        <div className="panel stat"><span className="stat-label">Stories found</span><span className="stat-value">{c?.stories ?? "—"}</span><span className="stat-note"><Link to="/stories">Open Story Desk</Link></span></div>
        <div className="panel stat"><span className="stat-label">Awaiting your review</span><span className="stat-value">{c?.awaitingReview ?? "—"}</span><span className="stat-note"><Link to="/review">Open Editorial Review</Link> · {c?.approved ?? 0} approved</span></div>
        <div className="panel stat"><span className="stat-label">Covered by 2+ outlets</span><span className="stat-value">{c?.multiOutlet ?? "—"}</span><span className="stat-note">Not the same as independently confirmed</span></div>
        <div className="panel stat"><span className="stat-label">Sources reachable</span><span className="stat-value">{c ? `${c.sourcesHealthy}/${c.sourcesTotal}` : "—"}</span><span className="stat-note">{c && c.sourcesNeedAttention > 0 ? `${c.sourcesNeedAttention} need attention` : c && c.sourcesUntested === c.sourcesTotal ? "Not tested yet" : " "}</span></div>
        <div className="panel stat"><span className="stat-label">Regions with a live source</span><span className="stat-value">{status ? `${status.regions.filter((r) => r.healthy > 0).length}/7` : "—"}</span><span className="stat-note"><Link to="/health">Details in System Health</Link></span></div>
      </div>}

      {!viewCleared && <div className="panel">
        <h2>Recent research runs</h2>
        <p className="meta">New items are URLs not previously stored. Refreshed items were already known; they are not new developments.</p>
        {status?.history?.length ? status.history.map((r) => <div className="source" key={r.id}>
          <strong>{new Date(r.created_at).toLocaleString()}</strong> · {r.status}
          <p className="meta">{r.config?.region && r.config.region !== "all" ? r.config.region : "All regions"} · {r.config?.windowDays ?? 3}-day window · {r.newItems} new feed items · {r.refreshedItems} refreshed · {r.newStories} new story clusters · {r.shortlisted} shortlisted</p>
        </div>) : <p>No research history yet.</p>}
      </div>}

      <div className="panel">
        <h2>Not built yet</h2>
        <p>Full-text evidence retrieval, claim checking and original-source tracing are still to come. Stories are scored by rules, but every story is <strong>unverified</strong>: only headlines and short summaries have been read.</p>
      </div>
    </section>
  );
}

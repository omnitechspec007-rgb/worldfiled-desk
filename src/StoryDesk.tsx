import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Scores, type Score } from "./Scores";

type Story = { id: string; headline: string; category: string | null; outlets: number; regions: string[]; hasPrimary: boolean; newest: string };
type Pick = Story & { rank: number | null; priority: number; reason: string; flags: string[]; scores: Score[]; editorialStatus?: string };

export default function StoryDesk() {
  const [mode, setMode] = useState<"shortlist" | "all">("shortlist");
  const [picks, setPicks] = useState<Pick[] | null>(null);
  const [held, setHeld] = useState<Pick[]>([]);
  const [notInstalled, setNotInstalled] = useState(false);
  const [all, setAll] = useState<Story[] | null>(null);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [region, setRegion] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/.netlify/functions/stories?view=shortlist");
        if (!res.ok) throw new Error();
        const d = await res.json();
        if (d.notInstalled) setNotInstalled(true);
        setPicks(d.picks ?? []);
        setHeld(d.heldBack ?? []);
      } catch {
        setErr("Could not load the shortlist.");
      }
    })();
  }, []);

  useEffect(() => {
    if (mode !== "all" || all) return;
    (async () => {
      try {
        const res = await fetch("/.netlify/functions/stories");
        if (!res.ok) throw new Error();
        const d = await res.json();
        setAll(d.stories);
        setTotal(d.total);
      } catch {
        setErr("Could not load stories.");
      }
    })();
  }, [mode, all]);

  const regions = useMemo(() => [...new Set((all ?? []).flatMap((s) => s.regions))].sort(), [all]);
  const shown = (all ?? []).filter((s) => (!q || s.headline.toLowerCase().includes(q.toLowerCase())) && (!region || s.regions.includes(region)));

  return (
    <section>
      <h1>Story Desk</h1>
      <div className="tabs">
        <button className={mode === "shortlist" ? "tab on" : "tab"} onClick={() => setMode("shortlist")}>Shortlist</button>
        <button className={mode === "all" ? "tab on" : "tab"} onClick={() => setMode("all")}>All stories</button>
      </div>
      {err && <p className="status bad">{err}</p>}

      {mode === "shortlist" && picks && (
        <>
          {notInstalled && <div className="panel"><p className="caution">One-time setup needed: run supabase/migrations/002_scoring.sql in the Supabase SQL Editor, then click RUN RESEARCH.</p></div>}
          {!notInstalled && picks.length === 0 && <div className="panel"><p>No shortlist yet. Click RUN RESEARCH on the Dashboard.</p></div>}
          {picks.length > 0 && <p className="status">Ranked by rules, with every score and its reason shown separately. Curiosity is an <strong>editorial hypothesis</strong>, not proof of interest, and never a measure of truth.</p>}
          {picks.map((s) => (
            <div className="panel story" key={s.id}>
              <p className="rank">#{s.rank}</p>
              <h2><Link to={`/evidence/${s.id}`}>{s.headline}</Link></h2>
              <p className="meta">{s.category ?? "Uncategorised"} · {s.regions?.join(", ")} · {s.outlets === 1 ? "single outlet" : `${s.outlets} outlets`}{s.hasPrimary ? " · includes an official source" : ""}</p>
              <p className="why"><strong>Why selected:</strong> {s.reason}</p>
              {s.flags.map((f) => <p className="caution" key={f}>⚠ {f}</p>)}
              <Scores scores={s.scores} compact />
            </div>
          ))}
          {held.length > 0 && (
            <div className="panel">
              <h2>Significant, but not selected</h2>
              <p className="meta">Nothing major is dropped silently. These were held back for the reason shown.</p>
              {held.map((s) => (
                <div className="source" key={s.id}>
                  <Link to={`/evidence/${s.id}`}>{s.headline}</Link>
                  <p className="meta">{s.reason}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {mode === "all" && all && (
        <>
          <p className="status">Showing {shown.length} of {total} stories, in no quality order (more outlets first, then newest).</p>
          <div className="row">
            <label>Search<input value={q} onChange={(e) => setQ(e.target.value)} /></label>
            <label>Region<select value={region} onChange={(e) => setRegion(e.target.value)}><option value="">All</option>{regions.map((r) => <option key={r}>{r}</option>)}</select></label>
          </div>
          {shown.map((s) => (
            <Link to={`/evidence/${s.id}`} key={s.id} className="panel story">
              <h2>{s.headline}</h2>
              <p className="meta">{s.category ?? "Uncategorised"} · {s.regions.join(", ")} · {s.outlets === 1 ? "single outlet" : `${s.outlets} outlets`}</p>
            </Link>
          ))}
        </>
      )}
    </section>
  );
}

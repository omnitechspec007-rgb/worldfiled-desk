import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

type Story = { id: string; headline: string; category: string | null; outlets: number; sourceCount: number; regions: string[]; hasPrimary: boolean; newest: string };

export default function StoryDesk() {
  const [stories, setStories] = useState<Story[] | null>(null);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [region, setRegion] = useState("");
  const [multi, setMulti] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/.netlify/functions/stories");
        if (!res.ok) throw new Error();
        const d = await res.json();
        setStories(d.stories);
        setTotal(d.total);
      } catch {
        setErr("Could not load stories.");
      }
    })();
  }, []);

  const regions = useMemo(() => [...new Set((stories ?? []).flatMap((s) => s.regions))].sort(), [stories]);
  const shown = (stories ?? []).filter(
    (s) => (!q || s.headline.toLowerCase().includes(q.toLowerCase())) && (!region || s.regions.includes(region)) && (!multi || s.outlets > 1)
  );

  return (
    <section>
      <h1>Story Desk</h1>
      {err && <p className="status bad">{err}</p>}
      {stories && (
        <>
          <p className="status">
            Showing {shown.length} of {total} stories. Order is provisional: more outlets first, then newest. It is <strong>not a quality or importance score</strong>.
          </p>
          <div className="row">
            <label>Search<input value={q} onChange={(e) => setQ(e.target.value)} /></label>
            <label>Region
              <select value={region} onChange={(e) => setRegion(e.target.value)}>
                <option value="">All</option>
                {regions.map((r) => <option key={r}>{r}</option>)}
              </select>
            </label>
            <label className="inline"><input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} /> 2+ outlets only</label>
          </div>
          {shown.length === 0 && <div className="panel"><p>No stories yet. Click RUN RESEARCH on the Dashboard.</p></div>}
          {shown.map((s) => (
            <Link to={`/evidence/${s.id}`} key={s.id} className="panel story">
              <h2>{s.headline}</h2>
              <p className="meta">
                {s.category ?? "Uncategorised"} · {s.regions.join(", ")} · {s.outlets === 1 ? "single outlet" : `${s.outlets} outlets`}
                {s.hasPrimary ? " · includes an official or primary source" : ""}
              </p>
              {s.outlets === 1 && <p className="caution">Reported by one outlet only. Treat as unconfirmed.</p>}
            </Link>
          ))}
        </>
      )}
    </section>
  );
}

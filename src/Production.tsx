import { useEffect, useState } from "react";

type Story = { id: string; headline: string; category: string | null; outlets: number };
type Card = { storyId: string; headline: string; category: string | null; attribution: string | null; outlets: string[]; links: { outlet: string; url: string }[] };

export default function Production() {
  const [stories, setStories] = useState<Story[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [pkg, setPkg] = useState<{ cards: Card[]; caption: string; prompt: string; note: string } | null>(null);
  const [duration, setDuration] = useState<60 | 90>(60);
  const [angle, setAngle] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/.netlify/functions/stories?view=approved");
        if (!res.ok) throw new Error();
        setStories((await res.json()).stories);
      } catch {
        setMsg("Could not load approved stories.");
      }
    })();
  }, []);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < 5 ? [...p, id] : p));

  const make = async () => {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/.netlify/functions/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyIds: picked, durationSeconds: duration, angle }),
      });
      const d = await res.json();
      if (res.status === 409) setMsg("One of these stories is no longer approved. Nothing was exported.");
      else if (!res.ok) setMsg("Could not create the draft.");
      else setPkg(d);
    } catch {
      setMsg("Could not create the draft.");
    }
    setBusy(false);
  };

  return (
    <section>
      <h1>Production Studio</h1>
      <p className="status">Only stories you approved appear here. Creating a draft is recorded in the audit trail.</p>
      {msg && <p className="status bad">{msg}</p>}
      {stories && stories.length === 0 && <div className="panel"><p>No approved stories yet. Approve one in Editorial Review.</p></div>}
      {stories && stories.length > 0 && (
        <div className="panel">
          <h2>Choose up to 5 stories for one card stack</h2>
          {stories.map((s) => (
            <label key={s.id} className="inline pick">
              <input type="checkbox" checked={picked.includes(s.id)} onChange={() => toggle(s.id)} />
              {s.headline}
            </label>
          ))}
          <div className="row">
            <label>Video length<select value={duration} onChange={(e) => setDuration(Number(e.target.value) as 60 | 90)}><option value={60}>60 seconds</option><option value={90}>90 seconds</option></select></label>
            <label>Angle (optional)<input value={angle} maxLength={160} onChange={(e) => setAngle(e.target.value)} placeholder="e.g. what this means for ordinary families" /></label>
          </div>
          <button className="primary" disabled={picked.length === 0 || busy} onClick={() => void make()}>{busy ? "CREATING…" : "CREATE DRAFT"}</button>
        </div>
      )}
      {pkg && (
        <>
          <div className="panel">
            <p className="caution">{pkg.note}</p>
            <div className="phone">
              {pkg.cards.map((c) => (
                <div className="card" key={c.storyId}>
                  <strong>{c.headline}</strong>
                  {c.attribution && <span>{c.attribution}</span>}
                  <em>{c.outlets.join(" · ")}</em>
                </div>
              ))}
              <small>The World, Filed.</small>
            </div>
            <p className="meta">Layout guide: one static 9:16 composition. All cards visible for the full six seconds. No transitions, no reveals, no intro or closing card. Logo small. Source links go in the caption.</p>
          </div>
          <div className="panel">
            <h2>Prompt for Claude</h2>
            <p className="meta">Copy this into a new Claude chat. It contains only the approved stories' collected facts, the house format, and rules against inventing anything. Read the output against the sources before you publish.</p>
            <textarea readOnly value={pkg.prompt} rows={14} />
            <button className="primary" onClick={() => void navigator.clipboard?.writeText(pkg.prompt)}>Copy prompt</button>
          </div>
          <div className="panel">
            <h2>Caption with sources</h2>
            <textarea readOnly value={pkg.caption} rows={10} />
            <button onClick={() => void navigator.clipboard?.writeText(pkg.caption)}>Copy caption</button>
          </div>
        </>
      )}
    </section>
  );
}

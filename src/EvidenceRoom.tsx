import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Scores, type Score } from "./Scores";

type Src = { id: string; title: string; url: string; outlet: string; scope: string | null; region: string; tier: string; publishedAt: string | null; retrievedAt: string | null; depth: string; summary?: string | null };
type Decision = { decision: string; notes: string | null; created_at: string };
type Story = { id: string; headline: string; category: string | null; outlets: number; regions: string[]; sources: Src[]; scores?: Score[]; decisions?: Decision[]; editorialStatus?: string };

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString() : "date not given by source");

export default function EvidenceRoom() {
  const { id } = useParams();
  const [story, setStory] = useState<Story | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!id) return;
    setStory(null);
    (async () => {
      try {
        const res = await fetch(`/.netlify/functions/stories?id=${encodeURIComponent(id)}`);
        if (!res.ok) throw new Error();
        setStory((await res.json()).story);
      } catch {
        setErr("Could not load this story.");
      }
    })();
  }, [id]);

  if (!id)
    return (
      <section>
        <h1>Evidence Room</h1>
        <div className="panel"><p>Pick a story in the <Link to="/stories">Story Desk</Link> to inspect its sources.</p></div>
      </section>
    );

  return (
    <section>
      <h1>Evidence Room</h1>
      {err && <p className="status bad">{err}</p>}
      {story && (
        <>
          <div className="panel"><h2>{story.headline}</h2><p className="meta">{story.category ?? "Uncategorised"} · {story.regions.join(", ")}</p></div>
          <div className="panel">
            <h2>Sources ({story.sources.length} items from {story.outlets} outlet{story.outlets === 1 ? "" : "s"})</h2>
            <p className="caution">Only headlines and short summaries were collected. The full articles were <strong>not</strong> read, so no claim here is checked yet.</p>
            {story.sources.map((s) => (
              <div className="source" key={s.id}>
                <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>
                <p className="meta">{s.outlet} · {s.scope ?? s.region} · {s.tier === "primary" ? "official or primary source" : "news reporting"}</p>
                <p className="meta">Published: {fmt(s.publishedAt)} · Retrieved: {fmt(s.retrievedAt)} · Depth: {s.depth === "metadata_only" ? "headline and summary only" : s.depth}</p>
                {s.summary && <p className="summary">{s.summary}</p>}
              </div>
            ))}
          </div>
          <div className="panel">
            <h2>Scores and reasons</h2>
            <Scores scores={story.scores ?? []} />
            {story.decisions && story.decisions.length > 0 && (
              <>
                <h3>Your decisions</h3>
                {story.decisions.map((d, i) => <p className="meta" key={i}>{new Date(d.created_at).toLocaleString()}: {d.decision.replace("_", " ")}{d.notes ? ` — ${d.notes}` : ""}</p>)}
              </>
            )}
          </div>
          <div className="panel">
            <h2>Independence and verification</h2>
            <p>Not assessed yet. Several outlets covering the same event are not independent confirmation: they may all repeat one announcement. Original-source tracing and claim checking are still to be built.</p>
          </div>
        </>
      )}
    </section>
  );
}

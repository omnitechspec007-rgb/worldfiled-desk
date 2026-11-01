import { useEffect, useState } from "react";

type Video = { id: string; label: string; original_filename: string; duration_seconds: number | null; width: number | null; height: number | null; inspection_level: string; inspection_notes: string; unknowns: string[] };
type Rule = { id: string; rule_key: string; version: number; category: string; statement: string; evidence_basis: string; evidence_note: string; status: "PROPOSED" | "APPROVED" | "REJECTED" };

const BASIS: Record<string, string> = { file_probe: "verified from the file", visual_observation: "seen by eye in sampled frames (not fully verified)", inference: "inference", user_stated: "your own statement" };

export default function ReferenceLibrary() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [missing, setMissing] = useState(false);
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const r = await fetch("/.netlify/functions/reference");
      if (!r.ok) throw new Error();
      const d = await r.json();
      setMissing(!!d.notInstalled);
      setVideos(d.videos ?? []);
      setRules(d.rules ?? []);
    } catch {
      setMsg("Could not load the Reference Library.");
    }
  };
  useEffect(() => { void load(); }, []);

  const post = async (body: unknown) => {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/.netlify/functions/reference", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) setMsg(d.detail ?? "That did not work.");
      await load();
    } catch {
      setMsg("That did not work.");
    }
    setBusy(false);
  };

  const latest = new Map<string, Rule>();
  for (const r of rules) if (!latest.has(r.rule_key) || latest.get(r.rule_key)!.version < r.version) latest.set(r.rule_key, r);
  const shown = [...latest.values()];

  return (
    <section>
      <h1>Reference Library</h1>
      <p className="meta">What the reference videos taught us, as rules you control. Analysis only: no video is stored or processed here. A rule is used in prompts only after you approve it.</p>
      {msg && <p className="status bad">{msg}</p>}
      {missing && <div className="panel"><p className="status bad">NOT INSTALLED: the Reference Library needs migration 003, which has not been run yet.</p></div>}
      {!missing && rules.length === 0 && (
        <div className="panel">
          <p>The library is empty. Load the proposed rules from your four reference videos. They load as PROPOSED, and nothing is used until you approve it.</p>
          <button className="primary" disabled={busy} onClick={() => void post({ action: "seed" })}>LOAD PROPOSED RULES</button>
        </div>
      )}
      {videos.length > 0 && (
        <div className="panel">
          <h2>Reference videos</h2>
          {videos.map((v) => (
            <details key={v.id}>
              <summary>{v.label} · {v.duration_seconds ? `${Number(v.duration_seconds).toFixed(0)} s` : "length unknown"} · {v.inspection_level.replace(/_/g, " ")}</summary>
              <p className="meta">{v.inspection_notes}</p>
              <p className="meta">Not known: {(v.unknowns ?? []).join("; ")}.</p>
            </details>
          ))}
          <p className="meta">No video was fully inspected. Length, size, frame rate, cuts and audio level were measured from the files; layout was seen in sampled frames only.</p>
        </div>
      )}
      {shown.length > 0 && (
        <div className="panel">
          <h2>Style rules</h2>
          {shown.map((r) => (
            <div className="source" key={r.id}>
              <p><span className={r.status === "APPROVED" ? "chip on" : r.status === "REJECTED" ? "chip bad" : "chip"}>{r.status}</span> <strong>{r.category}</strong> · v{r.version}</p>
              {editing === r.id ? (
                <>
                  <textarea rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
                  <div className="actions">
                    <button className="primary" disabled={busy} onClick={() => void post({ action: "revise", id: r.id, statement: text }).then(() => setEditing(null))}>Save as new proposed version</button>
                    <button onClick={() => setEditing(null)}>Cancel</button>
                  </div>
                </>
              ) : (
                <>
                  <p className="why">{r.statement}</p>
                  <p className="meta">Evidence: {BASIS[r.evidence_basis] ?? r.evidence_basis}. {r.evidence_note}</p>
                  <div className="actions">
                    {r.status === "PROPOSED" && <button className="primary" disabled={busy} onClick={() => void post({ action: "decide", id: r.id, status: "APPROVED" })}>Approve</button>}
                    {r.status === "PROPOSED" && <button disabled={busy} onClick={() => void post({ action: "decide", id: r.id, status: "REJECTED" })}>Reject</button>}
                    <button disabled={busy} onClick={() => { setEditing(r.id); setText(r.statement); }}>Edit wording</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

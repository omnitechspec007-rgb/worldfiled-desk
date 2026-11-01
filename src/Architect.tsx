import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

type Story = { id: string; headline: string };
type Role = { role: string; why: string };
type Preview = {
  headline: string;
  recommended: { key: string; label: string; reason: string; approach: string; roles: Role[]; voice: string; visual: string; hook: string };
  alternatives: { key: string; label: string }[];
  allTreatments: { key: string; label: string }[];
  deliverables: { key: string; label: string }[];
  curiosity: { score: number; patterns: { label: string; why: string }[] };
  evidence: { sources: number; omitted: number; classes: Record<string, number> };
};
type Result = {
  saved: boolean;
  notInstalled?: boolean;
  note?: string;
  id?: string;
  version?: number;
  treatment: { key: string; label: string; recommended: boolean };
  roles: Role[];
  rationale: any;
  tools: { needed: { name: string; repo: string; why: string }[]; optional: { name: string }[]; notNeeded: { name: string; reason: string }[]; note: string };
  evidenceClasses: Record<string, number>;
  brandChecklist: string[];
  prompt: string;
};

export default function Architect() {
  const [params] = useSearchParams();
  const [stories, setStories] = useState<Story[] | null>(null);
  const [storyId, setStoryId] = useState(params.get("story") ?? "");
  const [pv, setPv] = useState<Preview | null>(null);
  const [treatment, setTreatment] = useState("");
  const [deliverable, setDeliverable] = useState("script_storyboard");
  const [duration, setDuration] = useState(60);
  const [angle, setAngle] = useState("");
  const [conflict, setConflict] = useState("");
  const [res, setRes] = useState<Result | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/.netlify/functions/stories?view=approved");
        if (!r.ok) throw new Error();
        setStories((await r.json()).stories);
      } catch {
        setMsg("Could not load approved stories.");
      }
    })();
  }, []);

  useEffect(() => {
    setPv(null);
    setRes(null);
    if (!storyId) return;
    (async () => {
      try {
        const r = await fetch(`/.netlify/functions/creative?storyId=${storyId}`);
        if (r.status === 409) return setMsg("This story is no longer approved, so no prompt can be made.");
        if (!r.ok) throw new Error();
        const d: Preview = await r.json();
        setMsg("");
        setPv(d);
        setTreatment(d.recommended.key);
      } catch {
        setMsg("Could not load the recommendation.");
      }
    })();
  }, [storyId]);

  const generate = async () => {
    setBusy(true);
    setMsg("");
    setCopied(false);
    try {
      const r = await fetch("/.netlify/functions/creative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId, treatmentKey: treatment, deliverable, durationSeconds: duration, angle, conflictNote: conflict, parentId: res?.id }),
      });
      const d = await r.json();
      if (r.status === 409) setMsg(d.detail ?? "This story is no longer approved. Nothing was created.");
      else if (!r.ok) setMsg(d.detail ?? "Could not create the prompt.");
      else setRes(d);
    } catch {
      setMsg("Could not create the prompt.");
    }
    setBusy(false);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(res!.prompt);
      setCopied(true);
    } catch {
      setMsg("Copy was blocked by the browser. Select the text in the box and copy it manually.");
    }
  };

  return (
    <section>
      <h1>Prompt Architect</h1>
      <p className="meta">Builds a story-specific production prompt for Claude from an approved story. It does not make, voice or publish any content.</p>
      {msg && <p className="status bad">{msg}</p>}
      {stories && stories.length === 0 && <div className="panel"><p>No approved stories yet. Approve one in Editorial Review.</p></div>}
      {stories && stories.length > 0 && (
        <div className="panel">
          <h2>1. Choose an approved story</h2>
          {stories.map((s) => (
            <label key={s.id} className="inline pick">
              <input type="radio" name="story" checked={storyId === s.id} onChange={() => setStoryId(s.id)} />
              {s.headline}
            </label>
          ))}
        </div>
      )}
      {pv && (
        <>
          <div className="panel">
            <h2>2. Recommended approach</h2>
            <p><strong>{pv.recommended.label}</strong></p>
            <p className="why">{pv.recommended.reason}</p>
            <h3>Recommended team</h3>
            <ul className="comps">{pv.recommended.roles.map((r) => <li key={r.role}><strong>{r.role}</strong>: {r.why}</li>)}</ul>
            <h3>Audience curiosity angle</h3>
            <p className="meta"><span className="chip">EDITORIAL HYPOTHESIS</span> {pv.curiosity.patterns.length ? pv.curiosity.patterns.map((p) => p.label).join(", ") : "no curiosity pattern detected"} · rule-based score {pv.curiosity.score}/100. Not measured audience behaviour.</p>
            <h3>Opening idea</h3><p className="why">{pv.recommended.hook}</p>
            <h3>Visual treatment</h3><p className="why">{pv.recommended.visual}</p>
            <h3>Voiceover direction</h3><p className="why">{pv.recommended.voice}</p>
            <h3>Evidence this prompt will carry</h3>
            <p className="meta">{pv.evidence.sources} source(s) included{pv.evidence.omitted ? `, ${pv.evidence.omitted} left out and named in the prompt` : ""}. Classes: {Object.entries(pv.evidence.classes).map(([k, v]) => `${k.replace(/_/g, " ")} ×${v}`).join(", ")}. Headlines and short snippets only; full articles were not read.</p>
          </div>
          <div className="panel">
            <h2>3. Adjust (optional) and create the prompt</h2>
            <div className="row">
              <label>Creative approach
                <select value={treatment} onChange={(e) => setTreatment(e.target.value)}>
                  {pv.allTreatments.map((t) => <option key={t.key} value={t.key}>{t.label}{t.key === pv.recommended.key ? " (recommended)" : ""}</option>)}
                </select>
              </label>
              <label>What Claude should produce
                <select value={deliverable} onChange={(e) => setDeliverable(e.target.value)}>
                  {pv.deliverables.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                </select>
              </label>
              <label>Length
                <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                  <option value={30}>30 seconds</option><option value={60}>60 seconds</option><option value={90}>90 seconds</option>
                </select>
              </label>
            </div>
            <div className="row stack">
              <label>Angle (optional)<input value={angle} maxLength={160} onChange={(e) => setAngle(e.target.value)} placeholder="e.g. what this means for ordinary families" /></label>
              <label>If the sources disagree, describe how (optional)<textarea rows={3} maxLength={600} value={conflict} onChange={(e) => setConflict(e.target.value)} placeholder="The app cannot detect conflicts itself. Anything you write is labelled as your note." /></label>
            </div>
            <button className="primary" disabled={busy} onClick={() => void generate()}>{busy ? "CREATING…" : res ? "REGENERATE PROMPT" : "CREATE CLAUDE PROMPT"}</button>
            <p className="meta">Regenerating makes a new version. No research is re-run.</p>
          </div>
        </>
      )}
      {res && (
        <>
          {res.notInstalled && <p className="status bad">{res.note}</p>}
          {res.saved && <p className="status good">Saved to Prompt History as version {res.version}.</p>}
          <div className="panel">
            <h2>Tools Claude was told to use</h2>
            {res.tools.needed.length === 0 ? <p>No additional tool is required for this deliverable.</p> : <ul className="comps">{res.tools.needed.map((t) => <li key={t.name}><strong>{t.name}</strong>: {t.why}</li>)}</ul>}
            <p className="meta">Not needed: {res.tools.notNeeded.map((n) => n.name).join("; ")}.</p>
          </div>
          <div className="panel">
            <h2>Brand compliance (checked separately from facts)</h2>
            <ul className="comps">{res.brandChecklist.map((c) => <li key={c}>{c}</li>)}</ul>
            <p className="meta">Claude answers this checklist in its output. Review it against the result.</p>
          </div>
          <div className="panel">
            <h2>Your Claude prompt</h2>
            <p className="meta">Copy it into a new Claude chat. If you have it, also attach the official logo file (Download official logo, in the left menu).</p>
            <textarea readOnly value={res.prompt} rows={16} />
            <button className="primary" onClick={() => void copy()}>{copied ? "Copied" : "Copy prompt"}</button>
          </div>
        </>
      )}
    </section>
  );
}

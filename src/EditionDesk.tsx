import { Fragment, useCallback, useEffect, useRef, useState } from "react";

type Loc = { country: string; basis: string };
type Dev = {
  id: string; headline: string; decision: string | null; type: string; recommendation: string; recommendationWhy: string; curiosityScore: number;
  evidenceStrength: { label: string; why: string }; corroborated: boolean; whatChanged: string; whyInteresting: string[]; audienceQuestion: string;
  surprisingElement: string | null; humanConsequences: string | null; possibleImplications: string | null; missingEvidence: string[]; sensationalismFlags: string[];
  hypothesisNote: string; themes: string[]; locations: Loc[]; geographicInterest: string; outlets: number;
};
type Comp = { name: string; points: number; max: number; why: string };
type Evaluation = {
  ids: string[]; structure: string; structureLabel: string; suggestedStructure?: string; structureOverride?: boolean; theme: string; catalyst: string | null; title: string; angle: string;
  coherence: { score: number | null; verdict: string; components: Comp[] };
  metrics: { curiosityPotential: number; evidenceStrength: { label: string; weakest: string }; timelinessHours: number | null; humanRelevance: number };
  locations: { country: string; basis: string }[];
  sequence: { id: string; headline: string; role: string; why: string }[];
  contributions: { id: string; headline: string; adds: string }[];
  whyItMatters: string; uncertainties: string[];
  check: { belongTogether: string; centralArgument: string; strongestOpening: string; logicalSequence: string; repetition: string[]; geographicDimension: string; mapUseful: boolean; mapWhy: string; valueVersusSeparate: string; weaklyConnected: { id: string; headline: string; why: string }[]; conflicts: string[]; recommendations: string[] };
};
type Sug = Evaluation & { key: string; excluded: { id: string; headline: string; reason: string }[] };
type Desk = {
  note: string; developments: Dev[]; suggestions: Sug[]; weakConnections: Sug[];
  unmatched: { id: string; headline: string; recommendation: string; why: string }[]; ineligible: { id: string; headline: string; reason: string }[];
  saved: { installed: boolean; editions: { id: string; title: string; structureLabel: string; verdict: string | null; score: number | null; members: number; updatedAt: string; decision: string | null; approvalCurrent: boolean }[] };
};
type Approval = { decision: string | null; notes: string | null; current: boolean; membersChangedSinceApproval: boolean; blockedMembers: string[] };
type PromptResult = { saved: boolean; notInstalled?: boolean; note?: string; id?: string; version?: number; prompt: string; roles: { role: string; why: string }[]; tools: { needed: { name: string }[]; note: string }; brandChecklist: string[] };

const STRUCTS = [["multi_country", "Multi-country synthesis"], ["single_country", "Single-country deep dive"], ["event_roundup", "Event-driven thematic roundup"]];
const api = "/.netlify/functions/";
const post = (fn: string, body: unknown) => fetch(api + fn, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const tone = (v: string) => (v === "COHERENT" ? "ok" : v === "SINGLE DEVELOPMENT" ? "" : "bad");

export default function EditionDesk() {
  const [desk, setDesk] = useState<Desk | null>(null);
  const [tab, setTab] = useState<"suggested" | "developments" | "mine">("suggested");
  const [msg, setMsg] = useState("");
  const [inspect, setInspect] = useState<string | null>(null);
  const [rejectedLinks, setRejectedLinks] = useState<string[]>([]);
  // workspace
  const [ids, setIds] = useState<string[]>([]);
  const [editionId, setEditionId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [angle, setAngle] = useState("");
  const [structure, setStructure] = useState("");
  const [ev, setEv] = useState<Evaluation | null>(null);
  const [prevScore, setPrevScore] = useState<{ score: number | null; verdict: string } | null>(null);
  const [devs, setDevs] = useState<Dev[]>([]);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [ack, setAck] = useState(false);
  const [notes, setNotes] = useState("");
  const [deliverable, setDeliverable] = useState("script_storyboard");
  const [duration, setDuration] = useState(90);
  const [pAngle, setPAngle] = useState("");
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [res, setRes] = useState<PromptResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const lastEv = useRef<Evaluation | null>(null);

  const loadDesk = useCallback(async () => {
    try {
      const r = await fetch(api + "editions");
      if (!r.ok) throw new Error();
      setDesk(await r.json());
    } catch { setMsg("Could not load the Edition Desk."); }
  }, []);
  useEffect(() => { void loadDesk(); }, [loadDesk]);

  // live coherence check whenever the chosen developments or structure change
  useEffect(() => {
    if (!ids.length) { setEv(null); setDevs([]); lastEv.current = null; return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`${api}editions?ids=${ids.join(",")}${structure ? `&structure=${structure}` : ""}`);
        if (!r.ok) throw new Error();
        const d = await r.json();
        if (lastEv.current) setPrevScore({ score: lastEv.current.coherence.score, verdict: lastEv.current.coherence.verdict });
        lastEv.current = d.evaluation;
        setEv(d.evaluation); setDevs(d.developments);
        setConflicts((c) => ids.map((_, i) => c[i] ?? ""));
      } catch { setMsg("Could not check coherence for this selection."); }
    }, 250);
    return () => clearTimeout(t);
  }, [ids, structure]);

  const openSet = (s: { ids: string[]; title: string; angle?: string; structure?: string }, id: string | null = null) => {
    lastEv.current = null; setPrevScore(null);
    setIds(s.ids); setTitle(s.title); setAngle(s.angle ?? ""); setStructure(s.structure ?? ""); setEditionId(id); setApproval(null); setRes(null); setAck(false); setNotes(""); setMsg("");
    setTimeout(() => document.getElementById("workspace")?.scrollIntoView({ behavior: "smooth" }), 50);
  };
  const openSaved = async (id: string) => {
    try {
      const r = await fetch(`${api}editions?id=${id}`);
      if (!r.ok) throw new Error();
      const d = await r.json();
      openSet({ ids: d.ids, title: d.title, angle: d.angle, structure: d.structure }, id);
      setApproval(d.approval);
      if (d.missing?.length) setMsg("Some developments in this edition are no longer available.");
    } catch { setMsg("Could not open that edition."); }
  };
  const move = (i: number, d: number) => setIds((a) => { const b = [...a]; const j = i + d; if (j < 0 || j >= b.length) return a; [b[i], b[j]] = [b[j], b[i]]; return b; });
  const remove = (id: string) => setIds((a) => a.filter((x) => x !== id));
  const add = (id: string) => setIds((a) => (a.includes(id) || a.length >= 12 ? a : [...a, id]));
  const applySequence = () => ev && setIds(ev.sequence.map((s) => s.id));

  const save = async () => {
    setBusy(true); setMsg("");
    try {
      const r = await post("editions", { action: "save", id: editionId ?? undefined, title, ids, angle, structure: structure || undefined });
      const d = await r.json();
      if (!r.ok) setMsg(d.detail ?? "Could not save the edition.");
      else { setEditionId(d.id); setMsg(d.note ?? "Edition saved."); await openSavedQuiet(d.id); void loadDesk(); }
    } catch { setMsg("Could not save the edition."); }
    setBusy(false);
  };
  const openSavedQuiet = async (id: string) => { const r = await fetch(`${api}editions?id=${id}`); if (r.ok) setApproval((await r.json()).approval); };
  const decide = async (decision: string) => {
    if (!editionId) return;
    setBusy(true); setMsg("");
    try {
      const r = await post("editions", { action: "decide", id: editionId, decision, notes, acknowledged: ack });
      const d = await r.json();
      if (!r.ok) setMsg(d.detail ?? "That decision was not saved.");
      else { setMsg(decision === "approved" ? "Edition approved for these exact developments." : "Decision saved."); setAck(false); await openSavedQuiet(editionId); void loadDesk(); }
    } catch { setMsg("That decision was not saved."); }
    setBusy(false);
  };
  const build = async () => {
    if (!editionId) return;
    setBusy(true); setMsg(""); setCopied(false); setRes(null);
    try {
      const r = await post("edition-prompt", { editionId, deliverable, durationSeconds: duration, angle: pAngle, conflictNotes: conflicts, parentId: res?.id });
      const d = await r.json();
      if (!r.ok) setMsg(d.detail ?? "Could not create the prompt.");
      else setRes(d);
    } catch { setMsg("Could not create the prompt."); }
    setBusy(false);
  };
  const copy = async () => { try { await navigator.clipboard.writeText(res!.prompt); setCopied(true); } catch { setMsg("Copy was blocked by the browser. Select the text and copy it manually."); } };

  const shown = (s: Sug) => !rejectedLinks.includes(s.key);
  const devById = (id: string) => desk?.developments.find((d) => d.id === id);
  const SugCard = ({ s, weak }: { s: Sug; weak?: boolean }) => (
    <div className="panel" key={s.key}>
      <p className="rank">{s.structureLabel}{s.catalyst ? ` · ${s.catalyst}` : ""}</p>
      <h3>{s.title}</h3>
      <p className="meta"><span className={`chip ${tone(s.coherence.verdict)}`}>{s.coherence.verdict}{s.coherence.score !== null ? ` ${s.coherence.score}/100` : ""}</span> {s.ids.length} developments · {s.locations.map((l) => l.country).join(", ") || "no place established"} · evidence {s.metrics.evidenceStrength.label} · curiosity {s.metrics.curiosityPotential}/100 (hypothesis) · {s.metrics.timelinessHours !== null ? `newest ${s.metrics.timelinessHours}h old` : "age unknown"}</p>
      <ul className="comps">{s.ids.map((id) => <li key={id}>{s.contributions.find((c) => c.id === id)?.headline ?? id}</li>)}</ul>
      <p className="why"><strong>Why it matters:</strong> {s.whyItMatters}</p>
      <p className="why"><strong>Angle:</strong> {s.angle}</p>
      {s.uncertainties.length > 0 && <p className="caution">Uncertain: {s.uncertainties.slice(0, 2).join(" ")}</p>}
      {s.excluded?.length > 0 && <details><summary>Left out ({s.excluded.length}) and why</summary><ul className="comps">{s.excluded.map((x) => <li key={x.id}><strong>{x.headline}</strong>: {x.reason}</li>)}</ul></details>}
      <div className="actions">
        <button className="primary" onClick={() => openSet({ ids: s.ids, title: s.title, angle: s.angle, structure: s.structure })}>{weak ? "Inspect" : "Open in workspace"}</button>
        {weak && <button onClick={() => setRejectedLinks((r) => [...r, s.key])}>Reject this connection</button>}
      </div>
    </div>
  );

  const canBuild = !!editionId && !!approval?.current;
  return (
    <section>
      <h1>Edition Desk</h1>
      <p className="meta">One integrated production prompt for a whole edition: several developments linked by a real editorial connection. {desk?.note}</p>
      {msg && <p className={`status ${/Could not|not saved|no longer|refus/i.test(msg) ? "bad" : "good"}`}>{msg}</p>}
      {desk && !desk.saved.installed && <div className="panel"><p className="status bad">NOT INSTALLED: saving editions needs migration 004, which has not been run yet. You can still explore suggestions and check coherence.</p></div>}

      <div className="tabs">
        {([["suggested", "Suggested editions"], ["developments", "Developments"], ["mine", "My editions"]] as const).map(([k, l]) => <button key={k} className={tab === k ? "primary" : ""} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {!desk && !msg && <p className="meta">Loading…</p>}

      {desk && tab === "suggested" && (
        <>
          {desk.suggestions.filter(shown).length === 0 && <div className="panel"><p>No coherent edition found in the current research. That is a valid result: do not force one. Run research again, or build one by hand from the Developments tab.</p></div>}
          {desk.suggestions.filter(shown).map((s) => <SugCard key={s.key} s={s} />)}
          {desk.weakConnections.filter(shown).length > 0 && (<><h2>Weak connections (not suggested)</h2><p className="meta">These share some words or places but the evidence for a real link is thin. You can inspect one or reject it.</p>{desk.weakConnections.filter(shown).map((s) => <SugCard key={s.key} s={s} weak />)}</>)}
          {desk.unmatched.length > 0 && (<div className="panel"><h2>Not placed in any edition</h2><ul className="comps">{desk.unmatched.map((u) => <li key={u.id}><strong>{u.headline}</strong> ({u.recommendation}): {u.why}</li>)}</ul></div>)}
          {desk.ineligible.length > 0 && (<details className="panel"><summary>Excluded from editions ({desk.ineligible.length}) and why</summary><ul className="comps">{desk.ineligible.map((u) => <li key={u.id}><strong>{u.headline}</strong>: {u.reason}</li>)}</ul></details>)}
        </>
      )}

      {desk && tab === "developments" && (
        <div className="panel">
          <table>
            <thead><tr><th>Development</th><th>Recommendation</th><th>Curiosity (hypothesis)</th><th>Evidence</th><th>Places</th><th></th></tr></thead>
            <tbody>
              {desk.developments.map((d) => (
                <Fragment key={d.id}>
                  <tr>
                    <td>{d.headline}<div className="meta">{d.type} · {d.decision ?? "not yet reviewed"}</div></td>
                    <td>{d.recommendation}</td><td>{d.curiosityScore}/100</td><td>{d.evidenceStrength.label}{d.corroborated ? "" : " · single outlet"}</td>
                    <td>{d.locations.map((l) => l.country).join(", ") || "none established"}</td>
                    <td><button onClick={() => setInspect(inspect === d.id ? null : d.id)}>{inspect === d.id ? "Hide" : "Inspect"}</button> <button onClick={() => add(d.id)} disabled={ids.includes(d.id)}>{ids.includes(d.id) ? "In workspace" : "Add"}</button></td>
                  </tr>
                  {inspect === d.id && (
                    <tr><td colSpan={6}>
                      <p className="why"><strong>What changed:</strong> {d.whatChanged}</p>
                      <p className="why"><strong>Why it may be interesting:</strong> {d.whyInteresting.join("; ") || "nothing specific found"}</p>
                      <p className="why"><strong>Audience question:</strong> {d.audienceQuestion}</p>
                      {d.surprisingElement && <p className="why"><strong>Surprising element:</strong> {d.surprisingElement}</p>}
                      {d.humanConsequences && <p className="why"><strong>Human consequences:</strong> {d.humanConsequences}</p>}
                      {d.possibleImplications && <p className="why"><strong>Possible implications (not established):</strong> {d.possibleImplications}</p>}
                      <p className="why"><strong>Recommendation:</strong> {d.recommendationWhy}</p>
                      <p className="caution">Evidence: {d.evidenceStrength.why}. Missing: {d.missingEvidence.join(" | ")}</p>
                      {d.sensationalismFlags.length > 0 && <p className="caution">Sensational wording: {d.sensationalismFlags.join(", ")}</p>}
                      <p className="meta">{d.hypothesisNote}</p>
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {desk && tab === "mine" && (
        <div className="panel">
          {desk.saved.editions.length === 0 ? <p>No saved editions yet.</p> : (
            <table>
              <thead><tr><th>Edition</th><th>Structure</th><th>Coherence</th><th>Developments</th><th>Approval</th><th></th></tr></thead>
              <tbody>{desk.saved.editions.map((e) => (
                <tr key={e.id}><td>{e.title}</td><td>{e.structureLabel}</td><td>{e.verdict ?? "—"}{e.score !== null ? ` ${e.score}` : ""}</td><td>{e.members}</td>
                  <td className={e.approvalCurrent ? "ok" : "bad"}>{e.approvalCurrent ? "approved (current)" : e.decision ? `${e.decision.replace(/_/g, " ")}${e.decision === "approved" ? " (no longer current)" : ""}` : "not decided"}</td>
                  <td><button onClick={() => void openSaved(e.id)}>Open</button></td></tr>))}</tbody>
            </table>
          )}
        </div>
      )}

      <div id="workspace" className="panel">
        <h2>Edition workspace</h2>
        {ids.length === 0 ? <p className="meta">Open a suggested edition, or add developments from the Developments tab.</p> : (
          <>
            <div className="row">
              <label>Title<input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} /></label>
              <label>Structure
                <select value={structure || ev?.structure || ""} onChange={(e) => setStructure(e.target.value)}>{STRUCTS.map(([k, l]) => <option key={k} value={k}>{l}{ev?.suggestedStructure === k || (!ev?.suggestedStructure && ev?.structure === k) ? " (suggested)" : ""}</option>)}</select>
              </label>
            </div>
            <label>Editorial angle (optional)<input type="text" value={angle} onChange={(e) => setAngle(e.target.value)} maxLength={1000} /></label>
            <h3>Developments, in order</h3>
            <table><tbody>{ids.map((id, i) => (
              <tr key={id}><td>{i + 1}</td><td>{devs.find((d) => d.id === id)?.headline ?? devById(id)?.headline ?? id}</td>
                <td><button onClick={() => move(i, -1)} disabled={i === 0}>↑</button> <button onClick={() => move(i, 1)} disabled={i === ids.length - 1}>↓</button> <button onClick={() => remove(id)}>Remove</button></td></tr>))}</tbody></table>
            {desk && (
              <label>Add a development
                <select value="" onChange={(e) => e.target.value && add(e.target.value)}><option value="">Choose…</option>{desk.developments.filter((d) => !ids.includes(d.id)).map((d) => <option key={d.id} value={d.id}>{d.headline.slice(0, 110)}</option>)}</select>
              </label>
            )}
            {ev && (
              <>
                <h3>Edition coherence check</h3>
                <p><span className={`chip ${tone(ev.coherence.verdict)}`}>{ev.coherence.verdict}{ev.coherence.score !== null ? ` ${ev.coherence.score}/100` : ""}</span>
                  {prevScore && prevScore.score !== ev.coherence.score && <span className="meta"> {" "}change: {prevScore.score ?? "—"} → {ev.coherence.score ?? "—"} ({prevScore.verdict} → {ev.coherence.verdict})</span>}</p>
                <p className="why"><strong>Do they belong together?</strong> {ev.check.belongTogether}</p>
                <p className="why"><strong>Central argument:</strong> {ev.check.centralArgument}</p>
                <p className="why"><strong>Strongest opening:</strong> {ev.check.strongestOpening}</p>
                <p className="why"><strong>Sequence:</strong> {ev.check.logicalSequence} <button onClick={applySequence}>Use this order</button></p>
                <p className="why"><strong>What each adds:</strong></p>
                <ul className="comps">{ev.contributions.map((c) => <li key={c.id}><strong>{c.headline}</strong>: {c.adds}</li>)}</ul>
                <p className="why"><strong>Geography:</strong> {ev.check.geographicDimension} {ev.check.mapUseful ? "A map would help." : `Map not recommended: ${ev.check.mapWhy}`}</p>
                <p className="why"><strong>Better as one edition or separate?</strong> {ev.check.valueVersusSeparate}</p>
                {ev.check.repetition.length > 0 && <p className="caution">Repetition: {ev.check.repetition.join("; ")}</p>}
                {ev.check.weaklyConnected.length > 0 && <div className="confirm"><strong>Weakly connected (you decide; nothing is removed for you):</strong><ul className="comps">{ev.check.weaklyConnected.map((w) => <li key={w.id}>{w.headline}: {w.why} <button onClick={() => remove(w.id)}>Remove from edition</button></li>)}</ul></div>}
                {ev.check.conflicts.length > 0 && <p className="caution">Conflicts noted: {ev.check.conflicts.join("; ")}</p>}
                {ev.check.recommendations.length > 0 && <ul className="comps">{ev.check.recommendations.map((r, i) => <li key={i}>{r}</li>)}</ul>}
                <details><summary>How the coherence score was reached</summary>
                  <table><thead><tr><th>Part</th><th>Points</th><th>Why</th></tr></thead><tbody>{ev.coherence.components.map((c) => <tr key={c.name}><td>{c.name}</td><td>{c.points}/{c.max}</td><td>{c.why}</td></tr>)}</tbody></table>
                  <p className="meta">Fixed rules on headlines and snippets. The connection is an editorial inference, not a verified fact.</p>
                </details>
                <p className="meta">Evidence: {ev.metrics.evidenceStrength.label} (weakest: {ev.metrics.evidenceStrength.weakest}) · curiosity potential {ev.metrics.curiosityPotential}/100 (editorial hypothesis) · human relevance {ev.metrics.humanRelevance} · {ev.metrics.timelinessHours !== null ? `newest source ${ev.metrics.timelinessHours}h old` : "age unknown"}. Why it matters: {ev.whyItMatters}</p>
                {ev.uncertainties.length > 0 && <p className="caution">Uncertainties: {ev.uncertainties.join(" ")}</p>}
              </>
            )}
            <div className="actions"><button className="primary" onClick={() => void save()} disabled={busy || !title.trim() || !ids.length}>{editionId ? "Save changes" : "Save edition"}</button></div>

            {editionId && (
              <div className="confirm">
                <h3>Your decision</h3>
                <p className="meta">{approval?.current ? "Approved for exactly these developments." : approval?.membersChangedSinceApproval ? "The developments changed after approval: approve again." : approval?.decision ? `Latest decision: ${approval.decision.replace(/_/g, " ")}.` : "Not decided yet."}</p>
                <label className="inline"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I reviewed the coherence check and the evidence for each development.</label>
                <label>Notes{ev && ev.coherence.verdict !== "COHERENT" && ev.coherence.verdict !== "SINGLE DEVELOPMENT" ? " (required to approve a weak connection)" : " (optional)"}<input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} /></label>
                <div className="actions">
                  <button className="primary" disabled={busy || !ack} onClick={() => void decide("approved")}>Approve edition</button>
                  <button disabled={busy} onClick={() => void decide("needs_changes")}>Needs changes</button>
                  <button disabled={busy} onClick={() => void decide("rejected")}>Reject</button>
                </div>
              </div>
            )}

            <h3>Build the Claude production prompt</h3>
            {!canBuild && <p className="meta">Available once the saved edition has a current approval.</p>}
            {canBuild && (
              <>
                <div className="row">
                  <label>Deliverable<select value={deliverable} onChange={(e) => setDeliverable(e.target.value)}><option value="script_storyboard">Script and storyboard</option><option value="animated_html">Animated HTML</option><option value="narrated_video">Narrated video</option></select></label>
                  <label>Length<select value={duration} onChange={(e) => setDuration(Number(e.target.value))}><option value={60}>60 seconds</option><option value={90}>90 seconds</option><option value={120}>120 seconds</option></select></label>
                </div>
                <label>Prompt angle override (optional)<input type="text" value={pAngle} onChange={(e) => setPAngle(e.target.value)} maxLength={200} /></label>
                {ids.map((id, i) => <label key={id}>Conflict note for D{i + 1} (only if you found accounts that disagree)<input type="text" value={conflicts[i] ?? ""} maxLength={600} onChange={(e) => setConflicts((c) => c.map((x, j) => (j === i ? e.target.value : x)))} /></label>)}
                <div className="actions"><button className="primary" onClick={() => void build()} disabled={busy}>Create integrated prompt</button></div>
              </>
            )}
            {res && (
              <div>
                {res.saved ? <p className="status good">Saved to Edition Prompt History as version {res.version}.</p> : <p className="status bad">{res.note ?? "This prompt was NOT saved."}</p>}
                <h3>Team chosen for this edition</h3>
                <ul className="comps">{res.roles.map((r) => <li key={r.role}><strong>{r.role}</strong>: {r.why}</li>)}</ul>
                <p className="meta">{res.tools.note}</p>
                <textarea readOnly value={res.prompt} rows={18} />
                <div className="actions"><button className="primary" onClick={() => void copy()}>{copied ? "Copied" : "Copy prompt"}</button></div>
                <p className="meta">Paste into Claude. WorldFiled Desk does not render, voice or publish anything.</p>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

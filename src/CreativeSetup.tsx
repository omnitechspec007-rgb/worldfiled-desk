import { useCallback, useEffect, useState } from "react";

type Voice = {
  engine: string; voiceName: string; model: string; styleInstructions: string; paceInstructions: string; pronunciationHandling: string; status: string;
  licence: { status: string; note: string; checkedAt: string | null }; lastTested: string | null; verifiedControls: string[];
  approval: { approved: boolean; approvedAt: string | null; approvedVoiceKey: string | null; note: string };
};
type Cap = { key: string; label: string; cls: string; note: string };
type Lex = { name: string; type: string; language: string; pronunciation: string; status: string; source: string; engineNotes: Record<string, string>; lastTested: string | null };
type View = {
  configured: boolean; voice: Voice; approval: string; toolsConfirmed: string[]; note: string;
  presenter: { identity: string; energy: string[]; never: string[] };
  laomedeiaReference: { format: string; durationSeconds: number; integratedLufs: number; truePeakDbfs: number; medianPitchHz: number; pitchVariationSemitones: number; wordsPerSecond: number; paceNote: string; caution: string };
  options: { statuses: string[]; licences: string[]; pronunciationHandling: string[]; controls: string[]; lexiconStatuses: string[] };
  profiles: { key: string; label: string; paceLo: number; paceHi: number; paceSource: string; direction: string }[];
  capabilities: Cap[]; lexicon: Lex[];
};
const api = "/.netlify/functions/creative-config";
const post = (body: unknown) => fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const nice = (s: string) => s.replace(/_/g, " ").toLowerCase();
const EMPTY: Lex = { name: "", type: "name", language: "", pronunciation: "", status: "UNCONFIRMED", source: "", engineNotes: {}, lastTested: null };

export default function CreativeSetup() {
  const [v, setV] = useState<View | null>(null);
  const [voice, setVoice] = useState<Voice | null>(null);
  const [msg, setMsg] = useState("");
  const [listened, setListened] = useState(false);
  const [lex, setLex] = useState<Lex>(EMPTY);
  const load = useCallback(async () => {
    const r = await fetch(api); if (!r.ok) { setMsg(`Could not load the setup (${r.status}).`); return; }
    const j = (await r.json()) as View; setV(j); setVoice(j.voice);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const act = async (body: unknown, ok: string) => {
    const r = await post(body); const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? (j.note ? `${ok} ${j.note}` : ok) : `Not saved: ${j.errors ? j.errors.join(" ") : j.detail ?? j.error ?? r.status}`);
    if (r.ok) await load();
  };
  if (!v || !voice) return <div className="page"><h1>Presenter and voice</h1>{msg ? <p className="status bad">{msg}</p> : <p className="meta">Loading…</p>}</div>;
  const up = (patch: Partial<Voice>) => setVoice({ ...voice, ...patch });
  const R = v.laomedeiaReference;
  const apprText = v.approval === "APPROVED" ? "Approved after listening, for this exact engine, voice and model." : v.approval === "VOID_VOICE_CHANGED" ? "NOT approved: the engine, voice or model changed since you last approved. Listen and approve again." : "Not approved. Nothing here is tested or cleared until you record it.";
  return (
    <div className="page">
      <h1>Presenter and voice</h1>
      <p className="meta">Sets how every edition prompt directs the presenter. WorldFiled Desk never calls a voice engine and never makes audio: you generate and listen in your own tool. {v.note}</p>
      {msg && <p className={`status ${/Not saved|Could not/.test(msg) ? "bad" : "good"}`}>{msg}</p>}

      <div className="panel">
        <h2>The presenter (fixed identity)</h2>
        <p className="why">{v.presenter.identity}</p>
        <ul className="comps">{v.presenter.energy.map((e) => <li key={e}>{e}</li>)}<li>Never imitate: {v.presenter.never.join(", ")}.</li></ul>
        <p className="meta">Changing the voice engine below never changes this identity.</p>
      </div>

      <div className="panel">
        <h2>Voice configuration {v.configured ? "" : "(defaults shown: nothing saved yet)"}</h2>
        <p className={`status ${v.approval === "APPROVED" ? "good" : "bad"}`}>{apprText}</p>
        <div className="row">
          <label>Voice engine<input type="text" value={voice.engine} onChange={(e) => up({ engine: e.target.value })} /></label>
          <label>Voice name<input type="text" value={voice.voiceName} onChange={(e) => up({ voiceName: e.target.value })} /></label>
          <label>Model or version (if known)<input type="text" value={voice.model} onChange={(e) => up({ model: e.target.value })} /></label>
        </div>
        <div className="row">
          <label>Status<select value={voice.status} onChange={(e) => up({ status: e.target.value })}>{v.options.statuses.map((s) => <option key={s} value={s}>{nice(s)}</option>)}</select></label>
          <label>Last tested (YYYY-MM-DD)<input type="text" value={voice.lastTested ?? ""} onChange={(e) => up({ lastTested: e.target.value || null })} /></label>
          <label>Licence and commercial use<select value={voice.licence.status} onChange={(e) => up({ licence: { ...voice.licence, status: e.target.value } })}>{v.options.licences.map((s) => <option key={s} value={s}>{nice(s)}</option>)}</select></label>
        </div>
        <label>Licence note (where you checked the terms)<input type="text" value={voice.licence.note} onChange={(e) => up({ licence: { ...voice.licence, note: e.target.value } })} /></label>
        <label>Licence checked on (YYYY-MM-DD)<input type="text" value={voice.licence.checkedAt ?? ""} onChange={(e) => up({ licence: { ...voice.licence, checkedAt: e.target.value || null } })} /></label>
        <label>Style notes<input type="text" value={voice.styleInstructions} onChange={(e) => up({ styleInstructions: e.target.value })} /></label>
        <label>Pace notes<input type="text" value={voice.paceInstructions} onChange={(e) => up({ paceInstructions: e.target.value })} /></label>
        <details><summary>Advanced: pronunciation handling and verified engine controls</summary>
          <label>Pronunciation handling<select value={voice.pronunciationHandling} onChange={(e) => up({ pronunciationHandling: e.target.value })}>{v.options.pronunciationHandling.map((s) => <option key={s} value={s}>{nice(s)}</option>)}</select></label>
          <p className="meta">Tick a control ONLY if you verified that this engine supports it. Anything unticked is never requested in a prompt.</p>
          <div className="chips">{v.options.controls.map((c) => <label key={c} className="inline"><input type="checkbox" checked={voice.verifiedControls.includes(c)} onChange={(e) => up({ verifiedControls: e.target.checked ? [...voice.verifiedControls, c] : voice.verifiedControls.filter((x) => x !== c) })} /> {nice(c)}</label>)}</div>
        </details>
        <div className="actions"><button className="primary" onClick={() => act({ action: "save-voice", voice }, "Voice saved.")}>Save voice configuration</button></div>
        <h3>Listening approval</h3>
        <label className="inline"><input type="checkbox" checked={listened} onChange={(e) => setListened(e.target.checked)} /> I listened to this voice and approve it as the presenter</label>
        <div className="actions"><button disabled={!listened || voice.status !== "TESTED_BY_EDITOR"} onClick={() => act({ action: "approve-voice", listened: true }, "Approval recorded.")}>Record my listening approval</button></div>
        {voice.status !== "TESTED_BY_EDITOR" && <p className="meta">Set the status to "tested by editor" with a last-tested date, and save, before approving.</p>}
        {/laomedeia/i.test(voice.voiceName) && <details><summary>Laomedeia reference sample (measurements of ONE sample)</summary>
          <p className="meta">{R.format}; about {R.durationSeconds} s; about {R.integratedLufs} LUFS; true peak about {R.truePeakDbfs} dBFS; median pitch about {R.medianPitchHz} Hz; variation about {R.pitchVariationSemitones} semitones; about {R.wordsPerSecond} words per second. {R.paceNote} {R.caution}</p></details>}
      </div>

      <details className="panel"><summary>Delivery profiles (initial, editable pace targets)</summary>
        <table><thead><tr><th>Profile</th><th>Words/sec</th><th>Direction</th></tr></thead><tbody>{v.profiles.map((p) => <tr key={p.key}><td>{p.label}</td><td>{p.paceLo} to {p.paceHi}{p.paceSource === "initial" ? " (initial)" : ""}</td><td>{p.direction}</td></tr>)}</tbody></table>
        <p className="meta">Pace values are targets to check against the real engine output, not guarantees.</p>
      </details>

      <div className="panel">
        <h2>Production tools you have confirmed are available</h2>
        <p className="meta">Nothing is marked tested. Tick only what you have checked yourself. Paid services cannot be ticked.</p>
        <ul className="comps">{v.capabilities.map((c) => (
          <li key={c.key}>{c.cls === "PAID" || c.cls === "UNVERIFIED" ? <span>— </span> : <input type="checkbox" checked={v.toolsConfirmed.includes(c.key)} onChange={(e) => act({ action: "save-tools", toolsConfirmed: e.target.checked ? [...v.toolsConfirmed, c.key] : v.toolsConfirmed.filter((k) => k !== c.key) }, "Saved.")} />} <span className="chip">{c.cls}</span> <strong>{c.label}</strong><div className="meta">{c.note}</div></li>))}</ul>
      </div>

      <div className="panel">
        <h2>Pronunciation lexicon</h2>
        <p className="meta">Names not listed here are flagged PRONUNCIATION CHECK REQUIRED in every prompt. Nothing is guessed. A "confirmed" entry needs a respelling and how you confirmed it.</p>
        {v.lexicon.length > 0 && <table><thead><tr><th>Name</th><th>Respelling</th><th>Status</th><th>Source</th><th></th></tr></thead><tbody>{v.lexicon.map((e) => <tr key={e.name}><td>{e.name} <span className="meta">({e.type})</span></td><td>{e.pronunciation || "none"}</td><td>{nice(e.status)}</td><td>{e.source}</td><td><button onClick={() => setLex(e)}>Edit</button></td></tr>)}</tbody></table>}
        <div className="row">
          <label>Name<input type="text" value={lex.name} onChange={(e) => setLex({ ...lex, name: e.target.value })} /></label>
          <label>Type<input type="text" value={lex.type} onChange={(e) => setLex({ ...lex, type: e.target.value })} /></label>
          <label>Language or origin<input type="text" value={lex.language} onChange={(e) => setLex({ ...lex, language: e.target.value })} /></label>
        </div>
        <div className="row">
          <label>Respelling<input type="text" value={lex.pronunciation} onChange={(e) => setLex({ ...lex, pronunciation: e.target.value })} /></label>
          <label>Status<select value={lex.status} onChange={(e) => setLex({ ...lex, status: e.target.value })}>{v.options.lexiconStatuses.map((s) => <option key={s} value={s}>{nice(s)}</option>)}</select></label>
          <label>Confirmation source<input type="text" value={lex.source} onChange={(e) => setLex({ ...lex, source: e.target.value })} /></label>
        </div>
        <div className="actions"><button className="primary" onClick={() => act({ action: "save-lexicon", entry: lex }, "Entry saved.").then(() => setLex(EMPTY))}>Save entry</button></div>
      </div>
    </div>
  );
}

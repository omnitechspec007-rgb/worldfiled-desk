import { Fragment, useCallback, useEffect, useRef, useState } from "react";

type Loc = { country: string; basis: string };
type Dev = {
  id: string; headline: string; decision: string | null; type: string; recommendation: string; recommendationWhy: string; curiosityScore: number;
  evidenceStrength: { label: string; why: string }; corroborated: boolean; whatChanged: string; whyInteresting: string[]; audienceQuestion: string;
  surprisingElement: string | null; humanConsequences: string | null; possibleImplications: string | null; missingEvidence: string[]; sensationalismFlags: string[];
  hypothesisNote: string; themes: string[]; locations: Loc[]; geographicInterest: string; outlets: number;
  fresh: boolean; notFreshWhy: string | null; ageHours: number | null;
  sources: { outlet: string; region: string; tier: string; title: string; url: string; publishedAt: string | null; snippet: string }[];
};
type Comp = { name: string; points: number; max: number; why: string };
type Evaluation = {
  ids: string[]; structure: string; structureLabel: string; roundup?: boolean; suggestedStructure?: string; structureOverride?: boolean; theme: string; catalyst: string | null; title: string; angle: string;
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
  saved: { installed: boolean; editions: { id: string; title: string; editionKind: "video" | "text"; structureLabel: string; verdict: string | null; score: number | null; members: number; updatedAt: string; decision: string | null; approvalCurrent: boolean }[] };
};
type Approval = { decision: string | null; notes: string | null; current: boolean; membersChangedSinceApproval: boolean; blockedMembers: string[] };
type CreativePreview = {
  format: { key: string; label: string; why: string; overridden: boolean }; formats: { key: string; label: string; description: string }[];
  voice: { engine: string; voice: string; status: string; approval: string; licence: string; configured: boolean };
  runtime: { total: number; ceiling: number; shorter: boolean; warnings: string[]; words: number };
  scenes: { n: number; kind: string; ref: string | null; title: string; seconds: number; delivery: string; pace: string; composition: string; treatment: string; intensity: string; tier: string }[];
  pronunciationCheckRequired: { name: string; note: string }[];
};
type PromptResult = { creative?: { pronunciationCheckRequired: string[]; runtime: { warnings: string[] }; voiceApproval: string } | null; saved: boolean; notInstalled?: boolean; note?: string; id?: string; version?: number; prompt: string; roles: { role: string; why: string }[]; tools: { needed: { name: string }[]; note: string }; brandChecklist: string[] };

const STRUCTS = [["multi_country", "Multi-country synthesis"], ["single_country", "Single-country deep dive"], ["event_roundup", "Event-driven thematic roundup"], ["news_roundup", "Multi-topic news roundup (no shared theme)"]];
const api = "/.netlify/functions/";
const post = (fn: string, body: unknown) => fetch(api + fn, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const tone = (v: string) => (v === "COHERENT" ? "ok" : v === "SINGLE DEVELOPMENT" ? "" : "bad");

function DevDetail({ d }: { d: Dev }) {
  return (
    <div>
      <h3>Sources</h3>
      <ul className="comps">{d.sources.map((x) => <li key={x.url}><a href={x.url} target="_blank" rel="noreferrer">{x.title || x.url}</a> · {x.outlet} ({x.tier === "primary" ? "official" : "reporting"}) · {x.publishedAt ? new Date(x.publishedAt).toLocaleString() : "date unknown"}{x.snippet ? <div className="meta">{x.snippet}</div> : null}</li>)}</ul>
      <h3>Editorial reasoning</h3>
      <p className="why"><strong>What changed:</strong> {d.whatChanged}</p>
      <p className="why"><strong>Why it may be interesting:</strong> {d.whyInteresting.join("; ") || "nothing specific found"}</p>
      <p className="why"><strong>Audience question:</strong> {d.audienceQuestion}</p>
      {d.surprisingElement && <p className="why"><strong>Surprising element:</strong> {d.surprisingElement}</p>}
      {d.humanConsequences && <p className="why"><strong>Human consequences:</strong> {d.humanConsequences}</p>}
      {d.possibleImplications && <p className="why"><strong>Possible implications (not established):</strong> {d.possibleImplications}</p>}
      <p className="why"><strong>Recommendation:</strong> {d.recommendation}. {d.recommendationWhy}</p>
      <p className="caution">Evidence: {d.evidenceStrength.why}. Missing: {d.missingEvidence.join(" | ")}</p>
      {d.sensationalismFlags.length > 0 && <p className="caution">Sensational wording: {d.sensationalismFlags.join(", ")}</p>}
      <p className="meta">{d.hypothesisNote}</p>
    </div>
  );
}

export default function EditionDesk() {
  const [desk, setDesk] = useState<Desk | null>(null);
  const [tab, setTab] = useState<"developments" | "suggested" | "mine">("developments");
  const [q, setQ] = useState("");
  const [showOlder, setShowOlder] = useState(false);
  const [recFilter, setRecFilter] = useState("");
  const [msg, setMsg] = useState("");
  const [inspect, setInspect] = useState<string | null>(null);
  // coverage window (from the Planner): classify developments as new / update / renewed / held over / already published
  type WinCls = { cls: string; candidate: boolean; reason: string };
  const [win, setWin] = useState("");
  const [winInfo, setWinInfo] = useState<{ local: string; hours: number; overlaps: { label: string; minutes: number }[]; map: Record<string, WinCls> } | null>(null);
  const [cycleWin, setCycleWin] = useState<{ start: string; end: string; label: string } | null>(null);
  const [rejectedLinks, setRejectedLinks] = useState<string[]>([]);
  // workspace
  const [ids, setIds] = useState<string[]>([]);
  const [editionKind, setEditionKind] = useState<"video" | "text">("video");
  const [selections, setSelections] = useState<{ video: string[]; text: string[] }>({ video: [], text: [] });
  const selectionLimit = editionKind === "video" ? 8 : 18;
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
  const [duration, setDuration] = useState(600);
  const [pAngle, setPAngle] = useState("");
  const [fmt, setFmt] = useState("");
  const [sound, setSound] = useState("subtle");
  const [visual, setVisual] = useState("adaptive");
  const [cpv, setCpv] = useState<CreativePreview | null>(null);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [res, setRes] = useState<PromptResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const lastEv = useRef<Evaluation | null>(null);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const draftKey = "worldfiled:edition-desk:draft:v1";
  const workspaceSnapshot = JSON.stringify({ ids, editionKind, selections, title, angle, structure, tab, deliverable, duration, pAngle, fmt, sound, visual, conflicts });

  // Keep the in-progress workspace locally so refreshes do not discard work.
  // Server approvals and generated prompts are deliberately not restored.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const draft = JSON.parse(raw);
        if (draft && Array.isArray(draft.ids) && draft.ids.length <= 18) {
          setEditionKind(draft.editionKind === "text" ? "text" : "video");
          setIds(draft.ids.filter((x: unknown) => typeof x === "string"));
          setSelections({ video: Array.isArray(draft.selections?.video) ? draft.selections.video.filter((x: unknown) => typeof x === "string").slice(0, 8) : [], text: Array.isArray(draft.selections?.text) ? draft.selections.text.filter((x: unknown) => typeof x === "string").slice(0, 18) : [] });
          setTitle(typeof draft.title === "string" ? draft.title : "");
          setAngle(typeof draft.angle === "string" ? draft.angle : "");
          setStructure(typeof draft.structure === "string" ? draft.structure : "");
          setTab(["developments", "suggested", "mine"].includes(draft.tab) ? draft.tab : "developments");
          setDeliverable(typeof draft.deliverable === "string" ? draft.deliverable : "script_storyboard");
          setDuration([480, 600, 720].includes(draft.duration) ? draft.duration : 600);
          setPAngle(typeof draft.pAngle === "string" ? draft.pAngle : "");
          setFmt(typeof draft.fmt === "string" ? draft.fmt : "");
          setSound(draft.sound === "minimal" ? "minimal" : "subtle");
          setVisual(draft.visual === "typographic" ? "typographic" : "adaptive");
          setConflicts(Array.isArray(draft.conflicts) ? draft.conflicts : []);
          setMsg("Recovered your locally saved Edition Desk draft. Review it and save the edition to keep it in your account.");
        }
      }
    } catch {
      setMsg("A previous local draft could not be read. Your saved editions are unchanged.");
    }
    setDraftHydrated(true);
  }, []);

  useEffect(() => {
    if (!draftHydrated) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify({
        ids, editionKind, selections, title, angle, structure, tab, deliverable, duration, pAngle, fmt, sound, visual, conflicts,
        savedAt: new Date().toISOString(),
      }));
    } catch {
      setMsg("Browser storage is unavailable; keep this tab open until you save the edition.");
    }
  }, [draftHydrated, ids, editionKind, selections, title, angle, structure, tab, deliverable, duration, pAngle, fmt, sound, visual, conflicts]);

  useEffect(() => { if (draftHydrated) setSelections((s) => ({ ...s, [editionKind]: ids })); }, [ids, editionKind, draftHydrated]);

  useEffect(() => {
    if (!draftHydrated) return;
    const hasWorkspace = ids.length > 0 || Boolean(title.trim());
    const dirty = hasWorkspace && workspaceSnapshot !== savedSnapshot;
    window.dispatchEvent(new CustomEvent("worldfiled:edition-dirty", { detail: { dirty } }));
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draftHydrated, workspaceSnapshot, savedSnapshot, ids.length, title]);

  const loadDesk = useCallback(async () => {
    try {
      const r = await fetch(api + "editions");
      if (!r.ok) throw new Error();
      setDesk(await r.json());
    } catch { setMsg("Could not load the Edition Desk."); }
  }, []);
  useEffect(() => { void loadDesk(); }, [loadDesk]);
  useEffect(() => { fetch(api + "cycles").then((r) => (r.ok ? r.json() : null)).then((j) => { if (j?.cycle) setCycleWin({ start: j.cycle.coverage.start, end: j.cycle.coverage.end, label: j.cycle.label }); }).catch(() => undefined); }, []);
  useEffect(() => {
    if (!win) { setWinInfo(null); return; }
    const q = win === "cycle" && cycleWin ? `mode=custom&from=${encodeURIComponent(cycleWin.start)}&to=${encodeURIComponent(cycleWin.end)}` : `mode=rolling&hours=${win}&end=now`;
    fetch(`${api}cycles?preview=1&${q}`).then(async (r) => { if (!r.ok) { setWinInfo(null); setMsg("Could not load the coverage window."); return; } const j = await r.json(); setWinInfo({ local: j.window.local, hours: j.window.hours, overlaps: j.overlaps, map: Object.fromEntries(j.stories.map((x: any) => [x.id, { cls: x.cls, candidate: x.candidate, reason: x.reason }])) }); }).catch(() => setMsg("Could not load the coverage window."));
  }, [win, cycleWin]);

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

  useEffect(() => { if (ev && !title.trim()) setTitle(ev.title); }, [ev, title]);

  const openSet = (s: { ids: string[]; title: string; angle?: string; structure?: string; editionKind?: "video" | "text" }, id: string | null = null) => {
    lastEv.current = null; setPrevScore(null);
    const kind = s.editionKind ?? editionKind;
    setEditionKind(kind); setSelections((prev) => ({ ...prev, [kind]: s.ids }));
    setIds(s.ids); setTitle(s.title); setAngle(s.angle ?? ""); setStructure(s.structure ?? ""); setEditionId(id); setApproval(null); setRes(null); setAck(false); setNotes(""); setMsg("");
    setSavedSnapshot(JSON.stringify({ ids: s.ids, editionKind: kind, selections: { ...selections, [kind]: s.ids }, title: s.title, angle: s.angle ?? "", structure: s.structure ?? "", tab, deliverable, duration, pAngle, fmt, sound, visual, conflicts }));
    setTimeout(() => document.getElementById("workspace")?.scrollIntoView({ behavior: "smooth" }), 50);
  };
  const openSaved = async (id: string) => {
    try {
      const r = await fetch(`${api}editions?id=${id}`);
      if (!r.ok) throw new Error();
      const d = await r.json();
      openSet({ ids: d.ids, title: d.title, angle: d.angle, structure: d.structure, editionKind: d.editionKind }, id);
      setApproval(d.approval);
      if (d.missing?.length) setMsg("Some developments in this edition are no longer available.");
    } catch { setMsg("Could not open that edition."); }
  };
  const move = (i: number, d: number) => setIds((a) => { const b = [...a]; const j = i + d; if (j < 0 || j >= b.length) return a; [b[i], b[j]] = [b[j], b[i]]; return b; });
  const remove = (id: string) => setIds((a) => a.filter((x) => x !== id));
  const add = (id: string) => setIds((a) => (a.includes(id) || a.length >= selectionLimit ? a : [...a, id]));
  const toggle = (id: string) => setIds((a) => (a.includes(id) ? a.filter((x) => x !== id) : a.length >= selectionLimit ? a : [...a, id]));
  const clearSel = () => { setIds([]); setSelections((s) => ({ ...s, [editionKind]: [] })); setEditionId(null); setApproval(null); setRes(null); };
  const switchEditionKind = (kind: "video" | "text") => {
    if (kind === editionKind) return;
    setSelections((s) => ({ ...s, [editionKind]: ids }));
    setIds(selections[kind] ?? []);
    setEditionKind(kind);
    setEditionId(null); setApproval(null); setRes(null); setAck(false); setTitle(""); setAngle(""); setStructure(""); setNotes(""); setConflicts([]); setPAngle(""); setFmt(""); setCpv(null); setMsg("Switched edition profile. Your other profile selection is kept separately; save and approve each edition independently.");
  };
  const applySequence = () => ev && setIds(ev.sequence.map((s) => s.id));

  const save = async () => {
    setBusy(true); setMsg("");
    try {
      const r = await post("editions", { action: "save", id: editionId ?? undefined, title, ids, editionKind, angle, structure: structure || undefined });
      const d = await r.json();
      if (!r.ok) setMsg(d.detail ?? "Could not save the edition.");
      else { setEditionId(d.id); setSavedSnapshot(workspaceSnapshot); setMsg(d.note ?? "Edition saved."); await openSavedQuiet(d.id); void loadDesk(); }
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
  useEffect(() => {
    if (!editionId || editionKind === "text") { setCpv(null); return; }
    const q = `editionId=${editionId}&durationSeconds=${duration}&format=${fmt}&sound=${sound}&visual=${visual}`;
    fetch(`${api}edition-prompt?${q}`).then(async (r) => { if (r.ok) setCpv((await r.json()).creative ?? null); else setCpv(null); }).catch(() => setCpv(null));
  }, [editionId, editionKind, duration, fmt, sound, visual, approval?.current]);
  const build = async () => {
    if (!editionId) return;
    setBusy(true); setMsg(""); setCopied(false); setRes(null);
    try {
      const r = await post("edition-prompt", { editionId, deliverable, durationSeconds: duration, format: fmt, sound, visual, angle: pAngle, conflictNotes: conflicts, parentId: res?.id });
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
      <p className="meta">Two independently curated daily products from one researched story pool. The video bulletin prioritises the strongest 6-8 stories; the text briefing can carry 12-18. Unrelated stories remain clearly labelled as a roundup. {desk?.note}</p>
      {msg && <p className={`status ${/Could not|not saved|no longer|refus/i.test(msg) ? "bad" : "good"}`}>{msg}</p>}
      {desk && !desk.saved.installed && <div className="panel"><p className="status bad">NOT INSTALLED: saving editions needs migration 004, which has not been run yet. You can still explore suggestions and check coherence.</p></div>}

      <div className="panel">
        <h2>Daily edition profile</h2>
        <div className="row"><label>Build profile<select value={editionKind} onChange={(e) => switchEditionKind(e.target.value as "video" | "text")}><option value="video">Flagship video bulletin · target 6-8 stories · 8-12 minutes</option><option value="text">Written news briefing · target 12-18 stories · 5-8 minute read</option></select></label></div>
        <p className="meta">Both editions use the same researched developments, but keep separate story selections, ordering, approvals and prompt histories. Select and approve each profile independently. A quiet news day should produce a shorter edition, never filler.</p>
      </div>\n      <div className="tabs">
        {([["developments", "1. Select developments"], ["suggested", "Suggested editions (shortcut)"], ["mine", "My editions"]] as const).map(([k, l]) => <button key={k} className={tab === k ? "primary" : ""} onClick={() => setTab(k)}>{l}</button>)}
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

      {desk && tab === "developments" && (() => {
        const recs = [...new Set(desk.developments.map((d) => d.recommendation))];
        const list = desk.developments.filter((d) => (win && winInfo ? !!winInfo.map[d.id] || ids.includes(d.id) : (showOlder || d.fresh || ids.includes(d.id))) && (!recFilter || d.recommendation === recFilter) && (!q.trim() || d.headline.toLowerCase().includes(q.trim().toLowerCase())));
        return (
          <div className="panel">
            <h2>Select the developments for your {editionKind === "text" ? "text briefing" : "video bulletin"}</h2>
            <p className="meta">Tick any developments from the research results, in any combination. You do not need them to be related: unrelated stories become a multi-topic news roundup. Video target: 6-8 stories (maximum 8). Text target: 12-18 (maximum 18). These are editorial guides, not quotas.</p>
            <div className="confirm" style={{ position: "sticky", top: 0, zIndex: 2 }}>
              <strong>{ids.length} / {selectionLimit} selected</strong>
              <div className="actions">
                <button className="primary" disabled={!ids.length} onClick={() => { setTab("developments"); setTimeout(() => document.getElementById("workspace")?.scrollIntoView({ behavior: "smooth" }), 30); }}>Review selection ({ids.length}) ↓</button>
                <button disabled={!ids.length} onClick={clearSel}>Clear selection</button>
              </div>
            </div>
            <div className="row">
              <label>Coverage window<select value={win} onChange={(e) => setWin(e.target.value)}>
                <option value="">Any recent research (default)</option>
                {cycleWin && <option value="cycle">This edition's window ({cycleWin.label})</option>}
                <option value="6">Last 6 hours</option><option value="12">Last 12 hours</option><option value="24">Last 24 hours</option>
              </select></label>
              <label>Search<input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="words in the headline" /></label>
              <label>Recommendation<select value={recFilter} onChange={(e) => setRecFilter(e.target.value)}><option value="">All</option>{recs.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
              <label className="inline"><input type="checkbox" checked={showOlder} onChange={(e) => setShowOlder(e.target.checked)} /> Also show older and rejected ({desk.developments.filter((d) => !d.fresh).length})</label>
            </div>
            {win && winInfo && <p className="meta">Window: {winInfo.local} ({winInfo.hours} h). Includes the start, excludes the end. Only stories with reporting in this window are listed. <a href="/planner">Open the Planner</a>{winInfo.overlaps.length ? ` · Overlaps earlier coverage: ${winInfo.overlaps.map((o) => o.label).join(", ")}` : ""}</p>}
            {list.length === 0 && <p>No developments match. Run research from the Dashboard, or change the filters.</p>}
            <table>
              <thead><tr><th></th><th>Development</th><th>Recommendation</th><th>Curiosity (hypothesis)</th><th>Evidence</th><th>Places</th><th></th></tr></thead>
              <tbody>
                {list.map((d) => (
                  <Fragment key={d.id}>
                    <tr className={ids.includes(d.id) ? "picked" : ""}>
                      <td><input type="checkbox" aria-label={`Select ${d.headline}`} checked={ids.includes(d.id)} disabled={d.decision === "rejected"} onChange={() => toggle(d.id)} /></td>
                      <td>{winInfo?.map[d.id] && <span className={`chip ${winInfo.map[d.id].candidate ? "" : "bad"}`} title={winInfo.map[d.id].reason}>{({ NEW: "New", UPDATE: "Update", RENEWED: "Renewed", HELD_OVER: "Held over", ALREADY_PUBLISHED: "Already published", NEVER_VERIFIED: "Never verified", REJECTED_EARLIER: "Left out earlier", REJECTED: "Rejected" } as Record<string, string>)[winInfo.map[d.id].cls] ?? winInfo.map[d.id].cls}</span>} {d.headline}{winInfo?.map[d.id] && <div className="meta">{winInfo.map[d.id].reason}</div>}<div className="meta">{d.type} · {d.outlets} outlet{d.outlets === 1 ? "" : "s"} · {d.ageHours !== null ? `${d.ageHours}h old` : "age unknown"} · {d.decision === "rejected" ? "REJECTED (cannot be selected)" : d.decision ?? "not yet reviewed"}{!d.fresh && d.decision !== "rejected" ? ` · ${d.notFreshWhy}` : ""}</div></td>
                      <td>{d.recommendation}</td><td>{d.curiosityScore}/100</td><td>{d.evidenceStrength.label}{d.corroborated ? "" : " · single outlet"}</td>
                      <td>{d.locations.map((l) => l.country).join(", ") || "none established"}</td>
                      <td><button onClick={() => setInspect(inspect === d.id ? null : d.id)}>{inspect === d.id ? "Hide" : "Evidence"}</button></td>
                    </tr>
                    {inspect === d.id && <tr><td colSpan={7}><DevDetail d={d} /></td></tr>}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      {desk && tab === "mine" && (
        <div className="panel">
          {desk.saved.editions.length === 0 ? <p>No saved editions yet.</p> : (
            <table>
              <thead><tr><th>Edition</th><th>Profile</th><th>Structure</th><th>Coherence</th><th>Developments</th><th>Approval</th><th></th></tr></thead>
              <tbody>{desk.saved.editions.map((e) => (
                <tr key={e.id}><td>{e.title}</td><td>{e.editionKind === "text" ? "Text briefing" : "Video bulletin"}</td><td>{e.structureLabel}</td><td>{e.verdict ?? "—"}{e.score !== null ? ` ${e.score}` : ""}</td><td>{e.members}</td>
                  <td className={e.approvalCurrent ? "ok" : "bad"}>{e.approvalCurrent ? "approved (current)" : e.decision ? `${e.decision.replace(/_/g, " ")}${e.decision === "approved" ? " (no longer current)" : ""}` : "not decided"}</td>
                  <td><button onClick={() => void openSaved(e.id)}>Open</button></td></tr>))}</tbody>
            </table>
          )}
        </div>
      )}

      <div id="workspace" className="panel">
        <h2>2. Review, order and build your {editionKind === "text" ? "text briefing" : "video bulletin"} ({ids.length} selected)</h2>
        {ids.length === 0 ? <p className="meta">Nothing selected yet. Tick developments in "1. Select developments", or open a suggested edition.</p> : (
          <>
            <div className="row">
              <label>Title<input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} /></label>
              <label>Structure
                <select value={structure || ev?.structure || ""} onChange={(e) => setStructure(e.target.value)}>{STRUCTS.map(([k, l]) => <option key={k} value={k}>{l}{ev?.suggestedStructure === k || (!ev?.suggestedStructure && ev?.structure === k) ? " (suggested)" : ""}</option>)}</select>
              </label>
            </div>
            <label>Editorial angle (optional)<input type="text" value={angle} onChange={(e) => setAngle(e.target.value)} maxLength={1000} /></label>
            <h3>Your developments, in the order they will appear</h3>
            <table><tbody>{ids.map((id, i) => { const dv = devs.find((d) => d.id === id) ?? devById(id); return (
              <Fragment key={id}><tr><td>{i + 1}</td><td>{dv?.headline ?? id}<div className="meta">{dv ? `${dv.recommendation} · evidence ${dv.evidenceStrength.label}${dv.corroborated ? "" : " · single outlet"} · ${dv.sources.length} source(s)` : ""}</div></td>
                <td><button onClick={() => move(i, -1)} disabled={i === 0}>↑ Up</button> <button onClick={() => move(i, 1)} disabled={i === ids.length - 1}>↓ Down</button> <button onClick={() => remove(id)}>Remove</button> {dv && <button onClick={() => setInspect(inspect === "w" + id ? null : "w" + id)}>{inspect === "w" + id ? "Hide evidence" : "Evidence"}</button>}</td></tr>
              {dv && inspect === "w" + id && <tr><td></td><td colSpan={2}><DevDetail d={dv} /></td></tr>}</Fragment>); })}</tbody></table>
            {desk && (
              <label>Add a development
                <select value="" onChange={(e) => e.target.value && add(e.target.value)}><option value="">Choose…</option>{desk.developments.filter((d) => !ids.includes(d.id)).map((d) => <option key={d.id} value={d.id}>{d.headline.slice(0, 110)}</option>)}</select>
              </label>
            )}
            {ev && (
              <>
                <h3>Edition check</h3>
                {ev.roundup && <p className="why"><strong>Recommended structure: multi-topic news roundup.</strong> These stories share no genuine theme, so no connection will be claimed. They are presented as separate developments in one briefing.</p>}
                <p><span className={`chip ${ev.roundup ? "" : tone(ev.coherence.verdict)}`}>{ev.roundup ? "ROUNDUP: no connection claimed" : ev.coherence.verdict}{ev.coherence.score !== null ? ` · theme score ${ev.coherence.score}/100` : ""}</span>
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
            <div className="actions"><button className="primary" onClick={() => void save()} disabled={busy || !title.trim() || !ids.length}>{editionId ? "Save changes" : "Save edition (needed before approval)"}</button></div>

            {editionId && (
              <div className="confirm">
                <h3>3. Approve this edition</h3>
                <p className="meta">{approval?.current ? "Approved for exactly these developments." : approval?.membersChangedSinceApproval ? "The developments changed after approval: approve again." : approval?.decision ? `Latest decision: ${approval.decision.replace(/_/g, " ")}.` : "Not decided yet."}</p>
                <label className="inline"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I reviewed the coherence check and the evidence for each development.</label>
                <label>Notes{ev && !ev.roundup && ev.coherence.verdict !== "COHERENT" && ev.coherence.verdict !== "SINGLE DEVELOPMENT" ? " (required: you chose a thematic structure for a weak connection)" : " (optional)"}<input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} /></label>
                <div className="actions">
                  <button className="primary" disabled={busy || !ack} onClick={() => void decide("approved")}>Approve edition</button>
                  <button disabled={busy} onClick={() => void decide("needs_changes")}>Needs changes</button>
                  <button disabled={busy} onClick={() => void decide("rejected")}>Reject</button>
                </div>
              </div>
            )}

            <h3>4. Build the {editionKind === "text" ? "written briefing" : "video"} production prompt</h3>
            {!canBuild && <p className="meta">Available once the saved edition has a current approval.</p>}
            {canBuild && (
              <>
                {editionKind === "video" && <div className="row">
                  <label>Deliverable<select value={deliverable} onChange={(e) => setDeliverable(e.target.value)}><option value="script_storyboard">Script and storyboard</option><option value="animated_html">Animated HTML</option><option value="narrated_video">Narrated video</option></select></label>
                  <label>Length<select value={duration} onChange={(e) => setDuration(Number(e.target.value))}><option value={480}>8 minutes</option><option value={600}>10 minutes</option><option value={720}>12 minutes</option></select></label>
                </div>}
                {editionKind === "text" && <p className="meta">Written edition: target 12-18 stories and 1,500-2,200 words (about 5-8 minutes). Evidence quality takes priority over length; the prompt will not invent context or pad weak stories.</p>}
                {editionKind === "video" && cpv && (
                  <div className="panel">
                    <label>Programme format<select value={fmt} onChange={(e) => setFmt(e.target.value)}><option value="">Automatic: {cpv.format.label}</option>{cpv.formats.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select></label>
                    <p className="meta">{cpv.format.label}{cpv.format.overridden ? " (your choice)" : ""}: {cpv.format.why}.</p>
                    <p className="meta">Presenter voice: {cpv.voice.voice} ({cpv.voice.engine}) · {cpv.voice.status.replace(/_/g, " ")} · {cpv.voice.approval === "APPROVED" ? "listening approved" : cpv.voice.approval === "VOID_VOICE_CHANGED" ? "approval void: the voice changed" : "not approved by listening"} · licence {cpv.voice.licence.replace(/_/g, " ").toLowerCase()}. <a href="/creative">Presenter and voice setup</a></p>
                    <p className="meta">Runtime: about {cpv.runtime.total} seconds of {cpv.runtime.ceiling}, about {cpv.runtime.words} spoken words.{cpv.runtime.shorter ? " Shorter on purpose: the sourced material supports no more." : ""}</p>
                    {cpv.runtime.warnings.map((w, i) => <p key={i} className="caution">{w}</p>)}
                    {cpv.pronunciationCheckRequired.length > 0 && <p className="caution">PRONUNCIATION CHECK REQUIRED before recording: {cpv.pronunciationCheckRequired.map((x) => x.name).join(", ")}. <a href="/creative">Confirm names</a></p>}
                    <details><summary>Scene plan ({cpv.scenes.length} scenes)</summary>
                      <table><thead><tr><th>#</th><th>Scene</th><th>s</th><th>Delivery</th><th>Visual</th><th>Evidence</th></tr></thead><tbody>{cpv.scenes.map((x) => <tr key={x.n}><td>{x.n}</td><td>{x.ref ? `${x.ref} ` : ""}{x.title}</td><td>{x.seconds}</td><td>{x.delivery} ({x.pace} w/s)</td><td>{x.composition}</td><td>{x.tier.replace("_", " ")} · {x.intensity}</td></tr>)}</tbody></table>
                    </details>
                    <details><summary>Advanced: sound and visual direction</summary>
                      <div className="row">
                        <label>Sound<select value={sound} onChange={(e) => setSound(e.target.value)}><option value="subtle">Subtle: one music bed and restrained cues</option><option value="minimal">Minimal: motifs and silence only</option></select></label>
                        <label>Visual treatment<select value={visual} onChange={(e) => setVisual(e.target.value)}><option value="adaptive">Adaptive to each story and its evidence</option><option value="typographic">Typographic plates only</option></select></label>
                      </div>
                    </details>
                  </div>
                )}
                <label>Prompt angle override (optional)<input type="text" value={pAngle} onChange={(e) => setPAngle(e.target.value)} maxLength={200} /></label>
                {ids.map((id, i) => <label key={id}>Conflict note for D{i + 1} (only if you found accounts that disagree)<input type="text" value={conflicts[i] ?? ""} maxLength={600} onChange={(e) => setConflicts((c) => c.map((x, j) => (j === i ? e.target.value : x)))} /></label>)}
                <div className="actions"><button className="primary" onClick={() => void build()} disabled={busy}>{busy ? "CREATING…" : editionKind === "text" ? "Create text briefing prompt" : "Create video production prompt"}</button></div>
              </>
            )}
            {res && (
              <div>
                {res.saved ? <p className="status good">Saved to Edition Prompt History as version {res.version}.</p> : <p className="status bad">{res.note ?? "This prompt was NOT saved."}</p>}
                {res.creative && res.creative.pronunciationCheckRequired.length > 0 && <p className="caution">PRONUNCIATION CHECK REQUIRED: {res.creative.pronunciationCheckRequired.join(", ")}. This list is also inside the prompt.</p>}
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

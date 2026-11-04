import { useCallback, useEffect, useState } from "react";

type Allow = { discoveryVerifyMin: number; selectionMin: number; promptMin: number; productionMin: number; finalReviewMin: number };
type Slot = { label: string; time: string; days?: number[] };
type Config = { timezone: string; slots: Slot[]; coverageHours: number; allowances: Allow; atRiskBufferMin: number };
type TL = Record<string, { at: string; local: string }>;
type Story = { id: string; headline: string; cls: string; candidate: boolean; reason: string; corroborated: boolean; outlets: number; inEdition: boolean; mark: string | null; timeBasis: string };
type Cycle = {
  id: string; label: string; mode: string; plannedLocal: string; plannedPublishAt: string; timezone: string;
  coverage: { start: string; end: string; local: string; hours: number; halfOpen: string }; timeline: TL; editionId: string | null; editionMembers: number; approved: boolean; promptMade: boolean;
  stage: string; stageDone: { production?: string; review?: string };
  standing: { status: string; readiness: string | null; slackMin: number; remainingWorkMin: number; minutesToPublish: number; explanation: string; suggestedPublishLocal: string | null; actions: string[] };
  counts: { discovered: number; candidates: number; verified: number; selected: number };
  stories: Story[]; lateBreaking: (Story & { reason: string })[]; quiet: string | null;
};
type Planner = {
  installed: boolean; configured: boolean; config: Config; nowLocal: string;
  upcoming: { label: string; publishAt: string; local: string; timeline: TL }[];
  previous: { label: string; coverageLocal: string } | null; nextContinuousStart: string | null;
  history: { id: string; label: string; status: string; mode: string; plannedPublishAt: string; actualPublishedAt: string | null; coverageStart: string; coverageEnd: string; skipReason: string | null }[];
  missedSlots: { label: string; local: string }[]; cycle: Cycle | null;
};
type Preview = { window: { local: string; hours: number }; overlaps: { label: string; minutes: number }[]; stories: Story[] };

const api = "/.netlify/functions/";
const post = (body: unknown) => fetch(api + "cycles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const statusTone = (s: string) => (s === "ON SCHEDULE" ? "good" : "bad");
const CLS: Record<string, string> = { NEW: "New development", UPDATE: "Update to a published story", RENEWED: "Older story renewed", HELD_OVER: "Held over", ALREADY_PUBLISHED: "Already published", NEVER_VERIFIED: "Discovered, never verified", REJECTED_EARLIER: "Left out earlier", REJECTED: "Rejected" };
const hm = (m: number) => `${Math.floor(Math.abs(m) / 60)}h ${Math.abs(m) % 60}m`;
const STEPS: [string, string][] = [["researchCutoff", "Research cutoff (coverage ends)"], ["selectionStart", "Selection and coherence review starts"], ["selectionDeadline", "Selection deadline (prompt starts)"], ["productionStart", "Production in Claude starts"], ["finalReviewStart", "Final review starts"], ["publishAt", "Planned publication"]];

function Stories({ list, onHold }: { list: Story[]; onHold?: (s: Story) => void }) {
  if (!list.length) return <p className="meta">Nothing in this window.</p>;
  return <ul className="comps">{list.map((s) => (
    <li key={s.id}><span className={`chip ${s.candidate ? "" : "bad"}`}>{CLS[s.cls] ?? s.cls}</span> <strong>{s.headline}</strong> {s.corroborated ? "(corroborated)" : "(not corroborated)"}{s.inEdition ? " · in the edition" : ""}{s.mark ? ` · marked ${s.mark.replace("_", " ")}` : ""}
      <div className="meta">{s.reason} Times use {s.timeBasis}.</div>
      {onHold && s.candidate && !s.inEdition && !s.mark && <button onClick={() => onHold(s)}>Hold over to the next edition</button>}</li>))}</ul>;
}

export default function PlannerPage() {
  const [p, setP] = useState<Planner | null>(null);
  const [msg, setMsg] = useState("");
  const [now, setNow] = useState(Date.now());
  const [cfg, setCfg] = useState<Config | null>(null);
  const [editions, setEditions] = useState<{ id: string; title: string; members: number; approvalCurrent: boolean }[]>([]);
  const [pick, setPick] = useState(0);
  const [mode, setMode] = useState<"continuous" | "rolling" | "custom">("continuous");
  const [hours, setHours] = useState(12);
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [prev, setPrev] = useState<Preview | null>(null);
  const [linkId, setLinkId] = useState("");
  const [skipWhy, setSkipWhy] = useState("");

  const load = useCallback(async () => {
    const r = await fetch(api + "cycles");
    if (!r.ok) { setMsg(`Could not load the planner (${r.status}).`); return; }
    const j = (await r.json()) as Planner; setP(j); setCfg((c) => c ?? j.config);
    const e = await fetch(api + "editions"); if (e.ok) setEditions(((await e.json()).saved?.editions) ?? []);
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, [load]);

  const act = async (body: unknown, ok: string) => {
    const r = await post(body); const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? ok : `Not saved: ${j.detail ?? (j.errors ? j.errors.join(" ") : j.error ?? r.status)}`);
    if (r.ok) await load();
    return { r, j };
  };
  const winQuery = () => {
    const slot = p?.upcoming[pick];
    if (mode === "custom") return `mode=custom&from=${encodeURIComponent(new Date(from).toISOString())}&to=${encodeURIComponent(new Date(to).toISOString())}`;
    if (mode === "rolling") return `mode=rolling&hours=${hours}&end=now`;
    return `mode=continuous&publishAt=${encodeURIComponent(slot?.publishAt ?? "")}`;
  };
  const doPreview = async () => {
    try { const r = await fetch(`${api}cycles?preview=1&${winQuery()}`); const j = await r.json(); if (!r.ok) { setMsg(`Could not preview: ${j.detail ?? r.status}`); setPrev(null); } else { setPrev(j); setMsg(""); } } catch { setMsg("Could not preview: enter valid dates."); }
  };
  const doPlan = async (ack = false) => {
    const slot = p?.upcoming[pick]; if (!slot) return;
    const body: any = { action: "plan", publishAt: slot.publishAt, mode, label: slot.label, acknowledgeOverlap: ack };
    if (mode === "rolling") { body.hours = hours; body.end = "now"; }
    if (mode === "custom") { body.from = new Date(from).toISOString(); body.to = new Date(to).toISOString(); }
    const { r, j } = await act(body, "Edition planned.");
    if (!r.ok && j.error === "overlap" && confirm(`This window overlaps earlier coverage (${j.overlaps.map((o: any) => `${o.label}: ${o.minutes} min`).join(", ")}). Stories in the overlap may be repeats. Plan it anyway?`)) await doPlan(true);
  };

  if (!p) return <div className="page"><h1>Planner</h1>{msg ? <p className="status bad">{msg}</p> : <p className="meta">Loading…</p>}</div>;
  const c = p.cycle;
  const left = c ? Math.round((Date.parse(c.plannedPublishAt) - now) / 60000) : null;
  const upd = (patch: Partial<Config>) => setCfg((x) => ({ ...(x ?? p.config), ...patch }));
  const updA = (k: keyof Allow, v: number) => setCfg((x) => ({ ...(x ?? p.config), allowances: { ...(x ?? p.config).allowances, [k]: v } }));
  const AL: [keyof Allow, string][] = [["discoveryVerifyMin", "Research and verification (min)"], ["selectionMin", "Selection and coherence review (min)"], ["promptMin", "Prompt (min)"], ["productionMin", "Production in Claude (min)"], ["finalReviewMin", "Final review buffer (min)"]];

  return (
    <div className="page">
      <h1>Planner</h1>
      <p className="meta">Plans which news an edition covers and when the work must be done. It does not research, produce or publish anything. Now: {p.nowLocal}. Coverage time and production time are separate.</p>
      {msg && <p className={`status ${/Could not|Not saved|refus/i.test(msg) ? "bad" : "good"}`}>{msg}</p>}
      {!p.installed && <div className="panel"><p className="status bad">NOT INSTALLED: saving plans needs migration 005, which has not been run yet. You can still adjust the schedule and preview coverage windows.</p></div>}
      {p.installed && p.missedSlots.length > 0 && <div className="panel"><p className="caution">Scheduled editions with no plan since the last published edition: {p.missedSlots.map((m) => `${m.label} (${m.local})`).join("; ")}. The next continuous edition will cover that period, so nothing is lost.</p></div>}

      {c ? (
        <div className="panel">
          <h2>{c.label}: {c.plannedLocal}</h2>
          <p><span className={`chip ${statusTone(c.standing.status) === "good" ? "on" : "bad"}`}>{c.standing.status}</span> {c.standing.readiness && <span className="chip on">{c.standing.readiness}</span>} <span className="chip">Stage: {c.stage}</span></p>
          <p className="why">{c.standing.explanation}</p>
          {c.standing.actions.length > 0 && <div><strong>Options</strong><ul className="comps">{c.standing.actions.map((a, i) => <li key={i}>{a}</li>)}</ul></div>}
          <table>
            <tbody>
              <tr><td>Time remaining to publication</td><td>{left !== null && left >= 0 ? hm(left) : `passed ${hm(left ?? 0)} ago`}</td></tr>
              <tr><td>Production time remaining</td><td>{hm(c.standing.remainingWorkMin)} of allowances</td></tr>
              <tr><td>Coverage window ({c.mode}, {c.coverage.hours} h)</td><td>{c.coverage.local}</td></tr>
              <tr><td>Developments</td><td>{c.counts.discovered} discovered · {c.counts.candidates} candidates · {c.counts.verified} corroborated · {c.counts.selected} selected</td></tr>
              <tr><td>Edition readiness</td><td>{c.editionId ? `${c.editionMembers} developments · ${c.approved ? "approved" : "not approved"} · ${c.promptMade ? "prompt ready" : "no current prompt"}` : "No edition linked yet"}</td></tr>
              {p.previous && <tr><td>Previous edition</td><td>{p.previous.label}: covered {p.previous.coverageLocal}</td></tr>}
            </tbody>
          </table>
          <p className="meta">{c.coverage.halfOpen}</p>
          {c.quiet && <p className="caution">{c.quiet}</p>}
          <h3>Timeline (worked backward from publication)</h3>
          <ul className="comps">{STEPS.map(([k, l]) => <li key={k}><strong>{l}:</strong> {c.timeline[k]?.local}</li>)}</ul>

          <h3>Link the edition</h3>
          <div className="row">
            <label>Saved edition<select value={linkId || c.editionId || ""} onChange={(e) => setLinkId(e.target.value)}><option value="">Choose…</option>{editions.map((e) => <option key={e.id} value={e.id}>{e.title} ({e.members}){e.approvalCurrent ? " · approved" : ""}</option>)}</select></label>
            <button disabled={!linkId} onClick={() => act({ action: "link-edition", id: c.id, editionId: linkId }, "Edition linked.")}>Link</button>
            <a href="/editions">Open the Edition Desk →</a>
          </div>
          <h3>Production marks (set by you)</h3>
          <div className="actions">
            <label className="inline"><input type="checkbox" checked={!!c.stageDone.production} onChange={(e) => act({ action: "mark-stage", id: c.id, stage: "production", done: e.target.checked }, "Saved.")} /> Video produced in Claude</label>
            <label className="inline"><input type="checkbox" checked={!!c.stageDone.review} disabled={!c.stageDone.production} onChange={(e) => act({ action: "mark-stage", id: c.id, stage: "review", done: e.target.checked }, "Saved.")} /> Final review done</label>
          </div>
          <div className="actions">
            <button className="primary" disabled={!c.approved} onClick={() => { if (confirm("Record this edition as published? It marks its developments as published so the next edition does not repeat them.")) void act({ action: "publish", id: c.id }, "Recorded as published.").then(async ({ r, j }) => { if (!r.ok && j.error === "stages_incomplete" && confirm(j.detail)) await act({ action: "publish", id: c.id, acknowledgeSkippedStages: true }, "Recorded as published."); }); }}>Record as published</button>
            <input type="text" placeholder="Reason for skipping this edition" value={skipWhy} onChange={(e) => setSkipWhy(e.target.value)} />
            <button disabled={skipWhy.trim().length < 5} onClick={() => act({ action: "skip", id: c.id, reason: skipWhy }, "Skipped. The next edition will cover this period.")}>Skip this edition</button>
          </div>
          {!c.approved && <p className="meta">Publishing needs the linked edition to be approved in the Edition Desk.</p>}

          {c.lateBreaking.length > 0 && (
            <div className="panel"><h3>Late-breaking candidates ({c.lateBreaking.length})</h3>
              <p className="meta">Reported after the research cutoff. They never change an approved edition by themselves. To include one, add it in the Edition Desk and approve again; otherwise hold it over.</p>
              <Stories list={c.lateBreaking.map((s) => ({ ...s, cls: "NEW", candidate: true }))} onHold={(s) => act({ action: "mark-story", id: c.id, storyId: s.id, mark: "held_over", note: "late-breaking, deferred" }, "Held over.")} />
            </div>)}
          <h3>Stories in this window</h3>
          <Stories list={c.stories} onHold={(s) => act({ action: "mark-story", id: c.id, storyId: s.id, mark: "held_over" }, "Held over.")} />
        </div>
      ) : (
        <div className="panel">
          <h2>Plan the next edition</h2>
          <p className="meta">Choose which scheduled time to plan for and what news it covers.</p>
          <div className="row">
            <label>Edition<select value={pick} onChange={(e) => setPick(+e.target.value)}>{p.upcoming.map((u, i) => <option key={u.publishAt} value={i}>{u.label}: {u.local}</option>)}</select></label>
            <label>Coverage<select value={mode} onChange={(e) => { setMode(e.target.value as any); setPrev(null); }}>
              <option value="continuous">Continuous: since the previous edition{p.nextContinuousStart ? "" : " (first edition: default hours)"}</option>
              <option value="rolling">Rolling: the last N hours</option>
              <option value="custom">Custom date and time range</option>
            </select></label>
            {mode === "rolling" && <label>Hours<select value={hours} onChange={(e) => setHours(+e.target.value)}>{[6, 12, 24, 48].map((h) => <option key={h} value={h}>{h}</option>)}</select></label>}
            {mode === "custom" && <><label>From (your browser time)<input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label>To<input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} /></label></>}
          </div>
          {p.upcoming[pick] && <p className="meta">Research cutoff for this edition: {p.upcoming[pick].timeline.researchCutoff.local}. Selection deadline: {p.upcoming[pick].timeline.selectionDeadline.local}.</p>}
          <div className="actions">
            <button onClick={doPreview}>Preview what this window covers</button>
            <button className="primary" disabled={!p.installed} onClick={() => doPlan()}>Plan this edition</button>
          </div>
          {prev && <div><h3>{prev.window.hours} hours: {prev.window.local}</h3>{prev.overlaps.length > 0 && <p className="caution">Overlaps earlier coverage: {prev.overlaps.map((o) => `${o.label} (${o.minutes} min)`).join(", ")}.</p>}<Stories list={prev.stories} /></div>}
        </div>
      )}

      <details className="panel">
        <summary>Schedule and time allowances</summary>
        {cfg && <>
          <p className="meta">Nothing here is fixed. Times are in the timezone you choose. The research cutoff is worked out backward from each publication time using these allowances.</p>
          <div className="row">
            <label>Timezone<input type="text" value={cfg.timezone} onChange={(e) => upd({ timezone: e.target.value })} /></label>
            <label>Default coverage (hours)<input type="number" value={cfg.coverageHours} onChange={(e) => upd({ coverageHours: +e.target.value })} /></label>
            <label>At-risk tolerance (min)<input type="number" value={cfg.atRiskBufferMin} onChange={(e) => upd({ atRiskBufferMin: +e.target.value })} /></label>
          </div>
          <h3>Publication times</h3>
          {cfg.slots.map((s, i) => (
            <div className="row" key={i}>
              <label>Name<input type="text" value={s.label} onChange={(e) => upd({ slots: cfg.slots.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} /></label>
              <label>Time (24h)<input type="text" value={s.time} onChange={(e) => upd({ slots: cfg.slots.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)) })} /></label>
              <button disabled={cfg.slots.length < 2} onClick={() => upd({ slots: cfg.slots.filter((_, j) => j !== i) })}>Remove</button>
            </div>))}
          <button disabled={cfg.slots.length >= 6} onClick={() => upd({ slots: [...cfg.slots, { label: `Edition ${cfg.slots.length + 1}`, time: "12:00" }] })}>Add a publication time</button>
          <h3>Time allowances</h3>
          <div className="row">{AL.map(([k, l]) => <label key={k}>{l}<input type="number" value={cfg.allowances[k]} onChange={(e) => updA(k, +e.target.value)} /></label>)}</div>
          <button className="primary" onClick={() => act({ action: "save-config", config: cfg }, "Schedule saved.")}>Save schedule</button>
          {!p.configured && <p className="meta">Showing defaults (6 AM and 6 PM, New York) until you save.</p>}
        </>}
      </details>

      {p.history.length > 0 && <details className="panel"><summary>Previous editions ({p.history.length})</summary>
        <ul className="comps">{p.history.map((h) => <li key={h.id}><strong>{h.label}</strong> · {h.status}{h.status === "published" && h.actualPublishedAt ? ` ${new Date(h.actualPublishedAt).toLocaleString()}` : ""} · {h.mode} · covered {new Date(h.coverageStart).toLocaleString()} to {new Date(h.coverageEnd).toLocaleString()}{h.skipReason ? ` · skipped: ${h.skipReason}` : ""}</li>)}</ul></details>}
    </div>
  );
}

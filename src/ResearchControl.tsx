import { useCallback, useEffect, useRef, useState } from "react";

const REGIONS = ["Africa", "Asia", "Europe", "Latin America", "Middle East", "North America", "Oceania"];
const CATEGORIES = [
  "Laws and regulations",
  "Government and institutional decisions",
  "Scientific discoveries",
  "Technology",
  "Business and economic developments",
  "Environment and climate",
  "Public policy",
  "International affairs",
  "Significant consequences",
];

type Run = { id: string; status: string; current_stage: string | null; created_at: string; config: any };
type Source = {
  id: string; name: string; publisher: string | null; feed_url: string | null; source_url: string | null;
  enabled: boolean; retrieval_status: string; last_error: string | null;
};

const newKey = () => crypto.randomUUID().replace(/-/g, "");

function Toggle({ items, value, onChange }: { items: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="chips">
      {items.map((i) => (
        <label key={i} className={value.includes(i) ? "chip on" : "chip"}>
          <input
            type="checkbox"
            checked={value.includes(i)}
            onChange={() => onChange(value.includes(i) ? value.filter((v) => v !== i) : [...value, i])}
          />
          {i}
        </label>
      ))}
    </div>
  );
}

export default function ResearchControl() {
  const [regions, setRegions] = useState<string[]>(REGIONS);
  const [categories, setCategories] = useState<string[]>(CATEGORIES);
  const [windowDays, setWindowDays] = useState(2);
  const [maxSources, setMaxSources] = useState(50);
  const [runs, setRuns] = useState<Run[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const key = useRef(newKey());
  const [form, setForm] = useState({ name: "", publisher: "", feedUrl: "", sourceUrl: "" });
  const [srcMsg, setSrcMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([fetch("/.netlify/functions/runs"), fetch("/.netlify/functions/sources")]);
      if (r.ok) setRuns((await r.json()).runs);
      if (s.ok) setSources((await s.json()).sources);
      if (!r.ok || !s.ok) setMsg("Could not load all records. Check System Health.");
    } catch {
      setMsg("Could not reach the server.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const start = async () => {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/.netlify/functions/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: key.current, config: { regions, categories, windowDays, maxSources } }),
      });
      if (res.ok) {
        key.current = newKey(); // next click is a new run; a repeated click of THIS request reuses the key
        setMsg("Run recorded. Discovery is not built yet, so nothing was searched.");
        await load();
      } else {
        setMsg("The run was NOT saved. Check System Health, then try again.");
      }
    } catch {
      setMsg("The run was NOT saved (could not reach the server).");
    }
    setBusy(false);
  };

  const addSource = async (e: React.FormEvent) => {
    e.preventDefault();
    setSrcMsg("");
    const res = await fetch("/.netlify/functions/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      setForm({ name: "", publisher: "", feedUrl: "", sourceUrl: "" });
      setSrcMsg("Source added (disabled and untested).");
      await load();
    } else if (res.status === 409) setSrcMsg("A source with that name already exists.");
    else if (res.status === 400) setSrcMsg("Check the name and web addresses (must start with https://).");
    else setSrcMsg("Not saved. Check System Health.");
  };

  const toggle = async (s: Source) => {
    const res = await fetch("/.netlify/functions/sources", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: s.id, enabled: !s.enabled }),
    });
    if (!res.ok) setSrcMsg("Change not saved.");
    await load();
  };

  return (
    <section>
      <h1>Research Control</h1>

      <div className="panel">
        <h2>Start a research run</h2>
        <p className="status">Records the run and its settings. Discovery is not built yet (Phase 2).</p>
        <h3>Regions</h3>
        <Toggle items={REGIONS} value={regions} onChange={setRegions} />
        <h3>Categories</h3>
        <Toggle items={CATEGORIES} value={categories} onChange={setCategories} />
        <div className="row">
          <label>
            Time window (days, 1–14)
            <input type="number" min={1} max={14} value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))} />
          </label>
          <label>
            Max sources (5–100)
            <input type="number" min={5} max={100} value={maxSources} onChange={(e) => setMaxSources(Number(e.target.value))} />
          </label>
        </div>
        <button className="primary" onClick={() => void start()} disabled={busy || regions.length === 0 || categories.length === 0}>
          {busy ? "SAVING…" : "RECORD RUN"}
        </button>
        {msg && <p className="status">{msg}</p>}
      </div>

      <div className="panel">
        <h2>Recent runs</h2>
        {runs.length === 0 ? (
          <p>No runs yet.</p>
        ) : (
          <table>
            <thead><tr><th>Started</th><th>Status</th><th>Stage</th><th>Window</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.created_at).toLocaleString()}</td>
                  <td>{r.status}</td>
                  <td>{r.current_stage ?? "—"}</td>
                  <td>{r.config?.windowDays ?? "—"} d</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2>Source registry</h2>
        <p>New sources start <strong>disabled</strong> and <strong>untested</strong>. Add only real feed addresses you have checked. Nothing here is searched until Phase 2.</p>
        {sources.length > 0 && (
          <table>
            <thead><tr><th>Name</th><th>Feed</th><th>Status</th><th>Enabled</th></tr></thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.feed_url ?? s.source_url ?? "—"}</td>
                  <td>{s.retrieval_status}</td>
                  <td><button onClick={() => void toggle(s)}>{s.enabled ? "Disable" : "Enable"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form onSubmit={addSource} className="row stack">
          <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
          <label>Publisher<input value={form.publisher} onChange={(e) => setForm({ ...form, publisher: e.target.value })} /></label>
          <label>Website address<input value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} placeholder="https://" /></label>
          <label>Feed address (optional)<input value={form.feedUrl} onChange={(e) => setForm({ ...form, feedUrl: e.target.value })} placeholder="https://" /></label>
          <button>Add source</button>
          {srcMsg && <p className="status">{srcMsg}</p>}
        </form>
      </div>
    </section>
  );
}

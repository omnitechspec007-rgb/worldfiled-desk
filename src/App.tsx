import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import Dashboard from "./Dashboard";
import StoryDesk from "./StoryDesk";
import EvidenceRoom from "./EvidenceRoom";
import EditorialReview from "./EditorialReview";
import Architect from "./Architect";
import ReferenceLibrary from "./ReferenceLibrary";
import PromptHistory from "./PromptHistory";
import EditionDesk from "./EditionDesk";

const NAV = [
  { to: "/", label: "Dashboard" },
  { to: "/stories", label: "Story Desk" },
  { to: "/evidence", label: "Evidence Room" },
  { to: "/review", label: "Editorial Review" },
  { to: "/editions", label: "Edition Desk" },
  { to: "/architect", label: "Prompt Architect" },
  { to: "/reference", label: "Reference Library" },
  { to: "/history", label: "Prompt History" },
  { to: "/health", label: "System Health" },
];

type Health =
  | { state: "loading" }
  | { state: "done"; database: string; detail: string }
  | { state: "error"; detail: string };

type SourceRow = { id: string; name: string; country_scope: string | null; retrieval_status: string; last_checked_at: string | null; last_error: string | null };

function SystemHealth() {
  const [health, setHealth] = useState<Health>({ state: "loading" });
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [regions, setRegions] = useState<{ region: string; healthy: number; total: number }[]>([]);
  const [note, setNote] = useState("");

  const check = async () => {
    setHealth({ state: "loading" });
    try {
      const res = await fetch("/.netlify/functions/health");
      const data = await res.json();
      setHealth({ state: "done", database: String(data.database), detail: String(data.detail) });
    } catch {
      setHealth({ state: "error", detail: "Could not reach the health function." });
    }
    try {
      const [s, st] = await Promise.all([fetch("/.netlify/functions/sources"), fetch("/.netlify/functions/status")]);
      if (s.ok) setSources((await s.json()).sources);
      if (st.ok) {
        const d = await st.json();
        setRegions(d.regions);
        setNote(d.latest?.error_summary ?? "");
      }
    } catch {
      /* shown as missing data */
    }
  };

  useEffect(() => {
    void check();
  }, []);

  const order: Record<string, number> = { failing: 0, degraded: 1, untested: 2, healthy: 3 };
  const sorted = [...sources].sort((a, b) => (order[a.retrieval_status] ?? 9) - (order[b.retrieval_status] ?? 9) || a.name.localeCompare(b.name));

  return (
    <section>
      <h1>System Health</h1>
      <div className="panel">
        <h2>Database</h2>
        {health.state === "loading" && <p className="status">Checking…</p>}
        {health.state === "error" && <p className="status bad">FAILED — {health.detail}</p>}
        {health.state === "done" && (
          <p className={health.database === "connected" ? "status good" : "status bad"}>
            {health.database.toUpperCase()} — {health.detail}
          </p>
        )}
        <button onClick={() => void check()}>Check again</button>
      </div>
      <div className="panel">
        <h2>Regional coverage</h2>
        <p>A region with no reachable source is a gap in coverage. It does not mean nothing happened there.</p>
        <div className="chips">
          {regions.map((r) => (
            <span key={r.region} className={r.healthy > 0 ? "chip on" : "chip bad"}>{r.region}: {r.healthy}/{r.total}</span>
          ))}
        </div>
        {note && <p className="status bad">Last run: {note}</p>}
      </div>
      <div className="panel">
        <h2>Sources ({sources.length})</h2>
        <p>Tested automatically on every run. Problems are listed first. Failed sources are switched off until they respond again.</p>
        <table>
          <thead><tr><th>Source</th><th>Where</th><th>Status</th><th>Detail</th></tr></thead>
          <tbody>
            {sorted.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.country_scope ?? "—"}</td>
                <td className={s.retrieval_status === "healthy" ? "ok" : s.retrieval_status === "untested" ? "" : "bad"}>{s.retrieval_status}</td>
                <td>{s.last_error ?? (s.last_checked_at ? `checked ${new Date(s.last_checked_at).toLocaleString()}` : "not tested yet")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type Auth = "loading" | "in" | "out" | "not_configured" | "error";

function Login({ onDone, notConfigured }: { onDone: () => void; notConfigured: boolean }) {
  const [pass, setPass] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/.netlify/functions/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", passphrase: pass }),
      });
      if (res.ok) onDone();
      else setMsg(res.status === 401 ? "Incorrect passphrase." : "Sign-in is unavailable. Check Netlify settings.");
    } catch {
      setMsg("Could not reach the server.");
    }
    setBusy(false);
  };

  return (
    <div className="login">
      <form className="panel" onSubmit={submit}>
        <span className="brand-name dark">The World, Filed.</span>
        <h1>WorldFiled Desk</h1>
        {notConfigured ? (
          <p className="status bad">
            Not configured: set EDITOR_PASSPHRASE and SESSION_SECRET in Netlify environment variables, then redeploy.
          </p>
        ) : (
          <>
            <label htmlFor="pp">Editor passphrase</label>
            <input
              id="pp"
              type="password"
              autoComplete="current-password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              autoFocus
            />
            <button className="primary" disabled={busy || pass.length === 0}>
              {busy ? "Signing in…" : "SIGN IN"}
            </button>
            {msg && <p className="status bad">{msg}</p>}
          </>
        )}
      </form>
    </div>
  );
}

export default function App() {
  const [auth, setAuth] = useState<Auth>("loading");

  const refresh = async () => {
    try {
      const res = await fetch("/.netlify/functions/auth");
      if (res.status === 503) return setAuth("not_configured");
      const data = await res.json();
      setAuth(data.authenticated ? "in" : "out");
    } catch {
      setAuth("error");
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const logout = async () => {
    await fetch("/.netlify/functions/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
    setAuth("out");
  };

  if (auth === "loading") return <div className="login"><p className="status">Loading…</p></div>;
  if (auth === "error")
    return <div className="login"><p className="status bad">Could not reach the server.</p></div>;
  if (auth !== "in") return <Login onDone={() => void refresh()} notConfigured={auth === "not_configured"} />;
  return <Desk onLogout={() => void logout()} />;
}

function Desk({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-name">The World, Filed.</span>
          <span className="brand-tag">What happened. What changed. What matters.</span>
        </div>
        <nav>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === "/"} className={({ isActive }) => (isActive ? "active" : "")}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <button className="linklike" onClick={onLogout}>Sign out</button>
        <a className="logo-download" href="/brand/TWF_final_logo.svg" download="TWF_final_logo.svg">Download official logo (SVG)</a>
        <span className="desk-label">WorldFiled Desk · v0.1</span>
      </aside>
      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/stories" element={<StoryDesk />} />
          <Route path="/evidence" element={<EvidenceRoom />} />
          <Route path="/evidence/:id" element={<EvidenceRoom />} />
          <Route path="/review" element={<EditorialReview />} />
          <Route path="/editions" element={<EditionDesk />} />
          <Route path="/architect" element={<Architect />} />
          <Route path="/reference" element={<ReferenceLibrary />} />
          <Route path="/history" element={<PromptHistory />} />
          <Route path="/health" element={<SystemHealth />} />
        </Routes>
      </main>
    </div>
  );
}

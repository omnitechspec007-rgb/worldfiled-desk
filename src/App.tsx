import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import ResearchControl from "./ResearchControl";

const NAV = [
  { to: "/", label: "Dashboard" },
  { to: "/research", label: "Research Control" },
  { to: "/stories", label: "Story Desk" },
  { to: "/evidence", label: "Evidence Room" },
  { to: "/review", label: "Editorial Review" },
  { to: "/production", label: "Production Studio" },
  { to: "/health", label: "System Health" },
];

function Placeholder({ title, phase, note }: { title: string; phase: string; note: string }) {
  return (
    <section>
      <h1>{title}</h1>
      <div className="panel">
        <p className="status">NOT BUILT YET — planned for {phase}</p>
        <p>{note}</p>
      </div>
    </section>
  );
}

function Dashboard() {
  return (
    <section>
      <h1>Dashboard</h1>
      <div className="panel">
        <button className="primary" disabled title="Research is not built yet">
          RUN RESEARCH
        </button>
        <p className="status">Disabled: the research pipeline arrives in Phase 2. Nothing is running.</p>
      </div>
      <div className="grid">
        {["Stories discovered", "Awaiting verification", "Awaiting editorial review", "Approved stories"].map(
          (label) => (
            <div className="panel stat" key={label}>
              <span className="stat-label">{label}</span>
              <span className="stat-value">—</span>
              <span className="stat-note">No data yet</span>
            </div>
          )
        )}
      </div>
    </section>
  );
}

type Health =
  | { state: "loading" }
  | { state: "done"; database: string; detail: string }
  | { state: "error"; detail: string };

function SystemHealth() {
  const [health, setHealth] = useState<Health>({ state: "loading" });

  const check = async () => {
    setHealth({ state: "loading" });
    try {
      const res = await fetch("/.netlify/functions/health");
      const data = await res.json();
      setHealth({ state: "done", database: String(data.database), detail: String(data.detail) });
    } catch {
      setHealth({ state: "error", detail: "Could not reach the health function." });
    }
  };

  useEffect(() => {
    void check();
  }, []);

  return (
    <section>
      <h1>System Health</h1>
      <div className="panel">
        <h2>Database connectivity</h2>
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
        <h2>Not yet monitored</h2>
        <p>Source retrieval health, failed jobs, usage limits and AI status will appear here in later phases.</p>
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
        <span className="desk-label">WorldFiled Desk · v0.1</span>
      </aside>
      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/research" element={<ResearchControl />} />
          <Route
            path="/stories"
            element={<Placeholder title="Story Desk" phase="Phase 4" note="Searchable, filterable discovered stories." />}
          />
          <Route
            path="/evidence"
            element={<Placeholder title="Evidence Room" phase="Phase 3" note="Claims, evidence passages, contradictions and source links." />}
          />
          <Route
            path="/review"
            element={<Placeholder title="Editorial Review" phase="Phase 4" note="Edit, reject or approve. Approval will always require a deliberate human action." />}
          />
          <Route
            path="/production"
            element={<Placeholder title="Production Studio" phase="Phase 5" note="Text-card copy, captions and approval-gated exports." />}
          />
          <Route path="/health" element={<SystemHealth />} />
        </Routes>
      </main>
    </div>
  );
}

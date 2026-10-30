import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";

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
      setHealth({ state: "done", database: data.database, detail: data.detail });
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

export default function App() {
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
        <span className="desk-label">WorldFiled Desk · v0.1</span>
      </aside>
      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route
            path="/research"
            element={<Placeholder title="Research Control" phase="Phase 2" note="Choose coverage, categories and limits, and resume runs." />}
          />
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

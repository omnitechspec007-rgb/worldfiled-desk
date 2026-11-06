import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import Dashboard from "./Dashboard";
import StoryDesk from "./StoryDesk";
import EvidenceRoom from "./EvidenceRoom";
import EditorialReview from "./EditorialReview";
import Architect from "./Architect";
import ReferenceLibrary from "./ReferenceLibrary";
import PromptHistory from "./PromptHistory";
import EditionDesk from "./EditionDesk";
import Planner from "./Planner";
import CreativeSetup from "./CreativeSetup";

const NAV_GROUPS = [
  { label: "RESEARCH", items: [
    { to: "/", label: "Dashboard" }, { to: "/stories", label: "Story Desk" },
    { to: "/evidence", label: "Evidence Room" }, { to: "/review", label: "Editorial Review" },
  ] },
  { label: "EDITION WORKFLOW", items: [
    { to: "/planner", label: "Planner" }, { to: "/editions", label: "Edition Desk" },
    { to: "/creative", label: "Presenter and Voice" }, { to: "/architect", label: "Prompt Architect" },
  ] },
  { label: "LIBRARY & SYSTEM", items: [
    { to: "/reference", label: "Reference Library" }, { to: "/history", label: "Prompt History" },
    { to: "/health", label: "System Health" },
  ] },
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
  const location = useLocation();
  const navigate = useNavigate();
  const titles: Record<string, string> = {
    "/": "Dashboard", "/stories": "Story Desk", "/evidence": "Evidence Room",
    "/review": "Editorial Review", "/planner": "Planner", "/editions": "Edition Desk",
    "/creative": "Presenter and Voice", "/architect": "Prompt Architect",
    "/reference": "Reference Library", "/history": "Prompt History", "/health": "System Health",
  };
  const parent: Record<string, string> = {
    "/stories": "/", "/evidence": "/stories", "/review": "/stories", "/planner": "/",
    "/editions": "/planner", "/creative": "/editions", "/architect": "/editions",
    "/reference": "/", "/history": "/architect", "/health": "/",
  };
  const [editionDirty, setEditionDirty] = useState(false);
  useEffect(() => {
    const update = (event: Event) => setEditionDirty(Boolean((event as CustomEvent<{ dirty?: boolean }>).detail?.dirty));
    window.addEventListener("worldfiled:edition-dirty", update);
    return () => window.removeEventListener("worldfiled:edition-dirty", update);
  }, []);
  const confirmLeave = () => !editionDirty || window.confirm("You have unsaved Edition Desk changes. Your draft is saved in this browser, but your changes are not yet saved to your account. Leave this page?");
  const from = (location.state as { from?: string } | null)?.from;
  const backTo = from && from !== location.pathname && titles[from] ? from : parent[location.pathname] ?? "/";
  const pageTitle = titles[location.pathname] ?? (location.pathname.startsWith("/evidence/") ? "Evidence Room" : "WorldFiled Desk");
  return (
    <div className="shell" onClickCapture={(event) => {
      if (!editionDirty) return;
      const target = event.target as HTMLElement;
      const link = target.closest("a[href^='/']") as HTMLAnchorElement | null;
      if (link && !link.target && !link.hasAttribute("download") && !confirmLeave()) {
        event.preventDefault();
        event.stopPropagation();
      }
    }}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-name">The World, Filed.</span>
          <span className="brand-tag">What happened. What changed. What matters.</span>
        </div>
        <nav aria-label="Main navigation">
          {NAV_GROUPS.map((group) => (
            <div className="nav-group" key={group.label}>
              <span className="nav-group-label">{group.label}</span>
              {group.items.map((n) => (
                <NavLink key={n.to} to={n.to} state={{ from: location.pathname }} end={n.to === "/"} className={({ isActive }) => (isActive ? "active" : "")}>
                  {n.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <button className="linklike" onClick={() => { if (confirmLeave()) onLogout(); }}>Sign out</button>
        <a className="logo-download" href="/brand/TWF_final_logo.svg" download="TWF_final_logo.svg">Download official logo (SVG)</a>
        <span className="desk-label">WorldFiled Desk · v0.1</span>
      </aside>
      <main>
        <div className="page-toolbar">
          <button className="back-button" onClick={() => { if (confirmLeave()) navigate(backTo); }} aria-label="Go back to the previous workflow page">
            <span aria-hidden="true">←</span> Back
          </button>
          <span className="page-context">{pageTitle}</span>
        </div>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/stories" element={<StoryDesk />} />
          <Route path="/evidence" element={<EvidenceRoom />} />
          <Route path="/evidence/:id" element={<EvidenceRoom />} />
          <Route path="/review" element={<EditorialReview />} />
          <Route path="/planner" element={<Planner />} />
          <Route path="/editions" element={<EditionDesk />} />
          <Route path="/creative" element={<CreativeSetup />} />
          <Route path="/architect" element={<Architect />} />
          <Route path="/reference" element={<ReferenceLibrary />} />
          <Route path="/history" element={<PromptHistory />} />
          <Route path="/health" element={<SystemHealth />} />
        </Routes>
      </main>
    </div>
  );
}

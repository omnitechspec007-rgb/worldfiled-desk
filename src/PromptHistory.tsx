import { useEffect, useState } from "react";

type Item = { id: string; storyId: string; headline: string; version: number; treatment: string; createdAt: string; approvalCurrent: boolean };
type EItem = { id: string; editionId: string; title: string; version: number; structure: string; deliverable: string; developments: number; createdAt: string; current: boolean; reasons: string[] };
type EDetail = { id: string; version: number; title: string; prompt: string | null; withheld?: string; valid: boolean; reasons: string[] };
type Detail = { id: string; version: number; prompt: string | null; withheld?: string; approvalCurrent: boolean; treatment: string };

export default function PromptHistory() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [open, setOpen] = useState<Detail | null>(null);
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [eItems, setEItems] = useState<EItem[] | null>(null);
  const [eMissing, setEMissing] = useState(false);
  const [eOpen, setEOpen] = useState<EDetail | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/.netlify/functions/creative?history=1");
        if (!r.ok) throw new Error();
        const d = await r.json();
        setMissing(!!d.notInstalled);
        setItems(d.prompts);
      } catch {
        setMsg("Could not load Prompt History.");
      }
    })();
    (async () => {
      try {
        const r = await fetch("/.netlify/functions/edition-prompt?history=1");
        if (!r.ok) throw new Error();
        const d = await r.json();
        setEMissing(!!d.notInstalled);
        setEItems(d.prompts);
      } catch {
        setMsg("Could not load Edition Prompt History.");
      }
    })();
  }, []);

  const viewEdition = async (id: string) => {
    setCopied(false);
    try {
      const r = await fetch(`/.netlify/functions/edition-prompt?id=${id}`);
      if (!r.ok) throw new Error();
      setEOpen(await r.json());
    } catch {
      setMsg("Could not open that edition prompt.");
    }
  };

  const view = async (id: string) => {
    setCopied(false);
    try {
      const r = await fetch(`/.netlify/functions/creative?id=${id}`);
      if (!r.ok) throw new Error();
      setOpen(await r.json());
    } catch {
      setMsg("Could not open that prompt.");
    }
  };

  return (
    <section>
      <h1>Prompt History</h1>
      <h2>Single-story prompts</h2>
      <p className="meta">Every prompt you create is saved, unchanged. A prompt can only be copied while the story's newest decision is still "approved".</p>
      {msg && <p className="status bad">{msg}</p>}
      {missing && <div className="panel"><p className="status bad">NOT INSTALLED: Prompt History needs migration 003, which has not been run yet.</p></div>}
      {items && items.length === 0 && !missing && <div className="panel"><p>No prompts saved yet.</p></div>}
      {items && items.length > 0 && (
        <div className="panel">
          <table>
            <thead><tr><th>Story</th><th>Version</th><th>Approach</th><th>Created</th><th>Approval</th><th></th></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>{i.headline}</td><td>v{i.version}</td><td>{i.treatment.replace(/_/g, " ")}</td>
                  <td>{new Date(i.createdAt).toLocaleString()}</td>
                  <td className={i.approvalCurrent ? "ok" : "bad"}>{i.approvalCurrent ? "current" : "no longer current"}</td>
                  <td><button onClick={() => void view(i.id)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <div className="panel">
          <h2>Version {open.version} · {open.treatment.replace(/_/g, " ")}</h2>
          {open.prompt ? (
            <>
              <textarea readOnly value={open.prompt} rows={16} />
              <button className="primary" onClick={() => { void navigator.clipboard?.writeText(open.prompt!).then(() => setCopied(true)).catch(() => setMsg("Copy was blocked by the browser.")); }}>{copied ? "Copied" : "Copy prompt"}</button>
            </>
          ) : (
            <p className="caution">{open.withheld}</p>
          )}
        </div>
      )}
      <h2>Edition prompts</h2>
      <p className="meta">Edition prompts are saved unchanged with the exact developments and evidence they used. A prompt can only be copied while the edition's approval, its developments and their evidence are all unchanged.</p>
      {eMissing && <div className="panel"><p className="status bad">NOT INSTALLED: Edition Prompt History needs migration 004, which has not been run yet.</p></div>}
      {eItems && eItems.length === 0 && !eMissing && <div className="panel"><p>No edition prompts saved yet.</p></div>}
      {eItems && eItems.length > 0 && (
        <div className="panel">
          <table>
            <thead><tr><th>Edition</th><th>Version</th><th>Structure</th><th>Developments</th><th>Created</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {eItems.map((i) => (
                <tr key={i.id}>
                  <td>{i.title}</td><td>v{i.version}</td><td>{i.structure.replace(/_/g, " ")}</td><td>{i.developments}</td>
                  <td>{new Date(i.createdAt).toLocaleString()}</td>
                  <td className={i.current ? "ok" : "bad"}>{i.current ? "current" : "may be invalid"}</td>
                  <td><button onClick={() => void viewEdition(i.id)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {eOpen && (
        <div className="panel">
          <h2>{eOpen.title} · version {eOpen.version}</h2>
          {eOpen.prompt ? (
            <>
              <textarea readOnly value={eOpen.prompt} rows={16} />
              <button className="primary" onClick={() => { void navigator.clipboard?.writeText(eOpen.prompt!).then(() => setCopied(true)).catch(() => setMsg("Copy was blocked by the browser.")); }}>{copied ? "Copied" : "Copy prompt"}</button>
            </>
          ) : (
            <p className="caution">{eOpen.withheld}</p>
          )}
        </div>
      )}
    </section>
  );
}

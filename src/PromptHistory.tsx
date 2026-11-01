import { useEffect, useState } from "react";

type Item = { id: string; storyId: string; headline: string; version: number; treatment: string; createdAt: string; approvalCurrent: boolean };
type Detail = { id: string; version: number; prompt: string | null; withheld?: string; approvalCurrent: boolean; treatment: string };

export default function PromptHistory() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [open, setOpen] = useState<Detail | null>(null);
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);

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
  }, []);

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
    </section>
  );
}

import { useMemo, useState } from "react";
import { lintDraft } from "../netlify/lib/draft-audit.mts";

const EXAMPLE = "In a significant development, the government announced a new policy.\nExperts say the move is groundbreaking.\n\nAt the end of the day, the details still matter.";

export default function DraftAudit() {
  const [draft, setDraft] = useState("");
  const [audited, setAudited] = useState(false);
  const findings = useMemo(() => audited ? lintDraft(draft) : [], [audited, draft]);
  const reviewCount = findings.filter((item) => item.severity === "review").length;
  const suggestionCount = findings.filter((item) => item.severity === "suggestion").length;

  const clear = () => { setDraft(""); setAudited(false); };
  const loadExample = () => { setDraft(EXAMPLE); setAudited(false); };

  return (
    <section className="draft-audit">
      <div className="page-intro">
        <p className="eyebrow">EDITORIAL QUALITY · ADVISORY CHECK</p>
        <h1>Draft Audit</h1>
        <p>Catch formulaic writing and obvious evidence-readiness gaps before a draft moves forward. This is a second pair of eyes, not a fact-checker or publishing approval.</p>
      </div>

      <div className="panel">
        <div className="audit-toolbar">
          <div>
            <h2>Paste a draft</h2>
            <p className="muted">Text is checked in this browser. It is not uploaded or saved.</p>
          </div>
          <div className="audit-actions">
            <button type="button" onClick={loadExample}>Load example</button>
            <button type="button" onClick={clear} disabled={!draft}>Clear</button>
          </div>
        </div>
        <label className="draft-label" htmlFor="draft-audit-input">Draft text</label>
        <textarea
          id="draft-audit-input"
          className="draft-input"
          value={draft}
          onChange={(event) => { setDraft(event.target.value); setAudited(false); }}
          placeholder="Paste your story, script or text-card copy here…"
          rows={13}
          spellCheck
        />
        <div className="audit-footer">
          <span className="muted">{draft.length.toLocaleString()} characters · {draft.trim() ? draft.trim().split(/\s+/).length.toLocaleString() : 0} words</span>
          <button className="primary" type="button" onClick={() => setAudited(true)} disabled={!draft.trim()}>Run draft audit</button>
        </div>
      </div>

      {audited && (
        <div className="panel" aria-live="polite">
          <div className="audit-result-heading">
            <div>
              <p className="eyebrow">DETERMINISTIC TEXT CHECK</p>
              <h2>Review findings</h2>
            </div>
            <div className="audit-counts">
              <span><strong>{findings.length}</strong> total</span>
              <span><strong>{reviewCount}</strong> review</span>
              <span><strong>{suggestionCount}</strong> suggestions</span>
            </div>
          </div>
          {!findings.length ? (
            <p className="status good">No configured style patterns found. This is not evidence that the draft is accurate, original or ready to publish.</p>
          ) : (
            <ol className="finding-list">
              {findings.map((finding, index) => (
                <li className="finding" key={finding.ruleId + "-" + finding.start + "-" + index}>
                  <div className="finding-topline">
                    <span className={finding.severity === "review" ? "finding-severity review" : "finding-severity suggestion"}>
                      {finding.severity === "review" ? "EDITOR REVIEW" : "SUGGESTION"}
                    </span>
                    <code>{finding.ruleId}</code>
                    <span className="finding-position">Characters {finding.start + 1}–{finding.end}</span>
                  </div>
                  <p>{finding.message}</p>
                  <blockquote>{finding.excerpt}</blockquote>
                  <p className="finding-recommendation"><strong>Consider:</strong> {finding.recommendation}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      <div className="panel audit-boundaries">
        <h2>What this audit can—and cannot—tell you</h2>
        <div className="audit-boundary-grid">
          <div><h3>It can flag</h3><ul><li>Generic importance language and empty superlatives</li><li>Formulaic hooks and boilerplate transitions</li><li>Vague attribution and repeated sentences</li><li>Repeated paragraph openings</li></ul></div>
          <div><h3>It cannot verify</h3><ul><li>Whether a claim is true or fairly represented</li><li>Whether a source independently confirms another</li><li>Whether a quotation or statistic is authentic</li><li>Whether AI generated or copied the text</li></ul></div>
        </div>
        <p className="audit-caveat">A clean result is not a green light. Verify every material claim against accessible source passages, inspect original reporting and syndication lineage, and keep unresolved facts unresolved.</p>
      </div>
    </section>
  );
}

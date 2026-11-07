import { useCallback, useEffect, useMemo, useState } from "react";

type Source = {
  id: string; name: string; publisher: string | null; country_scope: string | null;
  category: string | null; feed_url: string | null; source_type: string | null;
  retrieval_status: string; last_checked_at: string | null; last_success_at: string | null;
  contentPolicy: { policy: string; policy_reason?: string | null; evidence_url?: string | null; reviewed_at?: string | null; reviewed_by?: string | null };
};
type Edge = {
  id: string; relationship_type: string; review_status: string; evidence_url: string | null;
  review_notes: string | null; reviewed_at: string | null; source: Source | null; relatedSource: Source | null;
};
type Lineage = {
  id: string; origin_type: string; review_status: string; evidence_url: string | null;
  review_notes: string | null; upstream_url: string | null; article: { title: string; url: string; publisher: string | null; content_status: string } | null;
  upstreamArticle: { title: string; url: string; publisher: string | null } | null; upstreamPublisher: Source | null;
};
type Payload = {
  installed: boolean; error?: string; detail?: string; revision: number | null;
  totals: { sources: number; policies: number; relationships: number; lineage: number; unreviewedRelationships: number; unreviewedLineage: number };
  sources: Source[]; relationships: Edge[]; lineage: Lineage[];
};
type Tab = "publishers" | "relationships" | "articles";
type Candidate = { sourceId: string; relatedSourceId: string; relationshipType: string; evidenceUrl: string; reviewNotes: string; key: string };
type ReviewOperation = { key: string; payload: Record<string, string> };
type ReviewSubmit = (payload: Record<string, string>) => void;
const label = (value: string | null | undefined) => value ? value.replace(/_/g, " ") : "Unknown";
const date = (value: string | null | undefined) => value ? new Date(value).toLocaleDateString() : "Not recorded";

export default function ProvenanceDesk() {
  const [data, setData] = useState<Payload | null>(null);
  const [tab, setTab] = useState<Tab>("publishers");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [candidateSource, setCandidateSource] = useState("");
  const [candidateRelated, setCandidateRelated] = useState("");
  const [candidateType, setCandidateType] = useState("same_owner");
  const [candidateEvidence, setCandidateEvidence] = useState("");
  const [candidateNotes, setCandidateNotes] = useState("");
  const [candidateBusy, setCandidateBusy] = useState(false);
  const [candidatePending, setCandidatePending] = useState<Candidate | null>(() => {
    try {
      const raw = sessionStorage.getItem("wf:pending-provenance-candidate");
      return raw ? JSON.parse(raw) as Candidate : null;
    } catch { return null; }
  });
  const [candidateUncertain, setCandidateUncertain] = useState(() => Boolean(candidatePending));
  const [candidateMessage, setCandidateMessage] = useState(() => candidatePending ? "A previous candidate submission may not have received confirmation. Retry the same request safely." : "");
  const [reviewPending, setReviewPending] = useState<ReviewOperation | null>(() => { try { const raw = sessionStorage.getItem("wf:pending-provenance-review"); return raw ? JSON.parse(raw) as ReviewOperation : null; } catch { return null; } });
  const [reviewUncertain, setReviewUncertain] = useState(() => Boolean(reviewPending));
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewMessage, setReviewMessage] = useState(() => reviewPending ? "A previous provenance review may not have received confirmation. Retry the exact same decision." : "");

  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/.netlify/functions/provenance", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || body.error || "Could not load source provenance.");
      setData(body as Payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load source provenance.");
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const clearPendingCandidate = () => {
    setCandidatePending(null); setCandidateUncertain(false);
    try { sessionStorage.removeItem("wf:pending-provenance-candidate"); } catch { /* in-memory state remains */ }
  };

  const submitCandidate = async (operation: Candidate) => {
    setCandidateBusy(true); setCandidateMessage(""); setCandidatePending(operation);
    try { sessionStorage.setItem("wf:pending-provenance-candidate", JSON.stringify(operation)); } catch { /* same-page retry remains available */ }
    try {
      const response = await fetch("/.netlify/functions/provenance", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": operation.key },
        body: JSON.stringify({
          action: "create_relationship_candidate", sourceId: operation.sourceId, relatedSourceId: operation.relatedSourceId,
          relationshipType: operation.relationshipType, evidenceUrl: operation.evidenceUrl,
          reviewNotes: operation.reviewNotes,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (result.outcome === "unknown" || response.status >= 500) {
          setCandidateUncertain(true);
          setCandidateMessage("We couldn't confirm whether this candidate was saved. Your submission is preserved; retry the same request.");
        } else {
          clearPendingCandidate();
          setCandidateMessage(result.detail || result.error || "The candidate was not saved.");
        }
        return;
      }
      clearPendingCandidate();
      setCandidateSource(""); setCandidateRelated(""); setCandidateEvidence(""); setCandidateNotes("");
      setCandidateMessage(result.replayed ? "Candidate was already saved. No duplicate was created." : "Candidate recorded as UNVERIFIED. It does not count as independent coverage.");
      await load();
    } catch {
      setCandidateUncertain(true);
      setCandidateMessage("Connection interrupted. We couldn't confirm whether this candidate was saved. Your submission is preserved; retry the same request.");
    } finally { setCandidateBusy(false); }
  };

  const createCandidate = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (candidatePending || candidateUncertain) return;
    if (!candidateSource || !candidateRelated || candidateSource === candidateRelated) {
      setCandidateMessage("Choose two different publishers."); return;
    }
    const operation: Candidate = {
      sourceId: candidateSource, relatedSourceId: candidateRelated, relationshipType: candidateType,
      evidenceUrl: candidateEvidence.trim(), reviewNotes: candidateNotes.trim(), key: crypto.randomUUID(),
    };
    void submitCandidate(operation);
  };

  const clearPendingReview = () => {
    setReviewPending(null); setReviewUncertain(false);
    try { sessionStorage.removeItem("wf:pending-provenance-review"); } catch { /* in-memory state remains */ }
  };

  const submitReview = async (operation: ReviewOperation) => {
    setReviewBusy(true); setReviewMessage(""); setReviewPending(operation);
    try { sessionStorage.setItem("wf:pending-provenance-review", JSON.stringify(operation)); } catch { /* same-page retry remains available */ }
    try {
      const response = await fetch("/.netlify/functions/provenance", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": operation.key },
        body: JSON.stringify(operation.payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (result.outcome === "unknown" || response.status >= 500) {
          setReviewUncertain(true);
          setReviewMessage("We couldn't confirm whether this review was saved. Your decision is preserved; retry the exact same request.");
        } else {
          clearPendingReview();
          setReviewMessage(result.detail || result.error || "The review was not saved.");
        }
        return;
      }
      clearPendingReview();
      setReviewMessage(result.replayed ? "Review was already saved. No duplicate event was created." : "Review saved and added to the permanent review history.");
      await load();
    } catch {
      setReviewUncertain(true);
      setReviewMessage("Connection interrupted. We couldn't confirm whether this review was saved. Retry the exact same request.");
    } finally { setReviewBusy(false); }
  };

  const beginReview: ReviewSubmit = (payload) => {
    if (reviewPending || reviewUncertain) return;
    void submitReview({ key: crypto.randomUUID(), payload });
  };

  const sources = useMemo(() => (data?.sources ?? []).filter((source) => {
    const haystack = [source.name, source.publisher, source.country_scope, source.category].join(" ").toLowerCase();
    return (!query || haystack.includes(query.toLowerCase())) &&
      (status === "all" || (status === "metadata_only" ? source.contentPolicy.policy === "metadata_only" : source.retrieval_status === status));
  }), [data, query, status]);

  const relationships = useMemo(() => (data?.relationships ?? []).filter((edge) => {
    const haystack = [edge.relationship_type, edge.source?.name, edge.source?.publisher, edge.relatedSource?.name, edge.relatedSource?.publisher].join(" ").toLowerCase();
    return (!query || haystack.includes(query.toLowerCase())) && (status === "all" || edge.review_status === status);
  }), [data, query, status]);
  const lineage = useMemo(() => (data?.lineage ?? []).filter((edge) => {
    const haystack = [edge.origin_type, edge.article?.title, edge.article?.publisher, edge.upstreamArticle?.title, edge.upstreamPublisher?.name].join(" ").toLowerCase();
    return (!query || haystack.includes(query.toLowerCase())) && (status === "all" || edge.review_status === status);
  }), [data, query, status]);

  return (
    <section className="provenance-page">
      <div className="page-intro">
        <p className="eyebrow">SOURCE INTEGRITY · PROVENANCE</p>
        <h1>Source Provenance Desk</h1>
        <p>Inspect who publishes a report, where an article may have originated, and what content access is permitted. These are separate questions—not one reliability score.</p>
      </div>

      {error && <div className="panel state-error" role="alert"><p className="status bad">{error}</p><button onClick={() => void load()} disabled={busy}>Try again</button></div>}
      {busy && !data && <div className="panel state-loading" role="status">Loading the source registry and provenance records…</div>}
      {data && !data.installed && <div className="panel state-warning">
        <h2>Provenance schema not installed</h2>
        <p>{data.detail}</p>
        <p className="muted">This page does not apply migrations or change the database. The migration files remain review-only until separately approved.</p>
      </div>}

      {data?.installed && (
        <>
          <div className="grid provenance-stats">
            <div className="panel stat"><span className="stat-label">Publishers in registry</span><strong className="stat-value">{data.totals.sources}</strong><span className="stat-note">Configured source identities</span></div>
            <div className="panel stat"><span className="stat-label">Publisher relationships</span><strong className="stat-value">{data.totals.relationships}</strong><span className="stat-note">{data.totals.unreviewedRelationships} unreviewed</span></div>
            <div className="panel stat"><span className="stat-label">Article origins</span><strong className="stat-value">{data.totals.lineage}</strong><span className="stat-note">{data.totals.unreviewedLineage} unreviewed</span></div>
          </div>

          <div className="panel provenance-principle">
            <strong>Independence is not inferred.</strong> Different publisher names do not prove separate ownership or original reporting. Unknown lineage stays unknown and does not count as confirmed independent coverage.
            <span className="muted"> {data.revision === null ? "Revision tracking is not available." : `Provenance revision ${data.revision}.`}</span>
          </div>

          <div className="provenance-tabs" role="tablist" aria-label="Provenance records">
            <button role="tab" aria-selected={tab === "publishers"} className={tab === "publishers" ? "tab on" : "tab"} onClick={() => setTab("publishers")}>Publishers ({data.sources.length})</button>
            <button role="tab" aria-selected={tab === "relationships"} className={tab === "relationships" ? "tab on" : "tab"} onClick={() => setTab("relationships")}>Ownership & relationships ({data.relationships.length})</button>
            <button role="tab" aria-selected={tab === "articles"} className={tab === "articles" ? "tab on" : "tab"} onClick={() => setTab("articles")}>Article origins ({data.lineage.length})</button>
          </div>

          <div className="row provenance-filters">
            <label>Search {tab === "publishers" ? "publishers" : tab === "relationships" ? "relationships" : "articles"}
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, publisher or region" />
            </label>
            <label>Review / retrieval status
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="all">All statuses</option>
                <option value="unverified">Unreviewed</option>
                <option value="verified">Verified</option>
                <option value="disputed">Disputed</option>
                <option value="rejected">Rejected</option>
                {tab === "publishers" && <><option value="metadata_only">Metadata only</option><option value="healthy">Retrieval healthy</option><option value="failing">Retrieval failing</option></>}
              </select>
            </label>
            <button onClick={() => void load()} disabled={busy}>{busy ? "Refreshing…" : "Refresh records"}</button>
          </div>

          {tab === "publishers" && (
            <div className="provenance-list">
              {sources.length === 0 && <div className="panel">No publishers match these filters.</div>}
              {sources.map((source) => <article className="panel provenance-card" key={source.id}>
                <div className="provenance-card-heading">
                  <div><h2>{source.publisher || source.name}</h2><p className="meta">{source.name} · {source.country_scope || "Geographic scope unknown"} · {label(source.source_type)}</p></div>
                  <span className={source.contentPolicy.policy === "metadata_only" ? "provenance-tag neutral" : "provenance-tag warning"}>{label(source.contentPolicy.policy)}</span>
                </div>
                <div className="provenance-meta-grid">
                  <div><span>Retrieval</span><strong>{label(source.retrieval_status)}</strong></div>
                  <div><span>Last checked</span><strong>{date(source.last_checked_at)}</strong></div>
                  <div><span>Last successful fetch</span><strong>{date(source.last_success_at)}</strong></div>
                  <div><span>Content access review</span><strong>{source.contentPolicy.reviewed_at ? `Reviewed ${date(source.contentPolicy.reviewed_at)}` : "Default policy · not individually reviewed"}</strong></div>
                </div>
                {source.contentPolicy.policy_reason && <p className="meta">Policy rationale: {source.contentPolicy.policy_reason}</p>}
                {source.contentPolicy.evidence_url && <a href={source.contentPolicy.evidence_url} target="_blank" rel="noreferrer">View policy evidence</a>}
              </article>)}
            </div>
          )}

          {tab === "relationships" && (
            <>
              <div className="panel provenance-candidate">
                <h2>Record a possible publisher relationship</h2>
                <p className="muted">This creates an UNVERIFIED candidate only. It never marks two outlets as the same owner or as independent without a separate evidence-backed review.</p>
                {candidateMessage && <div className={candidateUncertain ? "state-warning" : "state-message"} role={candidateUncertain ? "status" : "alert"}><p>{candidateMessage}</p>{candidateUncertain && candidatePending && <button className="primary" disabled={candidateBusy} onClick={() => void submitCandidate(candidatePending)}>{candidateBusy ? "RETRYING…" : "RETRY SAME SUBMISSION"}</button>}</div>}
                <form onSubmit={createCandidate}>
                  <div className="candidate-fields">
                    <label>Publisher A
                      <select value={candidateSource} onChange={(event) => setCandidateSource(event.target.value)} required disabled={candidateBusy || candidateUncertain}>
                        <option value="">Choose publisher</option>
                        {data.sources.map((source) => <option key={source.id} value={source.id}>{source.publisher || source.name} · {source.name}</option>)}
                      </select>
                    </label>
                    <label>Publisher B
                      <select value={candidateRelated} onChange={(event) => setCandidateRelated(event.target.value)} required disabled={candidateBusy || candidateUncertain}>
                        <option value="">Choose publisher</option>
                        {data.sources.filter((source) => source.id !== candidateSource).map((source) => <option key={source.id} value={source.id}>{source.publisher || source.name} · {source.name}</option>)}
                      </select>
                    </label>
                    <label>Relationship to investigate
                      <select value={candidateType} onChange={(event) => setCandidateType(event.target.value)} disabled={candidateBusy || candidateUncertain}>
                        <option value="same_owner">Same owner (symmetric)</option>
                        <option value="owned_by">Publisher A owned by B</option>
                        <option value="subsidiary_of">Publisher A is subsidiary of B</option>
                        <option value="syndicates_from">A syndicates from B</option>
                        <option value="republishes">A republishes B</option>
                        <option value="licensed_from">A licenses content from B</option>
                        <option value="partner">Partnership / affiliation</option>
                        <option value="aggregates">A aggregates B</option>
                        <option value="official_source_for">A is official source for B</option>
                        <option value="other">Other documented relationship</option>
                      </select>
                    </label>
                    <label>Evidence URL (HTTPS)
                      <input type="url" value={candidateEvidence} onChange={(event) => setCandidateEvidence(event.target.value)} placeholder="https://…" maxLength={2000} disabled={candidateBusy || candidateUncertain} />
                    </label>
                  </div>
                  <label>Why should this relationship be investigated?
                    <textarea value={candidateNotes} onChange={(event) => setCandidateNotes(event.target.value)} rows={3} maxLength={1200} placeholder="Describe the evidence or uncertainty. Do not state a guess as an established fact." disabled={candidateBusy || candidateUncertain} />
                  </label>
                  <div className="candidate-submit"><span className="muted">Provide an evidence link or a written rationale. Maximum 1,200 characters.</span><button className="primary" type="submit" disabled={candidateBusy || candidateUncertain || !candidateSource || !candidateRelated || candidateSource === candidateRelated || (!candidateEvidence.trim() && !candidateNotes.trim())}>{candidateBusy ? "SAVING…" : "ADD UNVERIFIED CANDIDATE"}</button></div>
                </form>
              </div>
              <div className="provenance-list">
              {relationships.length === 0 && <div className="panel"><h2>No publisher relationships recorded</h2><p>Nothing has been inferred or backfilled. Use the form above to add a candidate with evidence or a written rationale. It will remain unverified until reviewed.</p></div>}
              {relationships.map((edge) => <article className="panel provenance-card" key={edge.id}>
                <div className="provenance-card-heading"><h2>{edge.source?.publisher || edge.source?.name || "Unknown publisher"} <span aria-hidden="true">↔</span> {edge.relatedSource?.publisher || edge.relatedSource?.name || "Unknown publisher"}</h2><span className="provenance-tag neutral">{label(edge.review_status)}</span></div>
                <p className="meta">{label(edge.relationship_type)} · Last reviewed {date(edge.reviewed_at)}</p>
                {edge.review_notes && <p>{edge.review_notes}</p>}
                {edge.evidence_url && <a href={edge.evidence_url} target="_blank" rel="noreferrer">Open review evidence</a>}
              </article>)}
              </div>
            </>
          )}

          {tab === "articles" && (
            <div className="provenance-list">
              {lineage.length === 0 && <div className="panel"><h2>No article origins recorded</h2><p>Publisher-level ownership cannot tell us whether a particular article is original reporting, wire copy or a republication. Article lineage must be reviewed separately.</p></div>}
              {lineage.map((edge) => <article className="panel provenance-card" key={edge.id}>
                <div className="provenance-card-heading"><div><h2>{edge.article?.title || "Article title unavailable"}</h2><p className="meta">{edge.article?.publisher || "Publisher unknown"} · {label(edge.article?.content_status)}</p></div><span className="provenance-tag neutral">{label(edge.review_status)}</span></div>
                <p><strong>Origin classification:</strong> {label(edge.origin_type)}</p>
                {edge.upstreamArticle && <p><strong>Upstream article:</strong> <a href={edge.upstreamArticle.url} target="_blank" rel="noreferrer">{edge.upstreamArticle.title}</a> · {edge.upstreamArticle.publisher || "Publisher unknown"}</p>}
                {edge.upstreamPublisher && <p><strong>Upstream publisher:</strong> {edge.upstreamPublisher.publisher || edge.upstreamPublisher.name}</p>}
                {edge.upstream_url && !edge.upstreamArticle && !edge.upstreamPublisher && <p><strong>Upstream URL:</strong> <a href={edge.upstream_url} target="_blank" rel="noreferrer">Open origin reference</a></p>}
                {edge.review_notes && <p className="meta">Review note: {edge.review_notes}</p>}
                {edge.evidence_url && <a href={edge.evidence_url} target="_blank" rel="noreferrer">Open review evidence</a>}
                {edge.article?.url && <p><a href={edge.article.url} target="_blank" rel="noreferrer">Open retrieved article</a></p>}
              </article>)}
            </div>
          )}
          <p className="provenance-footnote">Read-only in this stage. The next stage adds evidence-backed relationship proposals and safe, idempotent editor review actions. No AI-generated guess is treated as a verified fact.</p>
        </>
      )}
    </section>
  );
}

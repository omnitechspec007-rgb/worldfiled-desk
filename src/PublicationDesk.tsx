import { useCallback, useEffect, useState } from "react";

type Member = { id: string; headline: string };
type Eligible = { id: string; title: string; editionKind: "video" | "text"; theme: string; members: Member[] };
type Snapshot = { id: string; captured_at: string; views: number | null; completion_rate: number | null; shares: number | null; saves: number | null };
type Publication = { id: string; edition_id: string; platform: string; content_format: string; status: string; published_at: string | null; post_url: string | null; edition: { title: string } | null; stories: { story_id: string; headline: string; position: number }[]; latestSnapshot: Snapshot | null; snapshotCount: number };
type Cohort = { platform: string; contentFormat: string; publicationCount: number; sampleLabel: "too_few_to_interpret" | "early_signal" | "usable_pattern"; metrics: { views: { median: number | null; measured: number }; averageViewDurationSeconds: { median: number | null; measured: number }; completionRate: { median: number | null; measured: number }; shareRate: { median: number | null; measured: number }; saveRate: { median: number | null; measured: number } }; note: string };
type Desk = { installed: boolean; publications: Publication[]; eligibleEditions: Eligible[]; performanceCohorts: Cohort[]; repeatedStories: { storyId: string; headline: string; distinctEditions: number; platforms: string[]; lastPublishedAt: string | null }[]; note?: string };

const api = "/.netlify/functions/publications";
const platforms = [{ value: "facebook", label: "Facebook" }, { value: "tiktok", label: "TikTok" }, { value: "youtube", label: "YouTube" }, { value: "instagram", label: "Instagram" }, { value: "other", label: "Other" }];
const formats = [{ value: "narrated_video", label: "Narrated video" }, { value: "text_card", label: "Single text card" }, { value: "text_roundup", label: "Text roundup" }, { value: "other", label: "Other" }];
const number = (v: number | null | undefined) => v === null || v === undefined ? "—" : new Intl.NumberFormat().format(v);
const pct = (v: number | null | undefined) => v === null || v === undefined ? "—" : (v * 100).toFixed(1) + "%";
const localDateTime = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export default function PublicationDesk() {
  const [desk, setDesk] = useState<Desk | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [editionId, setEditionId] = useState("");
  const [platform, setPlatform] = useState("youtube");
  const [contentFormat, setContentFormat] = useState("narrated_video");
  const [publishedAt, setPublishedAt] = useState(localDateTime());
  const [postUrl, setPostUrl] = useState("");
  const [accountLabel, setAccountLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [snapshotFor, setSnapshotFor] = useState("");
  const [metrics, setMetrics] = useState({ views: "", reach: "", impressions: "", watchTimeSeconds: "", averageViewDurationSeconds: "", completionRate: "", likes: "", comments: "", shares: "", saves: "", followerDelta: "", sourceNote: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(api);
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail ?? data.error ?? "Could not load publication records.");
      setDesk(data);
      setEditionId((current) => current || data.eligibleEditions?.[0]?.id || "");
      setSnapshotFor((current) => current || data.publications?.[0]?.id || "");
      if (data.note) setMessage(data.note);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not load publication records."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const selectedEdition = desk?.eligibleEditions.find((e) => e.id === editionId);
  const selectedPublication = desk?.publications.find((p) => p.id === snapshotFor);

  const record = async (body: unknown) => {
    setBusy(true); setMessage("");
    try {
      const r = await fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail ?? data.error ?? "The record was not saved.");
      setMessage("Saved successfully.");
      await load();
      return true;
    } catch (e) { setMessage(e instanceof Error ? e.message : "The record was not saved."); return false; }
    finally { setBusy(false); }
  };

  const savePublication = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await record({ action: "record_publication", editionId, platform, contentFormat, publishedAt: new Date(publishedAt).toISOString(), postUrl, accountLabel, notes });
    if (ok) { setPostUrl(""); setNotes(""); }
  };
  const saveSnapshot = async (e: React.FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = { action: "record_snapshot", publicationId: snapshotFor, sourceNote: metrics.sourceNote };
    for (const key of ["views","reach","impressions","watchTimeSeconds","averageViewDurationSeconds","completionRate","likes","comments","shares","saves","followerDelta"] as const) body[key] = metrics[key] === "" ? null : Number(metrics[key]);
    const ok = await record(body);
    if (ok) setMetrics({ views: "", reach: "", impressions: "", watchTimeSeconds: "", averageViewDurationSeconds: "", completionRate: "", likes: "", comments: "", shares: "", saves: "", followerDelta: "", sourceNote: "" });
  };

  const metricInput = (key: keyof typeof metrics, label: string, hint?: string) => (
    <label className="field" key={key}>{label}<input type="number" min={key === "followerDelta" ? undefined : 0} step="any" value={metrics[key]} onChange={(e) => setMetrics((m) => ({ ...m, [key]: e.target.value }))} placeholder="Leave blank if unavailable" />{hint ? <small>{hint}</small> : null}</label>
  );

  if (loading && !desk) return <section><h1>Publishing & performance</h1><p className="status">Loading your publication records…</p></section>;
  if (desk && !desk.installed) return <section><h1>Publishing & performance</h1><div className="panel"><p className="status caution">{desk.note}</p><p>The migration is in the repository but has not been applied to this database. No publication data has been changed.</p></div></section>;

  return (
    <section>
      <h1>Publishing & performance</h1>
      <p>Keep a record of where each approved edition was published, then add performance snapshots as the platforms report them. Results are observations, not predictions.</p>
      {message && <p className="status">{message}</p>}
      <div className="stats-grid">
        <div className="stat-card"><span>Publications logged</span><strong>{desk?.publications.length ?? 0}</strong></div>
        <div className="stat-card"><span>Performance snapshots</span><strong>{desk?.publications.reduce((n, p) => n + p.snapshotCount, 0) ?? 0}</strong></div>
        <div className="stat-card"><span>Ready editions</span><strong>{desk?.eligibleEditions.length ?? 0}</strong></div>
      </div>

      <div className="panel">
        <h2>Performance patterns</h2>
        <p>Latest available snapshot for each publication, grouped only with the same platform and content format. These are descriptive observations, not proof that a format caused better results.</p>
        {!desk?.performanceCohorts?.length ? <p>No comparable performance data yet. Add snapshots after publishing.</p> : <div className="table-scroll"><table><thead><tr><th>Platform / format</th><th>Sample</th><th>Median views</th><th>Avg. view duration</th><th>Completion</th><th>Share rate</th><th>Save rate</th></tr></thead><tbody>
          {desk.performanceCohorts.map((cohort) => <tr key={cohort.platform + cohort.contentFormat}><td>{cohort.platform}<br /><small>{formats.find((f) => f.value === cohort.contentFormat)?.label ?? cohort.contentFormat}</small></td><td>{cohort.publicationCount} posts<br /><small>{cohort.sampleLabel === "usable_pattern" ? "Usable descriptive sample" : cohort.sampleLabel === "early_signal" ? "Early signal only" : "Too few to interpret"}</small></td><td>{number(cohort.metrics.views.median)} <small>({cohort.metrics.views.measured} measured)</small></td><td>{cohort.metrics.averageViewDurationSeconds.median === null ? "—" : cohort.metrics.averageViewDurationSeconds.median.toFixed(1) + "s"}</td><td>{pct(cohort.metrics.completionRate.median)}</td><td>{pct(cohort.metrics.shareRate.median)}</td><td>{pct(cohort.metrics.saveRate.median)}</td></tr>)}
        </tbody></table></div>}
        {desk?.performanceCohorts?.map((cohort) => <p className="meta" key={cohort.platform + cohort.contentFormat}>{cohort.platform} / {cohort.contentFormat}: {cohort.note}</p>)}
      </div>
      <div className="panel">
        <h2>Recently reused stories</h2>
        <p>Stories used in more than one distinct edition in the last 30 days. Cross-posting the same edition to several platforms does not count as a new reuse. This is an editorial warning, not an automatic ban: a meaningful development may justify a follow-up.</p>
        {!desk?.repeatedStories?.length ? <p>No repeated stories detected in the last 30 days.</p> : <ul className="comps">{desk.repeatedStories.map((story) => <li key={story.storyId}><strong>{story.headline}</strong> · {story.distinctEditions} editions · {story.platforms.join(", ")} · last used {story.lastPublishedAt ? new Date(story.lastPublishedAt).toLocaleDateString() : "unknown"}</li>)}</ul>}
      </div>
      <div className="panel">
        <h2>Log a published edition</h2>
        <p>Only editions with current human editorial approval appear here. Every story must also have an official or primary source; each platform post gets its own record.</p>
        {!desk?.eligibleEditions.length ? <p className="status">No publishable editions are available yet. Prepare source-qualified stories, make your editorial decision and approve the edition before logging a post.</p> : (
          <form onSubmit={savePublication} className="form-grid">
            <label className="field wide">Approved edition<select required value={editionId} onChange={(e) => setEditionId(e.target.value)}><option value="">Choose an edition</option>{desk.eligibleEditions.map((e) => <option key={e.id} value={e.id}>{e.title} · {e.members.length} stories</option>)}</select></label>
            {selectedEdition && <div className="field wide"><small>Stories linked to this publication:</small><ul>{selectedEdition.members.map((s) => <li key={s.id}>{s.headline}</li>)}</ul></div>}
            <label className="field">Platform<select value={platform} onChange={(e) => setPlatform(e.target.value)}>{platforms.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
            <label className="field">Content format<select value={contentFormat} onChange={(e) => setContentFormat(e.target.value)}>{formats.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}</select></label>
            <label className="field">Published date and time<input type="datetime-local" value={publishedAt} onChange={(e) => setPublishedAt(e.target.value)} required /></label>
            <label className="field">Post link (optional)<input type="url" placeholder="https://…" value={postUrl} onChange={(e) => setPostUrl(e.target.value)} /></label>
            <label className="field">Account label (optional)<input value={accountLabel} maxLength={120} onChange={(e) => setAccountLabel(e.target.value)} placeholder="e.g. WorldFiled YouTube" /></label>
            <label className="field wide">Notes (optional)<textarea rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Campaign, caption variant, context…" /></label>
            <div className="field wide"><button className="primary" disabled={busy || !editionId}>{busy ? "Saving…" : "Save publication record"}</button></div>
          </form>
        )}
      </div>

      <div className="panel">
        <h2>Record performance</h2>
        <p>Enter the figures shown by the platform. Leave unavailable metrics blank; zero means the platform explicitly reported zero.</p>
        {!desk?.publications.length ? <p>No publication records yet.</p> : (
          <form onSubmit={saveSnapshot} className="form-grid">
            <label className="field wide">Published post<select required value={snapshotFor} onChange={(e) => setSnapshotFor(e.target.value)}>{desk.publications.map((p) => <option key={p.id} value={p.id}>{p.edition?.title ?? "Untitled edition"} · {p.platform} · {p.published_at ? new Date(p.published_at).toLocaleDateString() : "date unknown"}</option>)}</select></label>
            <div className="field wide"><small>Latest recorded snapshot: {selectedPublication?.latestSnapshot ? new Date(selectedPublication.latestSnapshot.captured_at).toLocaleString() : "none yet"}</small></div>
            {metricInput("views","Views")}{metricInput("reach","Reach")}{metricInput("impressions","Impressions")}
            {metricInput("watchTimeSeconds","Total watch time (seconds)")}{metricInput("averageViewDurationSeconds","Average view duration (seconds)")}
            {metricInput("completionRate","Completion rate (%)","Enter 0–100, not a decimal.")}{metricInput("likes","Likes")}{metricInput("comments","Comments")}
            {metricInput("shares","Shares")}{metricInput("saves","Saves")}{metricInput("followerDelta","Follower change","May be negative.")}
            <label className="field wide">Source / context note<textarea rows={2} maxLength={1000} value={metrics.sourceNote} onChange={(e) => setMetrics((m) => ({ ...m, sourceNote: e.target.value }))} placeholder="e.g. YouTube Studio, 24 hours after publication" /></label>
            <div className="field wide"><button className="primary" disabled={busy || !snapshotFor}>{busy ? "Saving…" : "Save performance snapshot"}</button></div>
          </form>
        )}
      </div>

      <div className="panel">
        <h2>Publication history</h2>
        <button type="button" onClick={() => void load()}>Refresh records</button>
        {!desk?.publications.length ? <p>No publications logged yet.</p> : <div className="table-scroll"><table><thead><tr><th>Edition / stories</th><th>Platform</th><th>Published</th><th>Latest views</th><th>Completion</th><th>Shares / saves</th><th>Snapshots</th></tr></thead><tbody>
          {desk.publications.map((p) => <tr key={p.id}><td><strong>{p.edition?.title ?? "Untitled edition"}</strong><ul>{p.stories.map((s) => <li key={s.story_id}>{s.headline}</li>)}</ul>{p.post_url && <a href={p.post_url} target="_blank" rel="noreferrer">Open post ↗</a>}</td><td>{p.platform}<br /><small>{formats.find((f) => f.value === p.content_format)?.label ?? p.content_format}</small></td><td>{p.published_at ? new Date(p.published_at).toLocaleString() : "—"}</td><td>{number(p.latestSnapshot?.views)}</td><td>{pct(p.latestSnapshot?.completion_rate)}</td><td>{number(p.latestSnapshot?.shares)} / {number(p.latestSnapshot?.saves)}</td><td>{p.snapshotCount}</td></tr>)}
        </tbody></table></div>}
      </div>
      <p className="meta">Comparisons will be grouped by platform and content format. Small samples are labelled as early signals or insufficient evidence; they will not automatically change story rankings.</p>
    </section>
  );
}

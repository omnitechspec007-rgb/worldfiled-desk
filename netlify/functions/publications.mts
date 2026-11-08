// Publication log and performance snapshots. All routes require the editor session.
import { hasSameOrigin, isAuthenticated } from "../lib/session.mts";
import { db, DbError } from "../lib/db.mts";
import { membersKey } from "../lib/editions.mts";
import { summarizePerformanceCohorts } from "../lib/performance-intelligence.mts";
import { UUID } from "../lib/edition-data.mts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const platforms = new Set(["facebook", "tiktok", "youtube", "instagram", "other"]);
const formats = new Set(["narrated_video", "text_card", "text_roundup", "other"]);
const finiteOrNull = (v: unknown) => v === null || v === undefined || v === "" ? null : (typeof v === "number" && Number.isFinite(v) ? v : NaN);
const boundedText = (v: unknown, max: number) => v === undefined || v === null ? "" : typeof v === "string" && v.trim().length <= max ? v.trim() : null;

export default async (req: Request) => {
  if (!isAuthenticated(req)) return json({ error: "unauthorized" }, 401);
  if (req.method === "POST" && !hasSameOrigin(req)) return json({ error: "origin_mismatch" }, 403);
  try {
    if (req.method === "GET") return await list();
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const raw = await req.text();
    if (raw.length > 12000) return json({ error: "too_large" }, 413);
    let b: any;
    try { b = JSON.parse(raw); } catch { return json({ error: "bad_request" }, 400); }
    if (!b || typeof b !== "object" || Array.isArray(b)) return json({ error: "bad_request" }, 400);
    if (b.action === "record_publication") return await recordPublication(b);
    if (b.action === "record_snapshot") return await recordSnapshot(b);
    return json({ error: "bad_request" }, 400);
  } catch (e) {
    if (e instanceof DbError) return json({ error: "database", detail: e.message }, e.status);
    return json({ error: "server_error" }, 500);
  }
};

async function list() {
  let publications: any[];
  try {
    publications = await db<any[]>("publication_records?select=id,edition_id,platform,content_format,status,published_at,post_url,platform_post_id,account_label,notes,created_at&order=published_at.desc.nullslast,created_at.desc&limit=200");
  } catch (e) {
    if (e instanceof DbError && (e.upstream === 400 || e.upstream === 404)) return json({ installed: false, publications: [], eligibleEditions: [], note: "Publication tracking migration 015 has not been installed in this database." });
    throw e;
  }
  const ids = [...new Set(publications.map((p) => p.edition_id))];
  const editions = ids.length ? await db<any[]>(`editions?id=in.(${ids.join(",")})&select=id,title,edition_kind,theme`) : [];
  const editionMap = new Map(editions.map((e) => [e.id, e]));
  const pubIds = publications.map((p) => p.id);
  const [attributions, snapshots] = await Promise.all([
    pubIds.length ? db<any[]>(`publication_story_attributions?publication_id=in.(${pubIds.join(",")})&select=publication_id,story_id,position,editorial_role&order=position.asc`) : Promise.resolve([]),
    pubIds.length ? db<any[]>(`performance_snapshots?publication_id=in.(${pubIds.join(",")})&select=*&order=captured_at.desc&limit=1000`) : Promise.resolve([]),
  ]);
  const storyIds = [...new Set(attributions.map((a) => a.story_id))];
  const stories = storyIds.length ? await db<any[]>(`stories?id=in.(${storyIds.join(",")})&select=id,headline`) : [];
  const storyMap = new Map(stories.map((s) => [s.id, s.headline]));
  const latest = new Map<string, any>();
  for (const s of snapshots) if (!latest.has(s.publication_id)) latest.set(s.publication_id, s);
  const members = new Map<string, any[]>();
  for (const a of attributions) members.set(a.publication_id, [...(members.get(a.publication_id) ?? []), { ...a, headline: storyMap.get(a.story_id) ?? "Story unavailable" }]);
  const rows = publications.map((p) => ({ ...p, edition: editionMap.get(p.edition_id) ?? null, stories: members.get(p.id) ?? [], latestSnapshot: latest.get(p.id) ?? null, snapshotCount: snapshots.filter((s) => s.publication_id === p.id).length }));
  const performanceCohorts = summarizePerformanceCohorts(rows.map((p) => ({
    publicationId: p.id, platform: p.platform, contentFormat: p.content_format,
    views: p.latestSnapshot?.views == null ? null : Number(p.latestSnapshot.views),
    averageViewDurationSeconds: p.latestSnapshot?.average_view_duration_seconds == null ? null : Number(p.latestSnapshot.average_view_duration_seconds),
    completionRate: p.latestSnapshot?.completion_rate == null ? null : Number(p.latestSnapshot.completion_rate),
    shares: p.latestSnapshot?.shares == null ? null : Number(p.latestSnapshot.shares),
    saves: p.latestSnapshot?.saves == null ? null : Number(p.latestSnapshot.saves),
  })));
  const eligibleEditions = await loadEligibleEditions();
  return json({ installed: true, publications: rows, eligibleEditions, performanceCohorts });
}

async function loadEligibleEditions() {
  const editions = await db<any[]>("editions?status=eq.draft&select=id,title,edition_kind,theme,updated_at&order=updated_at.desc&limit=60");
  if (!editions.length) return [];
  const editionIds = editions.map((e) => e.id);
  const [members, decisions] = await Promise.all([
    db<any[]>(`edition_developments?edition_id=in.(${editionIds.join(",")})&select=edition_id,story_id,position&order=position.asc`),
    db<any[]>(`edition_decisions?edition_id=in.(${editionIds.join(",")})&select=edition_id,decision,members_hash,created_at&order=created_at.desc,id.desc&limit=1000`),
  ]);
  const membersByEdition = new Map<string, any[]>();
  for (const row of members) membersByEdition.set(row.edition_id, [...(membersByEdition.get(row.edition_id) ?? []), row]);
  const latestDecision = new Map<string, any>();
  for (const row of decisions) if (!latestDecision.has(row.edition_id)) latestDecision.set(row.edition_id, row);
  const candidates = editions.flatMap((edition) => {
    const rows = membersByEdition.get(edition.id) ?? [];
    const ids = rows.map((m) => m.story_id);
    const decision = latestDecision.get(edition.id);
    if (!ids.length || decision?.decision !== "approved" || decision.members_hash !== membersKey(ids)) return [];
    return [{ edition, ids }];
  });
  const allStoryIds = [...new Set(candidates.flatMap((c) => c.ids))];
  if (!allStoryIds.length) return [];
  const stories = await db<any[]>(`stories?id=in.(${allStoryIds.join(",")})&select=id,headline,verification_status,editorial_status`);
  const storyMap = new Map(stories.map((s) => [s.id, s]));
  return candidates.flatMap(({ edition, ids }) => {
    const rows = ids.map((id) => storyMap.get(id));
    if (rows.some((s) => !s || s.verification_status !== "verified" || s.editorial_status !== "approved")) return [];
    return [{ id: edition.id, title: edition.title, editionKind: edition.edition_kind ?? "video", theme: edition.theme, members: rows.map((s) => ({ id: s!.id, headline: s!.headline })) }];
  });
}

async function recordPublication(b: any) {
  if (typeof b.editionId !== "string" || !UUID.test(b.editionId) || !platforms.has(b.platform) || !formats.has(b.contentFormat)) return json({ error: "bad_request", detail: "Choose a valid approved edition, platform and content format." }, 400);
  const postUrl = boundedText(b.postUrl, 2000);
  const platformPostId = boundedText(b.platformPostId, 300);
  const accountLabel = boundedText(b.accountLabel, 120);
  const notes = boundedText(b.notes, 2000);
  if ([postUrl, platformPostId, accountLabel, notes].includes(null)) return json({ error: "field_too_long_or_invalid" }, 400);
  if (postUrl && !/^https:\/\//i.test(postUrl)) return json({ error: "invalid_post_url", detail: "Post links must use HTTPS." }, 400);
  const publishedAt = b.publishedAt ? new Date(b.publishedAt) : new Date();
  if (!Number.isFinite(publishedAt.getTime()) || publishedAt.getTime() > Date.now() + 5 * 60_000) return json({ error: "invalid_published_at" }, 400);

  const eligible = await loadEligibleEditions();
  const edition = eligible.find((e) => e.id === b.editionId);
  if (!edition) return json({ error: "edition_not_cleared", detail: "Only editions with current human approval and fully verified, editorially approved stories can be logged as published." }, 409);
  const created = await db<any[]>("publication_records", {
    method: "POST", prefer: "return=representation",
    body: { edition_id: edition.id, platform: b.platform, content_format: b.contentFormat, status: "published", published_at: publishedAt.toISOString(), post_url: postUrl || null, platform_post_id: platformPostId || null, account_label: accountLabel || null, notes: notes || null, recorded_by: "editor" },
  });
  const publication = Array.isArray(created) ? created[0] : created;
  try {
    await db("publication_story_attributions", {
      method: "POST", prefer: "return=minimal",
      body: edition.members.map((s: any, i: number) => ({ publication_id: publication.id, story_id: s.id, position: i + 1, editorial_role: i === 0 ? "lead" : "supporting" })),
    });
    await db("audit_events", { method: "POST", prefer: "return=minimal", body: { event_type: "publication_recorded", entity_type: "publication", entity_id: publication.id, actor: "editor", detail: { edition_id: edition.id, platform: b.platform, content_format: b.contentFormat, story_count: edition.members.length } } });
  } catch (e) {
    // Compensate if attribution fails; never leave a publication looking complete without its story links.
    try {
      await db(`publication_story_attributions?publication_id=eq.${publication.id}`, { method: "DELETE", prefer: "return=minimal" });
      await db(`publication_records?id=eq.${publication.id}`, { method: "DELETE", prefer: "return=minimal" });
    } catch { /* report failure; operator can inspect orphan */ }
    throw e;
  }
  return json({ saved: true, publicationId: publication.id, storyCount: edition.members.length });
}

async function recordSnapshot(b: any) {
  if (typeof b.publicationId !== "string" || !UUID.test(b.publicationId)) return json({ error: "bad_publication_id" }, 400);
  const publication = await db<any[]>(`publication_records?id=eq.${b.publicationId}&select=id,status&limit=1`);
  if (!publication[0]) return json({ error: "not_found" }, 404);
  const fields = ["views","reach","impressions","watchTimeSeconds","averageViewDurationSeconds","completionRate","likes","comments","shares","saves","followerDelta"] as const;
  const values: Record<string, number | null> = {};
  for (const key of fields) {
    const value = finiteOrNull(b[key]);
    if (typeof value === "number" && !Number.isFinite(value)) return json({ error: "invalid_metric", detail: key + " must be a non-negative number (completion rate is 0–100)." }, 400);
    if (value !== null && key !== "followerDelta" && value < 0) return json({ error: "invalid_metric", detail: key + " cannot be negative." }, 400);
    if (value !== null && ["views","reach","impressions","likes","comments","shares","saves","followerDelta"].includes(key) && !Number.isInteger(value)) return json({ error: "invalid_metric", detail: key + " must be a whole number." }, 400);
    values[key] = value;
  }
  if (values.completionRate !== null && (values.completionRate! < 0 || values.completionRate! > 100)) return json({ error: "invalid_completion_rate", detail: "Enter completion as a percentage from 0 to 100." }, 400);
  const note = boundedText(b.sourceNote, 1000);
  if (note === null) return json({ error: "field_too_long" }, 400);
  const capturedAt = b.capturedAt ? new Date(b.capturedAt) : new Date();
  if (!Number.isFinite(capturedAt.getTime()) || capturedAt.getTime() > Date.now() + 5 * 60_000) return json({ error: "invalid_captured_at" }, 400);
  const inserted = await db<any[]>("performance_snapshots", {
    method: "POST", prefer: "return=representation",
    body: {
      publication_id: b.publicationId, captured_at: capturedAt.toISOString(), capture_method: "manual",
      views: values.views, reach: values.reach, impressions: values.impressions, watch_time_seconds: values.watchTimeSeconds,
      average_view_duration_seconds: values.averageViewDurationSeconds,
      completion_rate: values.completionRate === null ? null : values.completionRate / 100,
      likes: values.likes, comments: values.comments, shares: values.shares, saves: values.saves, follower_delta: values.followerDelta,
      source_note: note || null,
    },
  });
  const row = Array.isArray(inserted) ? inserted[0] : inserted;
  await db("audit_events", { method: "POST", prefer: "return=minimal", body: { event_type: "performance_snapshot_recorded", entity_type: "publication", entity_id: b.publicationId, actor: "editor", detail: { captured_at: capturedAt.toISOString(), capture_method: "manual" } } });
  return json({ saved: true, snapshotId: row?.id ?? null });
}

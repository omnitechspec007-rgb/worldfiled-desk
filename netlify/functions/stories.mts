// Story list and story detail (evidence trail). Read-only.
// The list order is PROVISIONAL (outlet count, then recency). It is not a quality score.
import { isAuthenticated } from "../lib/session.mts";
import { db, DbError } from "../lib/db.mts";
import { MODEL_VERSION } from "../lib/scoring.mts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

const EMBED =
  "story_source_links(role,retrieved_sources(id,title,url,publisher,published_at,retrieved_at,content_status,extract,source_registry(name,country_scope,source_type,reliability_note)))";

function shape(story: any, withExtract: boolean) {
  const sources = (story.story_source_links ?? [])
    .map((l: any) => {
      const s = l.retrieved_sources;
      if (!s) return null;
      const reg = s.source_registry ?? {};
      return {
        id: s.id,
        title: s.title,
        url: s.url,
        outlet: reg.name ?? s.publisher ?? "Unknown",
        scope: reg.country_scope ?? null,
        region: (reg.country_scope ?? "").split(" · ")[0] || "Unknown",
        tier: /tier:primary/.test(reg.reliability_note ?? "") ? "primary" : "reporting",
        publishedAt: s.published_at,
        retrievedAt: s.retrieved_at,
        depth: s.content_status,
        summary: withExtract ? s.extract : undefined,
        role: l.role,
      };
    })
    .filter(Boolean) as any[];
  const outlets = new Set(sources.map((s) => s.outlet));
  const regions = [...new Set(sources.map((s) => s.region))];
  const newest = sources.map((s) => s.publishedAt ?? s.retrievedAt ?? "").sort().pop() ?? "";
  return {
    id: story.id,
    headline: story.headline,
    category: story.category,
    region: story.region,
    editorialStatus: story.editorial_status,
    createdAt: story.created_at,
    outlets: outlets.size,
    sourceCount: sources.length,
    regions,
    hasPrimary: sources.some((s) => s.tier === "primary"),
    newest,
    sources,
  };
}

const FIELDS = `id,headline,category,region,created_at,editorial_status,${EMBED}`;
const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

async function scoresFor(ids: string[]) {
  const out = new Map<string, any[]>();
  for (const part of chunk(ids, 40)) {
    const rows = await db<any[]>(`story_scores?story_id=in.(${part.join(",")})&model_version=eq.${MODEL_VERSION}&select=story_id,dimension,score,max_score,reason,detail`);
    for (const r of rows) out.set(r.story_id, [...(out.get(r.story_id) ?? []), { dimension: r.dimension, score: Number(r.score), max: Number(r.max_score), reason: r.reason, detail: r.detail }]);
  }
  return out;
}

async function shortlistView() {
  let latest: any[];
  try {
    latest = await db<any[]>("shortlist?select=run_id,created_at&order=created_at.desc&limit=1");
  } catch (e) {
    if (e instanceof DbError && /404/.test(e.message)) return { view: "shortlist", notInstalled: true };
    throw e;
  }
  if (!latest[0]) return { view: "shortlist", picks: [], heldBack: [] };
  const rows = await db<any[]>(`shortlist?run_id=eq.${latest[0].run_id}&select=story_id,selected,rank,priority,reason,detail`);
  const ids = rows.map((r) => r.story_id);
  const stories = new Map<string, any>();
  const scores = new Map<string, any[]>();
  for (const part of chunk(ids, 30)) {
    for (const st of await db<any[]>(`stories?id=in.(${part.join(",")})&select=${FIELDS}`)) stories.set(st.id, st);
  }
  for (const [k, v] of await scoresFor(ids)) scores.set(k, v);
  const build = (r: any) => ({
    ...(stories.get(r.story_id) ? shape(stories.get(r.story_id), true) : { id: r.story_id }),
    rank: r.rank,
    priority: Number(r.priority),
    reason: r.reason,
    flags: r.detail?.flags ?? [],
    patterns: r.detail?.patterns ?? [],
    scores: scores.get(r.story_id) ?? [],
  });
  const picks = rows.filter((r) => r.selected).sort((a, b) => a.rank - b.rank).map(build);
  const heldBack = rows.filter((r) => !r.selected).sort((a, b) => b.priority - a.priority).map(build);
  return { view: "shortlist", runId: latest[0].run_id, picks, heldBack };
}

export default async (req: Request) => {
  if (!isAuthenticated(req)) return json({ error: "unauthorized" }, 401);
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    const view = url.searchParams.get("view");
    if (id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "bad_request" }, 400);
      const rows = await db<any[]>(`stories?id=eq.${id}&select=${FIELDS}`);
      if (!rows[0]) return json({ error: "not_found" }, 404);
      let scores: any[] = [];
      try {
        scores = (await scoresFor([id])).get(id) ?? [];
      } catch {
        /* scoring tables not installed yet */
      }
      const decisions = await db<any[]>(`editorial_decisions?story_id=eq.${id}&select=decision,notes,decided_by,created_at&order=created_at.desc&limit=10`);
      return json({ story: { ...shape(rows[0], true), scores, decisions } });
    }
    if (view === "shortlist") return json(await shortlistView());
    if (view === "approved") {
      const rows = await db<any[]>(`stories?editorial_status=eq.approved&select=${FIELDS}&order=created_at.desc&limit=30`);
      return json({ stories: rows.map((r) => shape(r, false)).map(({ sources, ...rest }) => rest) });
    }
    const rows = await db<any[]>(`stories?select=${FIELDS}&order=created_at.desc&limit=250`);
    const list = rows.map((r) => shape(r, false)).map(({ sources, ...rest }) => rest);
    list.sort((a, b) => b.outlets - a.outlets || b.newest.localeCompare(a.newest));
    return json({ stories: list.slice(0, 80), total: rows.length, ordering: "provisional" });
  } catch (e) {
    if (e instanceof DbError) return json({ error: "database", detail: e.message }, e.status);
    return json({ error: "server_error" }, 500);
  }
};

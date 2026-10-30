// Story list and story detail (evidence trail). Read-only.
// The list order is PROVISIONAL (outlet count, then recency). It is not a quality score.
import { isAuthenticated } from "../lib/session.mts";
import { db, DbError } from "../lib/db.mts";

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
    createdAt: story.created_at,
    outlets: outlets.size,
    sourceCount: sources.length,
    regions,
    hasPrimary: sources.some((s) => s.tier === "primary"),
    newest,
    sources,
  };
}

export default async (req: Request) => {
  if (!isAuthenticated(req)) return json({ error: "unauthorized" }, 401);
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "bad_request" }, 400);
      const rows = await db<any[]>(`stories?id=eq.${id}&select=id,headline,category,region,created_at,${EMBED}`);
      if (!rows[0]) return json({ error: "not_found" }, 404);
      return json({ story: shape(rows[0], true) });
    }
    const rows = await db<any[]>(`stories?select=id,headline,category,region,created_at,${EMBED}&order=created_at.desc&limit=250`);
    const list = rows.map((r) => shape(r, false)).map(({ sources, ...rest }) => rest);
    list.sort((a, b) => b.outlets - a.outlets || b.newest.localeCompare(a.newest));
    return json({ stories: list.slice(0, 80), total: rows.length, ordering: "provisional" });
  } catch (e) {
    if (e instanceof DbError) return json({ error: "database", detail: e.message }, e.status);
    return json({ error: "server_error" }, 500);
  }
};

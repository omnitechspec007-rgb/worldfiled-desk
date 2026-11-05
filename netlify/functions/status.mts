// Dashboard numbers: latest run, its stages, and honest counts.
import { isAuthenticated } from "../lib/session.mts";
import { db, DbError } from "../lib/db.mts";
import { summarize } from "./run-step.mts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

const REGIONS = ["Africa", "Asia", "Europe", "Latin America", "Middle East", "North America", "Oceania"];

export default async (req: Request) => {
  if (!isAuthenticated(req)) return json({ error: "unauthorized" }, 401);
  try {
    const runs = await db<any[]>("research_runs?select=id,status,current_stage,error_summary,created_at,completed_at,config&order=created_at.desc&limit=6");
    const latest = runs[0] ?? null;
    const stages = latest ? await db<any[]>(`research_run_stages?run_id=eq.${latest.id}&select=stage,status,attempt,detail,error`) : [];
    const historyStages = runs.length ? await db<any[]>(`research_run_stages?run_id=in.(${runs.map((r) => r.id).join(",")})&select=run_id,stage,status,detail`) : [];
    const history = runs.map((r) => {
      const discover = historyStages.find((s) => s.run_id === r.id && s.stage === "discover")?.detail ?? {};
      const cluster = historyStages.find((s) => s.run_id === r.id && s.stage === "cluster")?.detail ?? {};
      const rank = historyStages.find((s) => s.run_id === r.id && s.stage === "rank")?.detail ?? {};
      return { id: r.id, status: r.status, created_at: r.created_at, completed_at: r.completed_at, config: r.config ?? {}, newItems: discover.newItems ?? 0, refreshedItems: discover.refreshedItems ?? 0, stories: cluster.stories ?? 0, newStories: cluster.newStories ?? 0, shortlisted: rank.shortlisted ?? 0 };
    });
    const sources = await db<any[]>("source_registry?select=country_scope,retrieval_status");
    const stories = await db<any[]>("stories?select=id,editorial_status&limit=5000");
    const links = await db<any[]>("story_source_links?select=story_id&limit=5000");
    const perStory = new Map<string, number>();
    for (const l of links) perStory.set(l.story_id, (perStory.get(l.story_id) ?? 0) + 1);

    const regions = REGIONS.map((r) => {
      const inRegion = sources.filter((s) => (s.country_scope ?? "").startsWith(r));
      return { region: r, healthy: inRegion.filter((s) => s.retrieval_status === "healthy").length, total: inRegion.length };
    });
    return json({
      latest,
      stages: summarize(stages),
      history,
      counts: {
        stories: stories.length,
        awaitingReview: stories.filter((x) => x.editorial_status === "in_review").length,
        approved: stories.filter((x) => x.editorial_status === "approved").length,
        multiOutlet: [...perStory.values()].filter((n) => n > 1).length,
        sourcesHealthy: sources.filter((s) => s.retrieval_status === "healthy").length,
        sourcesNeedAttention: sources.filter((s) => ["failing", "degraded"].includes(s.retrieval_status)).length,
        sourcesUntested: sources.filter((s) => s.retrieval_status === "untested").length,
        sourcesTotal: sources.length,
      },
      regions,
    });
  } catch (e) {
    if (e instanceof DbError) return json({ error: "database", detail: e.message }, e.status);
    return json({ error: "server_error" }, 500);
  }
};

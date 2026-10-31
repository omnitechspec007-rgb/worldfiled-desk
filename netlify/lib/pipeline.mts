// Research pipeline stages. Each stage is idempotent and saves its own progress, so a timeout
// or retry resumes safely without duplicating sources, stories or links.
//
// Stage plan (this version): prepare -> discover -> cluster -> rank
// Planned next: evidence (full text) -> claims -> verify
// An AI provider, when added, plugs in behind the interfaces in ai-provider.mts and is never
// required for any stage here.
import { db } from "./db.mts";
import { SEED_SOURCES } from "./seed-sources.mts";
import { fetchFeed, urlHash } from "./feeds.mts";
import { clusterItems } from "./cluster.mts";
import { MODEL_VERSION, buildShortlist, scoreStory, type StoryInput } from "./scoring.mts";

export const STAGES = ["prepare", "discover", "cluster", "rank"] as const;
export type StageName = (typeof STAGES)[number];

export const BATCH_SIZE = 6;
const WINDOW_DAYS = 3;
const OFFICIAL_WINDOW_DAYS = 14;
const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

type StageResult = { done: boolean; detail: Record<string, any> };

type SourceRow = { id: string; name: string; country_scope: string | null; category: string | null; feed_url: string | null; reliability_note?: string | null };

export async function stagePrepare(): Promise<StageResult> {
  // Built-in list is the source of truth. Existing rows keep their recorded health, unless the
  // feed address changed (then the row is reset to "untested") or the source was retired.
  const existing = await db<{ name: string; feed_url: string | null; reliability_note: string | null; retrieval_status: string }[]>(
    "source_registry?select=name,feed_url,reliability_note,retrieval_status"
  );
  const byName = new Map(existing.map((e) => [e.name, e]));
  const seedNames = new Set(SEED_SOURCES.map((s) => s.name));

  const fresh = SEED_SOURCES.filter((s) => !byName.has(s.name));
  if (fresh.length) {
    await db("source_registry?on_conflict=name", {
      method: "POST",
      prefer: "resolution=ignore-duplicates,return=minimal",
      body: fresh.map((s) => ({
        name: s.name,
        publisher: s.publisher,
        country_scope: s.scope,
        category: s.category,
        source_url: s.site,
        feed_url: s.feed,
        source_type: s.tier === "primary" ? "official" : "feed",
        reliability_note: `tier:${s.tier}; built-in candidate, health tested automatically`,
        enabled: false,
        retrieval_status: "untested",
      })),
    });
  }
  let changed = 0;
  for (const s of SEED_SOURCES) {
    const e = byName.get(s.name);
    if (e && e.feed_url !== s.feed) {
      await db(`source_registry?name=eq.${encodeURIComponent(s.name)}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: { feed_url: s.feed, retrieval_status: "untested", enabled: false, last_error: null },
      });
      changed++;
    }
  }
  let retired = 0;
  for (const e of existing) {
    if (!seedNames.has(e.name) && /built-in candidate/.test(e.reliability_note ?? "") && e.retrieval_status !== "disabled") {
      await db(`source_registry?name=eq.${encodeURIComponent(e.name)}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: { retrieval_status: "disabled", enabled: false, last_error: "retired from the built-in list" },
      });
      retired++;
    }
  }
  return { done: true, detail: { builtIn: SEED_SOURCES.length, added: fresh.length, updated: changed, retired } };
}

export async function stageDiscover(prev: Record<string, any>): Promise<StageResult> {
  const sources = await db<SourceRow[]>(
    "source_registry?select=id,name,country_scope,category,feed_url,reliability_note&feed_url=not.is.null&retrieval_status=neq.disabled&order=name.asc"
  );
  const results: Record<string, any> = prev.results ?? {};
  const pending = sources.filter((s) => !(s.id in results));
  const batch = pending.slice(0, BATCH_SIZE);

  await Promise.all(
    batch.map(async (s) => {
      const now = new Date().toISOString();
      // Official/primary sources publish less often, so they get a longer freshness window.
      const windowDays = /tier:primary/.test(s.reliability_note ?? "") ? OFFICIAL_WINDOW_DAYS : WINDOW_DAYS;
      const r = await fetchFeed(s.feed_url!, windowDays);
      if (r.status === "healthy" && r.items.length > 0) {
        // Save items first; only report success if the write succeeded.
        await db("retrieved_sources?on_conflict=url_hash", {
          method: "POST",
          prefer: "resolution=ignore-duplicates,return=minimal",
          body: r.items.map((it) => ({
            registry_id: s.id,
            url: it.url,
            url_hash: urlHash(it.url),
            title: it.title,
            publisher: s.name,
            published_at: it.publishedAt,
            retrieved_at: now,
            http_status: r.http,
            content_status: "metadata_only", // headline and short summary only; article text NOT retrieved
            extract: it.summary,
          })),
        });
        await db(`source_registry?id=eq.${s.id}`, {
          method: "PATCH",
          prefer: "return=minimal",
          body: { retrieval_status: "healthy", enabled: true, last_checked_at: now, last_success_at: now, last_error: null },
        });
        results[s.id] = { name: s.name, status: "healthy", items: r.items.length, skippedOld: r.skippedOld };
      } else {
        const status = r.status === "healthy" ? "degraded" : r.status;
        const error = r.status === "healthy" ? `no items within the freshness window (${r.skippedOld} older items skipped)` : r.error;
        await db(`source_registry?id=eq.${s.id}`, {
          method: "PATCH",
          prefer: "return=minimal",
          body: { retrieval_status: status, enabled: false, last_checked_at: now, last_error: error },
        });
        results[s.id] = { name: s.name, status, items: 0, error };
      }
    })
  );

  const total = sources.length;
  const finished = Object.keys(results).length;
  const done = finished >= total;
  const list = Object.values(results);
  const healthy = list.filter((x: any) => x.status === "healthy").length;
  if (done && healthy === 0) {
    throw new Error("No source could be reached. Nothing was discovered. This does not mean nothing happened.");
  }
  return {
    done,
    detail: {
      results,
      total,
      finished,
      healthy,
      problems: finished - healthy,
      items: list.reduce((n: number, x: any) => n + (x.items ?? 0), 0),
    },
  };
}

export async function stageCluster(runId: string): Promise<StageResult> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const rows = await db<{ id: string; title: string; registry_id: string | null }[]>(
    `retrieved_sources?select=id,title,registry_id&retrieved_at=gte.${since}&order=url_hash.asc&limit=1500`
  );
  const sources = await db<SourceRow[]>("source_registry?select=id,name,country_scope,category,feed_url");
  const reg = new Map(sources.map((s) => [s.id, s]));
  const clusters = clusterItems(rows.map((r) => ({ id: r.id, title: r.title ?? "" })));
  const byId = new Map(rows.map((r) => [r.id, r]));

  // Reuse an existing story if any member is already linked to one (stable across runs).
  const existing = new Map<string, string>();
  for (const ids of chunk(rows.map((r) => r.id), 40)) {
    const links = await db<{ story_id: string; source_id: string }[]>(
      `story_source_links?select=story_id,source_id&source_id=in.(${ids.join(",")})`
    );
    for (const l of links) existing.set(l.source_id, l.story_id);
  }

  const toCreate: any[] = [];
  const plan = clusters.map((c) => {
    const reuse = c.memberIds.map((m) => existing.get(m)).find(Boolean) ?? null;
    if (!reuse) {
      const seed = byId.get(c.seedId)!;
      const r = reg.get(seed.registry_id ?? "");
      toCreate.push({
        cluster_key: c.key,
        first_run_id: runId,
        headline: (seed.title ?? "").slice(0, 300) || "Untitled",
        category: r?.category ?? null,
        region: (r?.country_scope ?? "").split(" · ")[0] || null,
      });
    }
    return { ...c, reuse };
  });

  for (const part of chunk(toCreate, 100)) {
    await db("stories?on_conflict=cluster_key", {
      method: "POST",
      prefer: "resolution=ignore-duplicates,return=minimal",
      body: part,
    });
  }
  const keyToId = new Map<string, string>();
  for (const part of chunk(plan.filter((p) => !p.reuse).map((p) => p.key), 40)) {
    const st = await db<{ id: string; cluster_key: string }[]>(
      `stories?select=id,cluster_key&cluster_key=in.(${part.join(",")})`
    );
    for (const s of st) keyToId.set(s.cluster_key, s.id);
  }

  const links: any[] = [];
  for (const p of plan) {
    const storyId = p.reuse ?? keyToId.get(p.key);
    if (!storyId) throw new Error("A story record could not be confirmed as saved.");
    for (const m of p.memberIds) {
      links.push({ story_id: storyId, source_id: m, role: "coverage" });
    }
  }
  for (const part of chunk(links, 200)) {
    await db("story_source_links?on_conflict=story_id,source_id", {
      method: "POST",
      prefer: "resolution=ignore-duplicates,return=minimal",
      body: part,
    });
  }
  const multi = plan.filter((p) => p.memberIds.length > 1).length;
  return {
    done: true,
    detail: { items: rows.length, stories: plan.length, newStories: toCreate.length, multiSource: multi },
  };
}

const SCORE_WINDOW_HOURS = 72;
const OFFICIAL_SCORE_WINDOW_HOURS = 14 * 24;

export async function stageRank(runId: string): Promise<StageResult> {
  try {
    await db("shortlist?select=id&limit=1");
    await db("story_scores?select=id&limit=1");
  } catch {
    throw new Error("The scoring tables are not installed. Run supabase/migrations/002_scoring.sql in the Supabase SQL Editor, then click Resume.");
  }
  const rows = await db<any[]>(
    "stories?select=id,headline,category,created_at,story_source_links(retrieved_sources(title,published_at,retrieved_at,extract,source_registry(name,country_scope,reliability_note)))&order=created_at.desc&limit=300"
  );
  const now = Date.now();
  const inputs: StoryInput[] = rows.map((r) => ({
    id: r.id,
    headline: r.headline,
    category: r.category,
    createdAt: r.created_at,
    sources: (r.story_source_links ?? [])
      .map((l: any) => l.retrieved_sources)
      .filter(Boolean)
      .map((s: any) => ({
        outlet: s.source_registry?.name ?? "Unknown",
        region: (s.source_registry?.country_scope ?? "").split(" · ")[0] || "Unknown",
        tier: /tier:primary/.test(s.source_registry?.reliability_note ?? "") ? "primary" : "reporting",
        publishedAt: s.published_at,
        retrievedAt: s.retrieved_at,
        title: s.title ?? "",
        summary: s.extract,
      })),
  }));
  const scored = inputs
    .filter((x) => x.sources.length > 0)
    .map((x) => scoreStory(x, now))
    .filter((s) => {
      const ageH = s.newest ? (now - s.newest) / 3_600_000 : Infinity;
      return ageH <= SCORE_WINDOW_HOURS || (s.hasPrimary && ageH <= OFFICIAL_SCORE_WINDOW_HOURS);
    });

  const scoreRows = scored.flatMap((s) =>
    s.dimensions.map((d) => ({
      story_id: s.story.id,
      model_version: MODEL_VERSION,
      dimension: d.dimension,
      score: d.score,
      max_score: d.max,
      reason: d.reason,
      detail: d.detail ?? {},
    }))
  );
  for (const part of chunk(scoreRows, 400)) {
    await db("story_scores?on_conflict=story_id,model_version,dimension", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: part,
    });
  }

  const { picks, heldBack } = buildShortlist(scored, 12);
  await db(`shortlist?run_id=eq.${runId}`, { method: "DELETE", prefer: "return=minimal" }); // retries rebuild cleanly
  const listRows = [...picks, ...heldBack].map((p) => ({
    run_id: runId,
    story_id: p.scored.story.id,
    selected: p.selected,
    rank: p.rank,
    priority: p.priority,
    reason: p.reason,
    detail: { flags: p.scored.flags, patterns: p.scored.patterns, regions: p.scored.regions, dominantRegion: p.scored.dominantRegion, outlets: p.scored.outlets },
  }));
  for (const part of chunk(listRows, 100)) {
    await db("shortlist?on_conflict=run_id,story_id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: part });
  }
  for (const ids of chunk(picks.map((p) => p.scored.story.id), 40)) {
    await db(`stories?id=in.(${ids.join(",")})&editorial_status=eq.pending`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: { editorial_status: "in_review" },
    });
  }
  return { done: true, detail: { candidates: scored.length, shortlisted: picks.length, heldBack: heldBack.length, items: scored.length } };
}

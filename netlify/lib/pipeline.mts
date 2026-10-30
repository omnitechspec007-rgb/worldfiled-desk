// Research pipeline stages. Each stage is idempotent and saves its own progress, so a timeout
// or retry resumes safely without duplicating sources, stories or links.
//
// Stage plan (this version): prepare -> discover -> cluster
// Planned next: evidence -> claims -> verify -> score -> shortlist
// An AI provider, when added, plugs in behind the interfaces in ai-provider.mts and is never
// required for any stage here.
import { db } from "./db.mts";
import { SEED_SOURCES } from "./seed-sources.mts";
import { fetchFeed, urlHash } from "./feeds.mts";
import { clusterItems } from "./cluster.mts";

export const STAGES = ["prepare", "discover", "cluster"] as const;
export type StageName = (typeof STAGES)[number];

export const BATCH_SIZE = 6;
const WINDOW_DAYS = 3;
const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

type StageResult = { done: boolean; detail: Record<string, any> };

type SourceRow = { id: string; name: string; country_scope: string | null; category: string | null; feed_url: string | null };

export async function stagePrepare(): Promise<StageResult> {
  // Add built-in sources. Existing rows (and their recorded health) are left untouched.
  await db("source_registry?on_conflict=name", {
    method: "POST",
    prefer: "resolution=ignore-duplicates,return=minimal",
    body: SEED_SOURCES.map((s) => ({
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
  return { done: true, detail: { builtIn: SEED_SOURCES.length } };
}

export async function stageDiscover(prev: Record<string, any>): Promise<StageResult> {
  const sources = await db<SourceRow[]>(
    "source_registry?select=id,name,country_scope,category,feed_url&feed_url=not.is.null&order=name.asc"
  );
  const results: Record<string, any> = prev.results ?? {};
  const pending = sources.filter((s) => !(s.id in results));
  const batch = pending.slice(0, BATCH_SIZE);

  await Promise.all(
    batch.map(async (s) => {
      const now = new Date().toISOString();
      const r = await fetchFeed(s.feed_url!, WINDOW_DAYS);
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
        const error = r.status === "healthy" ? `no items within the last ${WINDOW_DAYS} days (${r.skippedOld} older items skipped)` : r.error;
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

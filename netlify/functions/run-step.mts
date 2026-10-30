// Advances a run by ONE small batch, then returns. The browser calls this repeatedly.
// Progress is saved after every call, so a timeout, closed tab or failed source never loses
// completed work: the next call resumes from the saved state.
import { isAuthenticated } from "../lib/session.mts";
import { db, DbError } from "../lib/db.mts";
import { STAGES, stageCluster, stageDiscover, stagePrepare, type StageName } from "../lib/pipeline.mts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const MAX_ATTEMPTS = 3;
const UUID = /^[0-9a-f-]{36}$/i;

export const summarize = (rows: any[]) =>
  STAGES.map((name) => {
    const r = rows.find((x) => x.stage === name);
    const d = r?.detail ?? {};
    return {
      stage: name,
      status: r?.status ?? "pending",
      error: r?.error ?? null,
      finished: d.finished ?? null,
      total: d.total ?? null,
      healthy: d.healthy ?? null,
      problems: d.problems ?? null,
      items: d.items ?? null,
      stories: d.stories ?? null,
      multiSource: d.multiSource ?? null,
    };
  });

export default async (req: Request) => {
  if (!isAuthenticated(req)) return json({ error: "unauthorized" }, 401);
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let runId = "";
  try {
    const body = JSON.parse(await req.text());
    runId = String(body.runId ?? "");
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (!UUID.test(runId)) return json({ error: "bad_request" }, 400);

  try {
    const runs = await db<any[]>(`research_runs?id=eq.${runId}&select=id,status,error_summary`);
    const run = runs[0];
    if (!run) return json({ error: "not_found" }, 404);
    let stages = await db<any[]>(`research_run_stages?run_id=eq.${runId}&select=stage,status,attempt,detail,error`);

    if (run.status === "completed" || run.status === "failed") {
      return json({ run, stages: summarize(stages), done: true });
    }

    const next = STAGES.find((s) => stages.find((x) => x.stage === s)?.status !== "completed");
    if (!next) {
      await db(`research_runs?id=eq.${runId}`, { method: "PATCH", prefer: "return=minimal", body: { status: "completed", completed_at: new Date().toISOString() } });
      return json({ run: { ...run, status: "completed" }, stages: summarize(stages), done: true });
    }

    const row = stages.find((x) => x.stage === next);
    const attempt = (row?.attempt ?? 0) + 1;
    const upsertStage = (patch: Record<string, unknown>) =>
      db("research_run_stages?on_conflict=run_id,stage", {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: { run_id: runId, stage: next, ...patch },
      });

    await upsertStage({ status: "running", attempt, started_at: row?.detail?.startedAt ?? new Date().toISOString() });
    await db(`research_runs?id=eq.${runId}`, { method: "PATCH", prefer: "return=minimal", body: { status: "running", current_stage: next } });

    try {
      const prev = row?.detail ?? {};
      const result =
        next === "prepare" ? await stagePrepare() : next === "discover" ? await stageDiscover(prev) : await stageCluster(runId);
      await upsertStage({
        status: result.done ? "completed" : "running",
        detail: result.detail,
        error: null,
        finished_at: result.done ? new Date().toISOString() : null,
      });
    } catch (e: any) {
      const message = String(e?.message ?? "stage failed").slice(0, 300);
      await upsertStage({ status: "failed", error: message });
      const exhausted = attempt >= MAX_ATTEMPTS;
      await db(`research_runs?id=eq.${runId}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: { status: exhausted ? "failed" : "incomplete", error_summary: `${next}: ${message}` },
      });
      stages = await db<any[]>(`research_run_stages?run_id=eq.${runId}&select=stage,status,attempt,detail,error`);
      return json({
        run: { id: runId, status: exhausted ? "failed" : "incomplete", error_summary: `${next}: ${message}` },
        stages: summarize(stages),
        done: exhausted,
        error: message,
      });
    }

    stages = await db<any[]>(`research_run_stages?run_id=eq.${runId}&select=stage,status,attempt,detail,error`);
    const allDone = STAGES.every((s) => stages.find((x) => x.stage === s)?.status === "completed");
    if (allDone) {
      const disc = stages.find((x) => x.stage === "discover")?.detail ?? {};
      const note = disc.problems ? `${disc.problems} of ${disc.total} sources had problems (see System Health).` : null;
      await db(`research_runs?id=eq.${runId}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: { status: "completed", current_stage: null, completed_at: new Date().toISOString(), error_summary: note },
      });
      await db("audit_events", {
        method: "POST",
        prefer: "return=minimal",
        body: { event_type: "run_completed", entity_type: "research_run", entity_id: runId, actor: "system" },
      });
    }
    return json({ run: { id: runId, status: allDone ? "completed" : "running" }, stages: summarize(stages), done: allDone });
  } catch (e) {
    if (e instanceof DbError) return json({ error: "database", detail: e.message }, e.status);
    return json({ error: "server_error" }, 500);
  }
};

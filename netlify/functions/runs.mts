// Research runs: list and create. Creating is idempotent: the same idempotency key
// returns the original run instead of making a duplicate (double clicks, retries).
import { isAuthenticated } from "../lib/session.mts";
import { db, DbError } from "../lib/db.mts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
const REGIONS = ["Africa", "Asia", "Europe", "Latin America", "Middle East", "North America", "Oceania"];
const CATEGORIES = [
  "Laws and regulations",
  "Government and institutional decisions",
  "Scientific discoveries",
  "Technology",
  "Business and economic developments",
  "Environment and climate",
  "Public policy",
  "International affairs",
  "Significant consequences",
];

export function cleanConfig(input: any) {
  const pick = (v: unknown, allowed: string[]) =>
    Array.isArray(v) ? allowed.filter((a) => v.includes(a)) : allowed;
  const days = Number(input?.windowDays);
  const max = Number(input?.maxSources);
  return {
    regions: pick(input?.regions, REGIONS),
    categories: pick(input?.categories, CATEGORIES),
    windowDays: Number.isInteger(days) && days >= 1 && days <= 14 ? days : 2,
    maxSources: Number.isInteger(max) && max >= 5 && max <= 100 ? max : 50,
  };
}

export default async (req: Request) => {
  if (!isAuthenticated(req)) return json({ error: "unauthorized" }, 401);
  try {
    if (req.method === "GET") {
      const runs = await db(
        "research_runs?select=id,status,current_stage,config,error_summary,created_at,completed_at&order=created_at.desc&limit=20"
      );
      return json({ runs });
    }

    if (req.method === "POST") {
      const text = await req.text();
      if (text.length > 5000) return json({ error: "too_large" }, 413);
      let body: any;
      try {
        body = JSON.parse(text);
      } catch {
        return json({ error: "bad_request" }, 400);
      }
      if (typeof body.idempotencyKey !== "string" || !KEY_RE.test(body.idempotencyKey)) {
        return json({ error: "bad_idempotency_key" }, 400);
      }
      const config = cleanConfig(body.config);
      // ignore-duplicates: a repeat key inserts nothing; we then read back the original row.
      await db("research_runs?on_conflict=idempotency_key", {
        method: "POST",
        prefer: "resolution=ignore-duplicates,return=minimal",
        body: { idempotency_key: body.idempotencyKey, config },
      });
      const rows = await db<any[]>(
        `research_runs?idempotency_key=eq.${encodeURIComponent(body.idempotencyKey)}&select=id,status,current_stage,config,created_at`
      );
      if (!rows?.[0]) return json({ error: "not_saved" }, 502);
      await db("audit_events", {
        method: "POST",
        prefer: "return=minimal",
        body: { event_type: "run_requested", entity_type: "research_run", entity_id: rows[0].id, actor: "editor" },
      });
      return json({ run: rows[0] }, 201);
    }
    return json({ error: "method_not_allowed" }, 405);
  } catch (e) {
    if (e instanceof DbError) return json({ error: "database", detail: e.message }, e.status);
    return json({ error: "server_error" }, 500);
  }
};

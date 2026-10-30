// Start (or resume) a research run. One click; no inputs.
// Safety: if an unfinished run already exists, it is returned instead of creating a second one,
// and the same idempotency key always returns the same run.
import { isAuthenticated } from "../lib/session.mts";
import { db, DbError } from "../lib/db.mts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
const COLS = "id,status,current_stage,error_summary,created_at,completed_at";

export default async (req: Request) => {
  if (!isAuthenticated(req)) return json({ error: "unauthorized" }, 401);
  try {
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const text = await req.text();
    if (text.length > 1000) return json({ error: "too_large" }, 413);
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: "bad_request" }, 400);
    }
    if (typeof body.idempotencyKey !== "string" || !KEY_RE.test(body.idempotencyKey)) {
      return json({ error: "bad_idempotency_key" }, 400);
    }

    const same = await db<any[]>(`research_runs?idempotency_key=eq.${body.idempotencyKey}&select=${COLS}`);
    if (same[0]) return json({ run: same[0], resumed: true });

    const since = new Date(Date.now() - 6 * 3_600_000).toISOString();
    const active = await db<any[]>(
      `research_runs?status=in.(created,running,incomplete)&created_at=gte.${since}&select=${COLS}&order=created_at.desc&limit=1`
    );
    if (active[0]) return json({ run: active[0], resumed: true });

    await db("research_runs?on_conflict=idempotency_key", {
      method: "POST",
      prefer: "resolution=ignore-duplicates,return=minimal",
      body: { idempotency_key: body.idempotencyKey, config: { mode: "automatic" } },
    });
    const rows = await db<any[]>(`research_runs?idempotency_key=eq.${body.idempotencyKey}&select=${COLS}`);
    if (!rows[0]) return json({ error: "not_saved" }, 502);
    await db("audit_events", {
      method: "POST",
      prefer: "return=minimal",
      body: { event_type: "run_started", entity_type: "research_run", entity_id: rows[0].id, actor: "editor" },
    });
    return json({ run: rows[0], resumed: false }, 201);
  } catch (e) {
    if (e instanceof DbError) return json({ error: "database", detail: e.message }, e.status);
    return json({ error: "server_error" }, 500);
  }
};

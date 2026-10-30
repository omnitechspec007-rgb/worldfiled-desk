// Read-only view of the source registry (health and region coverage). No manual editing:
// sources are built in and tested automatically on every run.
import { isAuthenticated } from "../lib/session.mts";
import { db, DbError } from "../lib/db.mts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export default async (req: Request) => {
  if (!isAuthenticated(req)) return json({ error: "unauthorized" }, 401);
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  try {
    const sources = await db(
      "source_registry?select=id,name,publisher,country_scope,category,feed_url,source_type,retrieval_status,last_checked_at,last_success_at,last_error&order=name.asc"
    );
    return json({ sources });
  } catch (e) {
    if (e instanceof DbError) return json({ error: "database", detail: e.message }, e.status);
    return json({ error: "server_error" }, 500);
  }
};

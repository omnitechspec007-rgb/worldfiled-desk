// Editor decision on a story: approve, reject or request more research.
// Approval requires a deliberate acknowledgement. Every decision is saved with the editor's notes
// and an audit event. Nothing is ever approved automatically.
import { isAuthenticated } from "../lib/session.mts";
import { db, DbError } from "../lib/db.mts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

const STATUS: Record<string, string> = { approved: "approved", rejected: "rejected", needs_research: "needs_research" };

export default async (req: Request) => {
  if (!isAuthenticated(req)) return json({ error: "unauthorized" }, 401);
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let body: any;
  try {
    const text = await req.text();
    if (text.length > 4000) return json({ error: "too_large" }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (typeof body.storyId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.storyId)) return json({ error: "bad_request" }, 400);
  if (typeof body.decision !== "string" || !(body.decision in STATUS)) return json({ error: "bad_decision" }, 400);
  if (body.decision === "approved" && body.acknowledged !== true) return json({ error: "acknowledgement_required" }, 400);
  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 1000) : "";

  try {
    const found = await db<any[]>(`stories?id=eq.${body.storyId}&select=id,editorial_status`);
    if (!found[0]) return json({ error: "not_found" }, 404);
    await db("editorial_decisions", {
      method: "POST",
      prefer: "return=minimal",
      body: { story_id: body.storyId, decision: body.decision, decided_by: "editor", notes: notes || null },
    });
    await db(`stories?id=eq.${body.storyId}`, { method: "PATCH", prefer: "return=minimal", body: { editorial_status: STATUS[body.decision] } });
    await db("audit_events", {
      method: "POST",
      prefer: "return=minimal",
      body: {
        event_type: `story_${body.decision}`,
        entity_type: "story",
        entity_id: body.storyId,
        actor: "editor",
        detail: { previous: found[0].editorial_status, notes: notes || null, acknowledged: body.acknowledged === true },
      },
    });
    return json({ ok: true, status: STATUS[body.decision] });
  } catch (e) {
    if (e instanceof DbError) return json({ error: "database", detail: e.message }, e.status);
    return json({ error: "server_error" }, 500);
  }
};

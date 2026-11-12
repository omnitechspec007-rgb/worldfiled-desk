// Editor decision on a story: approve, reject or request more research.
// Approval requires a deliberate acknowledgement. Every decision is saved with the editor's notes
// and an audit event. Nothing is ever approved automatically.
import { createHash } from "node:crypto";
import { hasSameOrigin, isAuthenticated } from "../lib/session.mts";
import { db, DbError } from "../lib/db.mts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

const STATUS: Record<string, string> = { approved: "approved", rejected: "rejected", needs_research: "needs_research" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async (req: Request) => {
  if (!isAuthenticated(req)) return json({ error: "unauthorized" }, 401);
  if (req.method === "POST" && !hasSameOrigin(req)) return json({ error: "origin_mismatch" }, 403);
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let body: any;
  try {
    const text = await req.text();
    if (text.length > 4000) return json({ error: "too_large" }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "bad_request" }, 400);
  if (typeof body.storyId !== "string" || !UUID.test(body.storyId)) return json({ error: "bad_request" }, 400);
  if (typeof body.decision !== "string" || !Object.hasOwn(STATUS, body.decision)) return json({ error: "bad_decision" }, 400);
  if (body.decision === "approved" && body.acknowledged !== true) return json({ error: "acknowledgement_required" }, 400);
  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== "string") return json({ error: "bad_notes" }, 400);
  if (typeof body.notes === "string" && body.notes.trim().length > 1000) return json({ error: "field_too_long", detail: "Editor notes are limited to 1,000 characters. Nothing was truncated or saved." }, 400);
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";

  const key = req.headers.get("idempotency-key") ?? "";
  if (!UUID.test(key)) return json({ error: "idempotency_key_required", detail: "A valid Idempotency-Key UUID is required. Retry the same operation with the same key." }, 400);
  const canonical = JSON.stringify({ storyId: body.storyId, decision: body.decision, notes, acknowledged: body.acknowledged === true });
  const requestHash = createHash("sha256").update(canonical).digest("hex");

  try {
    const result: any = await db<any>("rpc/record_story_editorial_decision", {
      method: "POST",
      body: {
        p_idempotency_key: key,
        p_request_hash: requestHash,
        p_story_id: body.storyId,
        p_decision: body.decision,
        p_notes: notes,
        p_acknowledged: body.acknowledged === true,
      },
    });
    const status = Number(result?.status ?? 500);
    const responseBody = result?.body ?? { error: "invalid_rpc_response" };
    return json({ ...responseBody, replayed: result?.replayed === true }, status);
  } catch (e) {
    if (e instanceof DbError) {
      // A PostgREST 404 for this RPC means the required migration/function is absent.
      // Other upstream 4xx responses are definitive rejections, not ambiguous commits.
      if (e.upstream === 404) {
        return json({
          error: "editorial_setup_required",
          detail: "Editorial decision storage is not installed in the connected database. No decision was saved. Install the reviewed editorial-decision migration, then retry this same request.",
          outcome: "not_saved",
          retryWithSameKey: true,
        }, 503);
      }
      if (e.upstream !== undefined && e.upstream >= 400 && e.upstream < 500) {
        return json({
          error: "decision_rejected",
          detail: "The database rejected this decision before it was saved. Review the request or database setup; no decision was recorded.",
          outcome: "not_saved",
          retryWithSameKey: false,
        }, e.upstream);
      }
      return json({ error: "database", detail: e.message, outcome: "unknown", retryWithSameKey: true }, e.status);
    }
    return json({ error: "server_error", outcome: "unknown", retryWithSameKey: true }, 500);
  }
};

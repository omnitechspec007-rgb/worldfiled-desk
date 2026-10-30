// Source registry: list, add and enable/disable. New sources start DISABLED and "untested".
// Nothing is enabled automatically, and no feed URLs are invented.
import { isAuthenticated } from "../lib/session.mts";
import { db, DbError } from "../lib/db.mts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

function httpsUrl(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export default async (req: Request) => {
  if (!isAuthenticated(req)) return json({ error: "unauthorized" }, 401);
  try {
    if (req.method === "GET") {
      const sources = await db(
        "source_registry?select=id,name,publisher,country_scope,category,source_url,feed_url,source_type,enabled,retrieval_status,last_checked_at,last_success_at,last_error&order=name.asc"
      );
      return json({ sources });
    }

    const text = await req.text();
    if (text.length > 5000) return json({ error: "too_large" }, 413);
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: "bad_request" }, 400);
    }

    if (req.method === "POST") {
      const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
      if (!name) return json({ error: "name_required" }, 400);
      const sourceUrl = httpsUrl(body.sourceUrl);
      const feedUrl = httpsUrl(body.feedUrl);
      if ((body.sourceUrl && !sourceUrl) || (body.feedUrl && !feedUrl)) return json({ error: "bad_url" }, 400);
      await db("source_registry", {
        method: "POST",
        prefer: "return=minimal",
        body: {
          name,
          publisher: String(body.publisher ?? "").slice(0, 120) || null,
          country_scope: String(body.countryScope ?? "").slice(0, 80) || null,
          category: String(body.category ?? "").slice(0, 80) || null,
          source_url: sourceUrl,
          feed_url: feedUrl,
          enabled: false,
          retrieval_status: "untested",
        },
      });
      await db("audit_events", {
        method: "POST",
        prefer: "return=minimal",
        body: { event_type: "source_added", entity_type: "source_registry", entity_id: name, actor: "editor" },
      });
      return json({ ok: true }, 201);
    }

    if (req.method === "PATCH") {
      if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id) || typeof body.enabled !== "boolean") {
        return json({ error: "bad_request" }, 400);
      }
      await db(`source_registry?id=eq.${body.id}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: { enabled: body.enabled },
      });
      await db("audit_events", {
        method: "POST",
        prefer: "return=minimal",
        body: {
          event_type: body.enabled ? "source_enabled" : "source_disabled",
          entity_type: "source_registry",
          entity_id: body.id,
          actor: "editor",
        },
      });
      return json({ ok: true });
    }
    return json({ error: "method_not_allowed" }, 405);
  } catch (e) {
    if (e instanceof DbError) {
      const dup = e.message.includes("409");
      return json({ error: dup ? "duplicate" : "database", detail: e.message }, dup ? 409 : e.status);
    }
    return json({ error: "server_error" }, 500);
  }
};

// Creates a draft card stack and caption for APPROVED stories only.
// Two independent gates: this function checks the latest human decision, and the database itself
// refuses to record an export unless that decision is "approved".
// The draft contains only facts that were collected (headline, outlet, dates, short attributed
// summary, links). It never invents context: "why it matters" is left for the editor.
import { isAuthenticated } from "../lib/session.mts";
import { db, DbError } from "../lib/db.mts";
import { buildPrompt, type PromptStory } from "../lib/prompt-builder.mts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

const trim = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

export default async (req: Request) => {
  if (!isAuthenticated(req)) return json({ error: "unauthorized" }, 401);
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let ids: string[] = [];
  let duration: 60 | 90 = 60;
  let angle = "";
  try {
    const body = JSON.parse(await req.text());
    ids = Array.isArray(body.storyIds) ? body.storyIds : [];
    duration = body.durationSeconds === 90 ? 90 : 60;
    angle = typeof body.angle === "string" ? body.angle.slice(0, 160) : "";
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (ids.length < 1 || ids.length > 6 || !ids.every((i) => typeof i === "string" && /^[0-9a-f-]{36}$/i.test(i))) {
    return json({ error: "bad_request", detail: "Choose between 1 and 6 stories." }, 400);
  }
  try {
    const cards: any[] = [];
    const promptStories: PromptStory[] = [];
    for (const id of ids) {
      const latest = await db<any[]>(`editorial_decisions?story_id=eq.${id}&select=decision,created_at&order=created_at.desc&limit=1`);
      if (latest[0]?.decision !== "approved") return json({ error: "not_approved", storyId: id }, 409);
      const rows = await db<any[]>(
        `stories?id=eq.${id}&select=headline,category,story_source_links(retrieved_sources(title,url,published_at,extract,source_registry(name,country_scope,reliability_note)))`
      );
      const st = rows[0];
      if (!st) return json({ error: "not_found", storyId: id }, 404);
      const sources = (st.story_source_links ?? []).map((l: any) => l.retrieved_sources).filter(Boolean);
      sources.sort((a: any, b: any) => Number(/tier:primary/.test(b.source_registry?.reliability_note ?? "")) - Number(/tier:primary/.test(a.source_registry?.reliability_note ?? "")));
      const lead = sources[0];
      const outlets = [...new Set(sources.map((s: any) => s.source_registry?.name).filter(Boolean))] as string[];
      promptStories.push({
        headline: st.headline,
        category: st.category,
        regions: [...new Set(sources.map((s: any) => (s.source_registry?.country_scope ?? "").split(" · ")[0]).filter(Boolean))] as string[],
        facts: sources.slice(0, 5).map((s: any) => ({
          outlet: s.source_registry?.name ?? "Unknown",
          title: s.title ?? "",
          summary: s.extract ?? null,
          url: s.url,
          publishedAt: s.published_at ?? null,
          tier: /tier:primary/.test(s.source_registry?.reliability_note ?? "") ? "primary" : "reporting",
        })),
      });
      cards.push({
        storyId: id,
        headline: st.headline,
        category: st.category,
        attribution: lead?.extract ? `According to ${lead.source_registry?.name ?? "the source"}: ${trim(lead.extract, 180)}` : null,
        outlets,
        links: sources.slice(0, 4).map((s: any) => ({ outlet: s.source_registry?.name ?? "Source", url: s.url })),
      });
    }
    for (const id of ids) {
      await db("export_records", {
        method: "POST",
        prefer: "return=minimal",
        body: { story_id: id, format: "text-card-draft", created_by: "editor" },
      });
      await db("audit_events", {
        method: "POST",
        prefer: "return=minimal",
        body: { event_type: "export_created", entity_type: "story", entity_id: id, actor: "editor" },
      });
    }
    const caption =
      "Sources:\n" + cards.map((c, i) => `${i + 1}. ${c.headline}\n` + c.links.map((l: any) => `   ${l.outlet}: ${l.url}`).join("\n")).join("\n");
    const prompt = buildPrompt({ stories: promptStories, durationSeconds: duration, angle });
    return json({ cards, caption, prompt, note: "Draft built only from collected headlines and short summaries. Read the sources and add 'why it matters' yourself before posting." });
  } catch (e) {
    if (e instanceof DbError) return json({ error: "database", detail: e.message }, e.status);
    return json({ error: "server_error" }, 500);
  }
};

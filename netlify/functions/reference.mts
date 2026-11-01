// Reference Style Library API (analysis only: no video is stored or processed here).
//   GET                         videos and rules (all versions)
//   POST {action:"seed"}        load the verified/observed proposals (all PROPOSED), idempotent
//   POST {action:"decide",id,status}   APPROVE or REJECT a PROPOSED rule (human action, audited)
//   POST {action:"revise",id,statement}  save edited wording as a NEW PROPOSED version
import { isAuthenticated } from "../lib/session.mts";
import { db, DbError } from "../lib/db.mts";
import { SEED_RULES, SEED_VIDEOS } from "../lib/reference-seed.mts";
import { cleanField } from "../lib/evidence-pack.mts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const UUID = /^[0-9a-f-]{36}$/i;
const audit = (event_type: string, id: string, detail: unknown) =>
  db("audit_events", { method: "POST", prefer: "return=minimal", body: { event_type, entity_type: "style_rule", entity_id: id, actor: "editor", detail } });

export default async (req: Request) => {
  if (!isAuthenticated(req)) return json({ error: "unauthorized" }, 401);
  try {
    if (req.method === "GET") {
      const videos = await db<any[]>("reference_videos?select=*&order=label.asc");
      const rules = await db<any[]>("style_rules?select=*&order=category.asc,rule_key.asc,version.asc");
      return json({ videos, rules });
    }
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    let b: any;
    try {
      b = JSON.parse(await req.text());
    } catch {
      return json({ error: "bad_request" }, 400);
    }
    if (b.action === "seed") {
      await db("reference_videos?on_conflict=original_filename", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: SEED_VIDEOS });
      const vids = await db<any[]>("reference_videos?select=id,original_filename");
      const ids = vids.map((v) => v.id);
      await db("style_rules?on_conflict=rule_key,version", {
        method: "POST",
        prefer: "resolution=ignore-duplicates,return=minimal",
        body: SEED_RULES.map((r) => ({ ...r, version: 1, reference_video_ids: r.evidence_basis === "user_stated" ? [] : ids })),
      });
      await audit("style_rules_seeded", "library", { rules: SEED_RULES.length, videos: SEED_VIDEOS.length, status: "all PROPOSED" });
      return json({ ok: true });
    }
    if (b.action === "decide") {
      if (!UUID.test(String(b.id)) || !["APPROVED", "REJECTED"].includes(b.status)) return json({ error: "bad_request" }, 400);
      const cur = (await db<any[]>(`style_rules?id=eq.${b.id}&select=id,status,rule_key,version`))[0];
      if (!cur) return json({ error: "not_found" }, 404);
      if (cur.status !== "PROPOSED") return json({ error: "already_decided", detail: "A decided rule cannot be changed. Edit it to create a new version." }, 409);
      await db(`style_rules?id=eq.${b.id}&status=eq.PROPOSED`, { method: "PATCH", prefer: "return=minimal", body: { status: b.status, decided_by: "editor", decided_at: new Date().toISOString() } });
      await audit(b.status === "APPROVED" ? "style_rule_approved" : "style_rule_rejected", b.id, { rule_key: cur.rule_key, version: cur.version });
      return json({ ok: true });
    }
    if (b.action === "revise") {
      const statement = cleanField(typeof b.statement === "string" ? b.statement : "", 500);
      if (!UUID.test(String(b.id)) || statement.length < 10) return json({ error: "bad_request", detail: "Write at least a short sentence." }, 400);
      const cur = (await db<any[]>(`style_rules?id=eq.${b.id}&select=*`))[0];
      if (!cur) return json({ error: "not_found" }, 404);
      const top = (await db<any[]>(`style_rules?rule_key=eq.${encodeURIComponent(cur.rule_key)}&select=version&order=version.desc&limit=1`))[0];
      const next = (top?.version ?? cur.version) + 1;
      await db("style_rules", {
        method: "POST",
        prefer: "return=minimal",
        body: { rule_key: cur.rule_key, version: next, category: cur.category, statement, evidence_basis: "user_stated", evidence_note: `Edited by the editor from version ${cur.version}.`, reference_video_ids: cur.reference_video_ids ?? [], supersedes_id: cur.id },
      });
      await audit("style_rule_revised", cur.id, { rule_key: cur.rule_key, new_version: next });
      return json({ ok: true, version: next });
    }
    return json({ error: "bad_request" }, 400);
  } catch (e) {
    if (e instanceof DbError && e.upstream === 404) return json({ notInstalled: true, videos: [], rules: [] });
    if (e instanceof DbError) return json({ error: "database", detail: e.message }, e.status);
    return json({ error: "server_error" }, 500);
  }
};

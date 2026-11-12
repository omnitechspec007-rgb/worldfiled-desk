// Creative Desk setup API (editor session required).
//   GET                              presenter profile, saved voice configuration, delivery profiles, capability registry, tool confirmations, lexicon
//   POST {action:"save-voice", voice}            validate and save the voice configuration (an engine, voice or model change voids the listening approval)
//   POST {action:"approve-voice", listened:true, note?}   record a human listening approval for the CURRENT engine + voice + model
//   POST {action:"save-tools", toolsConfirmed:[keys]}     which free or manual capabilities the editor confirms are available
//   POST {action:"save-lexicon", entry}          add or replace one pronunciation entry (status rules enforced; nothing is invented)
// The app never calls a voice engine and never generates audio.
import { hasSameOrigin, isAuthenticated } from "../lib/session.mts";
import { db, DbError } from "../lib/db.mts";
import { loadCreative } from "../lib/creative-data.mts";
import { CAPABILITIES, CONTROLS, LAOMEDEIA_REFERENCE, LEX_STATUSES, LICENCE_STATUSES, PRESENTER, PRESENTER_VERSION, PROFILES, PRONUNCIATION_HANDLING, VOICE_STATUSES, approvalState, lexKey, validateLexEntry, validateVoice, voiceKey } from "../lib/presenter.mts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export default async (req: Request) => {
  if (!isAuthenticated(req)) return json({ error: "unauthorized" }, 401);
  if (req.method === "POST" && !hasSameOrigin(req)) return json({ error: "origin_mismatch" }, 403);
  try {
    if (req.method === "GET") return await view();
    if (req.method === "POST") {
      let b: any; try { b = JSON.parse(await req.text()); } catch { return json({ error: "bad_request" }, 400); }
      switch (b.action) {
        case "save-voice": return await saveVoice(b);
        case "approve-voice": return await approveVoice(b);
        case "save-tools": return await saveTools(b);
        case "save-lexicon": return await saveLexicon(b);
      }
      return json({ error: "bad_request" }, 400);
    }
    return json({ error: "method_not_allowed" }, 405);
  } catch (e) {
    if (e instanceof DbError) return json({ error: "database", detail: e.message }, e.status);
    return json({ error: "server_error" }, 500);
  }
};

async function put(key: string, value: unknown) {
  await db("system_settings?on_conflict=key", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { key, value } });
}
async function view() {
  const { settings, lex, configured } = await loadCreative();
  return json({
    presenterVersion: PRESENTER_VERSION, presenter: PRESENTER, laomedeiaReference: LAOMEDEIA_REFERENCE, configured,
    voice: settings.voice, voiceKey: voiceKey(settings.voice), approval: approvalState(settings.voice), toolsConfirmed: settings.toolsConfirmed,
    options: { statuses: VOICE_STATUSES, licences: LICENCE_STATUSES, pronunciationHandling: PRONUNCIATION_HANDLING, controls: CONTROLS, lexiconStatuses: LEX_STATUSES },
    profiles: Object.values(PROFILES), capabilities: CAPABILITIES, lexicon: lex,
    note: "Laomedeia is a reference profile. Engine terms, model and regional availability and commercial use are not verified, and nothing here has been tested unless you record it.",
  });
}
async function saveVoice(b: any) {
  const cur = (await loadCreative()).settings;
  const incoming = { ...b.voice, approval: cur.voice.approval }; // approval is only changed by approve-voice
  const v = validateVoice(incoming);
  if (!v.ok) return json({ error: "invalid_voice", errors: v.errors }, 400);
  const changed = voiceKey(v.voice) !== voiceKey(cur.voice);
  await put("creative_desk", { voice: v.voice, toolsConfirmed: cur.toolsConfirmed });
  await db("audit_events", { method: "POST", prefer: "return=minimal", body: { event_type: "creative_voice_saved", entity_type: "settings", entity_id: null, actor: "editor", detail: { engine: v.voice.engine, voice: v.voice.voiceName, status: v.voice.status, voice_changed: changed } } });
  return json({ saved: true, voice: v.voice, approval: approvalState(v.voice), note: changed && cur.voice.approval.approved ? "The engine, voice or model changed, so the earlier listening approval no longer applies. Listen and approve again before treating this voice as approved." : undefined });
}
async function approveVoice(b: any) {
  if (b.listened !== true) return json({ error: "listening_required", detail: "Approval needs you to confirm you listened to this voice." }, 400);
  const cur = (await loadCreative()).settings;
  const draft = { ...cur.voice, approval: { approved: true, approvedAt: null, approvedVoiceKey: null, note: typeof b.note === "string" ? b.note : "" } };
  const v = validateVoice(draft);
  if (!v.ok) return json({ error: "not_ready", errors: v.errors }, 409);
  await put("creative_desk", { voice: v.voice, toolsConfirmed: cur.toolsConfirmed });
  await db("audit_events", { method: "POST", prefer: "return=minimal", body: { event_type: "creative_voice_approved", entity_type: "settings", entity_id: null, actor: "editor", detail: { voice_key: voiceKey(v.voice) } } });
  return json({ saved: true, approval: approvalState(v.voice), voice: v.voice });
}
async function saveTools(b: any) {
  const keys: string[] = Array.isArray(b.toolsConfirmed) ? b.toolsConfirmed : [];
  const bad = keys.filter((k) => !CAPABILITIES.some((c) => c.key === k));
  const paid = keys.filter((k) => CAPABILITIES.find((c) => c.key === k)?.cls === "PAID");
  if (bad.length) return json({ error: "bad_request", detail: "Unknown capability: " + bad.join(", ") }, 400);
  if (paid.length) return json({ error: "paid_not_allowed", detail: "Paid services cannot be marked as available: they are never assumed or used automatically." }, 400);
  const cur = (await loadCreative()).settings;
  await put("creative_desk", { voice: cur.voice, toolsConfirmed: [...new Set(keys)] });
  return json({ saved: true, toolsConfirmed: [...new Set(keys)] });
}
async function saveLexicon(b: any) {
  const r = validateLexEntry(b.entry);
  if (!r.ok) return json({ error: "invalid_entry", errors: r.errors }, 400);
  const { lex } = await loadCreative();
  const next = [...lex.filter((e) => lexKey(e.name) !== lexKey(r.entry.name)), r.entry].slice(-500);
  await put("pronunciation_lexicon", { entries: next });
  return json({ saved: true, entry: r.entry, count: next.length });
}

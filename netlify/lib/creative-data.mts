// Loads the editor's saved Creative Desk setup from the existing system_settings table (no new table).
//   key 'creative_desk'         -> { voice, toolsConfirmed }
//   key 'pronunciation_lexicon' -> { entries }
import { db, DbError } from "./db.mts";
import { CAPABILITIES, DEFAULT_SETTINGS, validateLexEntry, validateVoice, type CreativeSettings, type LexEntry } from "./presenter.mts";

async function setting(key: string): Promise<any | null> {
  try { const r = await db<any[]>(`system_settings?key=eq.${key}&select=value`); return r[0]?.value ?? null; }
  catch (e) { if (e instanceof DbError && e.upstream === 404) return null; throw e; }
}
export async function loadCreative(): Promise<{ settings: CreativeSettings; lex: LexEntry[]; configured: boolean }> {
  const cd = await setting("creative_desk"); const lx = await setting("pronunciation_lexicon");
  let settings: CreativeSettings = DEFAULT_SETTINGS; let configured = false;
  if (cd) {
    const v = validateVoice(cd.voice);
    const tools = Array.isArray(cd.toolsConfirmed) ? cd.toolsConfirmed.filter((k: unknown) => CAPABILITIES.some((c) => c.key === k && c.cls !== "PAID")) : [];
    if (v.ok) { settings = { voice: v.voice, toolsConfirmed: tools }; configured = true; }
  }
  const lex: LexEntry[] = [];
  for (const e of Array.isArray(lx?.entries) ? lx.entries : []) { const r = validateLexEntry(e); if (r.ok) lex.push(r.entry); }
  return { settings, lex, configured };
}

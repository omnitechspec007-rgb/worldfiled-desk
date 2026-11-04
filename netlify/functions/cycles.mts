// News cycle and publishing planner API (all routes need the editor session).
//   GET                         planner: schedule, upcoming times, current cycle (timeline, status, candidates, late-breaking), history
//   GET ?preview=1&mode=rolling&hours=6[&end=now|cutoff] | mode=custom&from=&to= | mode=continuous&publishAt=
//                               classify the stories for a coverage window without saving anything (used by the Edition Desk)
//   POST {action:"save-config", config}                 schedule, timezone, coverage, stage allowances
//   POST {action:"plan", publishAt, mode, label?, hours?, end?, from?, to?, acknowledgeOverlap?}
//   POST {action:"link-edition", id, editionId}         attach the (approved) edition to the open cycle
//   POST {action:"mark-stage", id, stage:"production"|"review", done}
//   POST {action:"mark-story", id, storyId, mark:"held_over"|"rejected", note?}
//   POST {action:"publish", id, acknowledgeSkippedStages?}   needs a current human approval of the linked edition
//   POST {action:"skip", id, reason}
// Nothing here researches, produces or publishes anything. It records the plan and tells the editor, with plain arithmetic, how the time stands.
import { isAuthenticated } from "../lib/session.mts";
import { db, DbError } from "../lib/db.mts";
import * as C from "../lib/cycle.mts";
import { loadPool, memberIds, latestEditionDecision, promptValidity, UUID } from "../lib/edition-data.mts";
import { membersKey } from "../lib/editions.mts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const iso = (ms: number) => new Date(ms).toISOString();
const ms = (s: unknown) => (typeof s === "string" ? Date.parse(s) : NaN);

export default async (req: Request) => {
  if (!isAuthenticated(req)) return json({ error: "unauthorized" }, 401);
  try {
    if (req.method === "GET") {
      const u = new URL(req.url);
      if (u.searchParams.get("preview")) return await preview(u);
      return await planner();
    }
    if (req.method === "POST") {
      let b: any;
      try { b = JSON.parse(await req.text()); } catch { return json({ error: "bad_request" }, 400); }
      switch (b.action) {
        case "save-config": return await saveConfig(b);
        case "plan": return await plan(b);
        case "link-edition": return await linkEdition(b);
        case "mark-stage": return await markStage(b);
        case "mark-story": return await markStory(b);
        case "publish": return await publish(b);
        case "skip": return await skip(b);
      }
      return json({ error: "bad_request" }, 400);
    }
    return json({ error: "method_not_allowed" }, 405);
  } catch (e) {
    if (e instanceof DbError) {
      if (e.upstream === 404) return json({ error: "not_installed", detail: "The planner tables are not installed yet (migration 005). Nothing was saved." }, 409);
      if (e.upstream === 400 || e.upstream === 409) return json({ error: "refused", detail: "The database refused this change (a rule such as one open cycle at a time, a closed cycle, or a missing approval)." }, 409);
      return json({ error: "database", detail: e.message }, e.status);
    }
    return json({ error: "server_error" }, 500);
  }
};

// ---------------- data ----------------
async function getConfig(): Promise<{ config: C.CycleConfig; configured: boolean }> {
  try {
    const rows = await db<any[]>("system_settings?key=eq.edition_schedule&select=value");
    if (rows[0]) { const v = C.validateConfig(rows[0].value); if (v.ok) return { config: v.config, configured: true }; }
  } catch (e) { if (!(e instanceof DbError && e.upstream === 404)) throw e; }
  return { config: C.DEFAULT_CONFIG, configured: false };
}
type Cycle = { id: string; label: string; mode: string; status: "open" | "published" | "skipped"; planned_publish_at: string; timezone: string; coverage_start: string; coverage_end: string; research_cutoff: string; timeline: any; edition_id: string | null; stage_done: any; previous_cycle_id: string | null; actual_published_at: string | null; skip_reason: string | null };
async function getCycles(): Promise<{ installed: boolean; cycles: Cycle[] }> {
  try { return { installed: true, cycles: await db<Cycle[]>("edition_cycles?select=*&order=planned_publish_at.desc&limit=40") }; }
  catch (e) { if (e instanceof DbError && e.upstream === 404) return { installed: false, cycles: [] }; throw e; }
}
const toRow = (c: Cycle): C.CycleRow => ({ id: c.id, label: c.label, status: c.status, coverageStart: Date.parse(c.coverage_start), coverageEnd: Date.parse(c.coverage_end), publishAt: Date.parse(c.planned_publish_at) });
async function getHistory(cycles: Cycle[]): Promise<Map<string, C.HistoryEntry[]>> {
  const out = new Map<string, C.HistoryEntry[]>();
  if (!cycles.length) return out;
  const byId = new Map(cycles.map((c) => [c.id, c]));
  const marks = await db<any[]>("cycle_stories?select=cycle_id,story_id,mark,created_at&order=created_at.desc&limit=1500");
  for (const m of marks) {
    const c = byId.get(m.cycle_id); if (!c) continue;
    if (c.status === "open" && m.mark === "published") continue;
    (out.get(m.story_id) ?? out.set(m.story_id, []).get(m.story_id)!).push({ cycleId: c.id, cycleLabel: c.label, mark: m.mark, coverageEnd: Date.parse(c.coverage_end), at: Date.parse(m.created_at) });
  }
  return out;
}
const timesOf = (d: any) => d.sources.map((s: any) => { const t = Date.parse(s.publishedAt ?? s.retrievedAt ?? ""); return Number.isFinite(t) ? { t, basis: s.publishedAt ? "published" : "retrieved" } : null; }).filter(Boolean) as { t: number; basis: string }[];

async function classifyWindow(w: C.Window, tz: string, now: number, cycles: Cycle[], cutoff: number | null, memberSet: Set<string>) {
  const { all, decisions } = await loadPool(now, 200);
  const hist = await getHistory(cycles);
  const items: any[] = [], late: any[] = [];
  for (const l of all) {
    const d = l.dev; const ts = timesOf(d);
    const times = ts.map((x) => x.t);
    const dec = decisions.get(d.id)?.decision ?? null;
    const c = C.classify({ id: d.id, times, hasDecision: dec !== null, decision: dec }, w, hist.get(d.id) ?? [], tz, now);
    const base = { id: d.id, headline: d.headline, corroborated: d.a.corroborated, evidenceStrength: d.a.evidenceStrength, outlets: d.outlets.size, decision: dec, inEdition: memberSet.has(d.id), timeBasis: ts.length && ts.every((x) => x.basis === "published") ? "published dates" : "some dates are retrieval times (the feed gave no publish date)" };
    if (c) items.push({ ...base, cls: c.cls, candidate: c.candidate, reason: c.reason });
    if (cutoff !== null && !memberSet.has(d.id) && dec !== "rejected" && C.isLateBreaking(times, cutoff, now)) late.push({ ...base, reason: `Reported after the research cutoff (${C.formatLocal(Math.min(...times.filter((t) => t >= cutoff)), tz)}). Not in the edition unless you add it.` });
  }
  return { items, late };
}

// ---------------- GET ----------------
async function planner() {
  const now = Date.now();
  const { config, configured } = await getConfig();
  const { installed, cycles } = await getCycles();
  const upcoming = C.upcoming(config, now, 4).map((p) => ({ label: p.label, publishAt: iso(p.publishAt), local: C.formatLocal(p.publishAt, config.timezone), timeline: tlOut(C.timeline(p.publishAt, config.allowances), config.timezone) }));
  const rows = cycles.map(toRow);
  const prev = C.previousCoverageEnd(rows);
  const open = cycles.find((c) => c.status === "open") ?? null;
  const out: any = {
    now: iso(now), nowLocal: C.formatLocal(now, config.timezone), installed, configured, config, upcoming,
    previous: prev.cycle ? { id: prev.cycle.id, label: prev.cycle.label, coverageStart: iso(prev.cycle.coverageStart), coverageEnd: iso(prev.cycle.coverageEnd), coverageLocal: `${C.formatLocal(prev.cycle.coverageStart, config.timezone)} to ${C.formatLocal(prev.cycle.coverageEnd, config.timezone)}` } : null,
    nextContinuousStart: prev.end ? iso(prev.end) : null,
    history: cycles.filter((c) => c.status !== "open").slice(0, 12).map((c) => ({ id: c.id, label: c.label, status: c.status, mode: c.mode, plannedPublishAt: c.planned_publish_at, actualPublishedAt: c.actual_published_at, coverageStart: c.coverage_start, coverageEnd: c.coverage_end, skipReason: c.skip_reason })),
    missedSlots: prev.cycle ? C.upcoming(config, prev.cycle.publishAt, 40).filter((p) => p.publishAt < now && !cycles.some((c) => Math.abs(Date.parse(c.planned_publish_at) - p.publishAt) < 60_000)).map((p) => ({ label: p.label, local: C.formatLocal(p.publishAt, config.timezone) })) : [],
    cycle: null,
  };
  if (open) out.cycle = await cycleView(open, config, now, cycles);
  return json(out);
}
const tlOut = (t: C.Timeline, tz: string) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, { at: iso(v as number), local: C.formatLocal(v as number, tz) }]));

async function cycleView(c: Cycle, config: C.CycleConfig, now: number, cycles: Cycle[]) {
  const tz = c.timezone;
  const a: C.Allowances = c.timeline?.allowances ?? config.allowances;
  const buffer: number = c.timeline?.atRiskBufferMin ?? config.atRiskBufferMin;
  const tl = C.timeline(Date.parse(c.planned_publish_at), a); tl.researchCutoff = Date.parse(c.research_cutoff);
  tl.researchDeadline = tl.selectionStart;
  const w = { start: Date.parse(c.coverage_start), end: Date.parse(c.coverage_end) };
  const members = c.edition_id ? await memberIds(c.edition_id) : [];
  const memberSet = new Set(members);
  const { items, late } = await classifyWindow(w, tz, now, cycles, w.end, memberSet);
  const dec = c.edition_id ? await latestEditionDecision(c.edition_id) : null;
  const approved = !!dec && dec.decision === "approved" && dec.members_hash === membersKey(members);
  let promptMade = false;
  if (approved && c.edition_id) {
    const ps = await db<any[]>(`edition_prompts?edition_id=eq.${c.edition_id}&select=id,edition_id,members,members_hash,approval_decision_id&order=version.desc&limit=1`).catch(() => []);
    if (ps[0]) promptMade = (await promptValidity(ps[0], now, false)).current;
  }
  const done = c.stage_done ?? {};
  const stage = C.deriveStage({ researchDone: members.length > 0, hasEdition: !!c.edition_id && members.length > 0, editionApproved: approved, promptMade, productionDone: !!done.production, reviewDone: !!done.review });
  const candidates = items.filter((x) => x.candidate);
  const st = C.standing({ now, tl, stage, a, bufferMin: buffer, tz, candidates: { corroborated: candidates.filter((x) => x.corroborated).length, approved: candidates.filter((x) => x.decision === "approved").length } });
  const marks = await db<any[]>(`cycle_stories?cycle_id=eq.${c.id}&select=story_id,mark,note,created_at&order=created_at.desc`);
  const latestMark = new Map<string, any>(); for (const m of marks) if (!latestMark.has(m.story_id)) latestMark.set(m.story_id, m);
  return {
    id: c.id, label: c.label, mode: c.mode, plannedPublishAt: c.planned_publish_at, plannedLocal: C.formatLocal(Date.parse(c.planned_publish_at), tz), timezone: tz,
    coverage: { start: c.coverage_start, end: c.coverage_end, local: `${C.formatLocal(w.start, tz)} to ${C.formatLocal(w.end, tz)}`, hours: Math.round(((w.end - w.start) / 3_600_000) * 10) / 10, halfOpen: "Includes the start, excludes the end: news reported at the cutoff belongs to the next edition." },
    timeline: tlOut(tl, tz), allowances: a, atRiskBufferMin: buffer,
    editionId: c.edition_id, editionMembers: members.length, approved, promptMade, stageDone: done,
    stage, standing: { ...st, suggestedPublishLocal: st.suggestedPublishAt ? C.formatLocal(st.suggestedPublishAt, tz) : null, suggestedPublishAt: st.suggestedPublishAt ? iso(st.suggestedPublishAt) : null },
    counts: { discovered: items.length, candidates: candidates.length, verified: candidates.filter((x) => x.corroborated).length, selected: members.length },
    stories: items.map((x) => ({ ...x, mark: latestMark.get(x.id)?.mark ?? null })).sort((a, b) => Number(b.candidate) - Number(a.candidate) || Number(b.corroborated) - Number(a.corroborated)),
    lateBreaking: late, quiet: candidates.length < 3 ? "A quiet window: fewer than three candidate developments. That is fine; publish a short edition rather than padding it." : null,
  };
}

async function preview(u: URL) {
  const now = Date.now();
  const { config } = await getConfig();
  const { cycles } = await getCycles();
  const mode = u.searchParams.get("mode") ?? "";
  const r = resolveWindow({ mode, hours: Number(u.searchParams.get("hours")), end: u.searchParams.get("end") ?? undefined, from: u.searchParams.get("from") ?? undefined, to: u.searchParams.get("to") ?? undefined, publishAt: u.searchParams.get("publishAt") ?? undefined }, config, cycles, now);
  if (!r.ok) return json({ error: "bad_request", detail: r.error }, 400);
  const { items } = await classifyWindow(r.window, config.timezone, now, cycles, null, new Set());
  return json({ window: { start: iso(r.window.start), end: iso(r.window.end), local: `${C.formatLocal(r.window.start, config.timezone)} to ${C.formatLocal(r.window.end, config.timezone)}`, hours: Math.round(((r.window.end - r.window.start) / 3_600_000) * 10) / 10 }, mode, overlaps: r.overlaps, stories: items, note: "Window is half-open: includes the start, excludes the end." });
}

// ---------------- windows ----------------
type WinArgs = { mode: string; hours?: number; end?: string; from?: string; to?: string; publishAt?: string };
function resolveWindow(a: WinArgs, config: C.CycleConfig, cycles: Cycle[], now: number, ignoreId?: string): { ok: true; window: C.Window; cutoff: number; overlaps: any[]; firstEdition?: boolean } | { ok: false; error: string } {
  const rows = cycles.map(toRow);
  let w: C.Window; let first: boolean | undefined;
  if (a.mode === "rolling") {
    const pub = ms(a.publishAt);
    const end = a.end === "cutoff" && Number.isFinite(pub) ? C.timeline(pub, config.allowances).researchCutoff : now;
    const r = C.rollingWindow(Number(a.hours), end); if (!r.ok) return r; w = r.window;
  } else if (a.mode === "custom") {
    const r = C.customWindow(ms(a.from), ms(a.to)); if (!r.ok) return r; w = r.window;
  } else if (a.mode === "continuous") {
    const pub = ms(a.publishAt); if (!Number.isFinite(pub)) return { ok: false, error: "A planned publication time is needed." };
    const cutoff = C.timeline(pub, config.allowances).researchCutoff;
    const r = C.continuousWindow(cutoff, C.previousCoverageEnd(rows).end, config); if (!r.ok) return r; w = r.window; first = r.firstEdition;
  } else return { ok: false, error: "Mode must be continuous, rolling or custom." };
  return { ok: true, window: w, cutoff: w.end, overlaps: C.windowOverlaps(w, rows, ignoreId), firstEdition: first };
}

// ---------------- POST ----------------
async function saveConfig(b: any) {
  const v = C.validateConfig(b.config);
  if (!v.ok) return json({ error: "invalid_config", errors: v.errors }, 400);
  await db("system_settings?on_conflict=key", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { key: "edition_schedule", value: v.config } });
  await db("audit_events", { method: "POST", prefer: "return=minimal", body: { event_type: "edition_schedule_saved", entity_type: "settings", entity_id: null, actor: "editor", detail: { slots: v.config.slots.length, timezone: v.config.timezone } } });
  return json({ saved: true, config: v.config });
}

async function plan(b: any) {
  const now = Date.now();
  const { config } = await getConfig();
  const { installed, cycles } = await getCycles();
  if (!installed) return json({ error: "not_installed", detail: "The planner tables are not installed yet (migration 005). Nothing was saved." }, 409);
  if (cycles.some((c) => c.status === "open")) return json({ error: "cycle_open", detail: "There is already an open edition cycle. Publish or skip it first." }, 409);
  const pub = ms(b.publishAt);
  if (!Number.isFinite(pub) || pub <= now) return json({ error: "bad_request", detail: "Choose a publication time in the future." }, 400);
  const mode = String(b.mode ?? "continuous");
  const r = resolveWindow({ mode, hours: Number(b.hours), end: b.end, from: b.from, to: b.to, publishAt: b.publishAt }, config, cycles, now);
  if (!r.ok) return json({ error: "bad_request", detail: r.error }, 400);
  if (r.window.end > pub) return json({ error: "bad_request", detail: "The coverage window must end before the publication time." }, 400);
  if (r.overlaps.length && b.acknowledgeOverlap !== true) return json({ error: "overlap", detail: "This window overlaps an earlier edition's coverage. Stories in the overlap may be repeats.", overlaps: r.overlaps }, 409);
  const tl = C.timeline(pub, config.allowances);
  const cutoff = r.window.end;
  const label = (typeof b.label === "string" && b.label.trim() ? b.label.trim() : "Edition").slice(0, 80);
  const prev = C.previousCoverageEnd(cycles.map(toRow));
  const timeline = { allowances: config.allowances, atRiskBufferMin: config.atRiskBufferMin, stages: tlOut({ ...tl, researchCutoff: cutoff }, config.timezone), plannedCutoff: iso(tl.researchCutoff), cutoffNote: cutoff > tl.researchCutoff ? "The cutoff is later than the schedule's normal cutoff, so research and review have less time than your allowances." : null };
  const rows = await db<any[]>("edition_cycles", { method: "POST", prefer: "return=representation", body: { label, mode, planned_publish_at: iso(pub), timezone: config.timezone, coverage_start: iso(r.window.start), coverage_end: iso(cutoff), research_cutoff: iso(cutoff), timeline, previous_cycle_id: mode === "continuous" ? prev.cycle?.id ?? null : null, created_by: "editor" } });
  const id = (Array.isArray(rows) ? rows[0] : rows).id;
  await db("audit_events", { method: "POST", prefer: "return=minimal", body: { event_type: "cycle_planned", entity_type: "edition_cycle", entity_id: id, actor: "editor", detail: { mode, coverage_start: iso(r.window.start), coverage_end: iso(cutoff), planned_publish_at: iso(pub), overlap_acknowledged: r.overlaps.length > 0 } } });
  return json({ saved: true, id, firstEdition: r.firstEdition ?? false });
}

async function openCycle(id: unknown): Promise<Cycle | Response> {
  if (typeof id !== "string" || !UUID.test(id)) return json({ error: "bad_request" }, 400);
  const rows = await db<Cycle[]>(`edition_cycles?id=eq.${id}&select=*`);
  if (!rows[0]) return json({ error: "not_found" }, 404);
  if (rows[0].status !== "open") return json({ error: "closed", detail: `This cycle is ${rows[0].status} and cannot be changed.` }, 409);
  return rows[0];
}

async function linkEdition(b: any) {
  const c = await openCycle(b.id); if (c instanceof Response) return c;
  if (typeof b.editionId !== "string" || !UUID.test(b.editionId)) return json({ error: "bad_request" }, 400);
  const e = await db<any[]>(`editions?id=eq.${b.editionId}&select=id,status`);
  if (!e[0] || e[0].status !== "draft") return json({ error: "not_found", detail: "That edition does not exist or is archived." }, 404);
  await db(`edition_cycles?id=eq.${c.id}`, { method: "PATCH", prefer: "return=minimal", body: { edition_id: b.editionId } });
  await db("audit_events", { method: "POST", prefer: "return=minimal", body: { event_type: "cycle_edition_linked", entity_type: "edition_cycle", entity_id: c.id, actor: "editor", detail: { edition_id: b.editionId } } });
  return json({ saved: true });
}

async function markStage(b: any) {
  const c = await openCycle(b.id); if (c instanceof Response) return c;
  if (!["production", "review"].includes(b.stage) || typeof b.done !== "boolean") return json({ error: "bad_request" }, 400);
  const done = { ...(c.stage_done ?? {}) } as any;
  if (b.done) {
    if (b.stage === "production" && !c.edition_id) return json({ error: "blocked", detail: "Link an approved edition before marking production done." }, 409);
    if (b.stage === "review" && !done.production) return json({ error: "blocked", detail: "Mark production done before final review." }, 409);
    done[b.stage] = iso(Date.now());
  } else { delete done[b.stage]; if (b.stage === "production") delete done.review; }
  await db(`edition_cycles?id=eq.${c.id}`, { method: "PATCH", prefer: "return=minimal", body: { stage_done: done } });
  return json({ saved: true, stageDone: done });
}

async function markStory(b: any) {
  const c = await openCycle(b.id); if (c instanceof Response) return c;
  if (typeof b.storyId !== "string" || !UUID.test(b.storyId) || !["held_over", "rejected"].includes(b.mark)) return json({ error: "bad_request" }, 400);
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 1000) : "";
  await db("cycle_stories", { method: "POST", prefer: "return=minimal", body: { cycle_id: c.id, story_id: b.storyId, mark: b.mark, note: note || null } });
  return json({ saved: true });
}

async function publish(b: any) {
  if (typeof b.id !== "string" || !UUID.test(b.id)) return json({ error: "bad_request" }, 400);
  const rows = await db<Cycle[]>(`edition_cycles?id=eq.${b.id}&select=*`);
  const c = rows[0]; if (!c) return json({ error: "not_found" }, 404);
  if (c.status === "skipped") return json({ error: "closed", detail: "A skipped cycle cannot be published." }, 409);
  const members = c.edition_id ? await memberIds(c.edition_id) : [];
  if (c.status === "open") {
    if (!c.edition_id || !members.length) return json({ error: "blocked", detail: "Link an edition with at least one development first." }, 409);
    const dec = await latestEditionDecision(c.edition_id);
    if (!(dec?.decision === "approved" && dec.members_hash === membersKey(members))) return json({ error: "blocked", detail: "The linked edition has no current human approval." }, 409);
    const d = c.stage_done ?? {};
    if ((!d.production || !d.review) && b.acknowledgeSkippedStages !== true) return json({ error: "stages_incomplete", detail: "Production and final review are not both marked done. Confirm to record it as published anyway." }, 409);
    await db(`edition_cycles?id=eq.${c.id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "published", actual_published_at: iso(Date.now()) } });
  }
  // Idempotent: also repairs a publish whose marks failed to save earlier.
  const have = await db<any[]>(`cycle_stories?cycle_id=eq.${c.id}&mark=eq.published&select=story_id`);
  const haveSet = new Set(have.map((h) => h.story_id));
  const missing = members.filter((m) => !haveSet.has(m));
  if (missing.length) await db("cycle_stories", { method: "POST", prefer: "return=minimal", body: missing.map((s) => ({ cycle_id: c.id, story_id: s, mark: "published" })) });
  if (c.status === "open") await db("audit_events", { method: "POST", prefer: "return=minimal", body: { event_type: "cycle_published", entity_type: "edition_cycle", entity_id: c.id, actor: "editor", detail: { members: members.length } } });
  return json({ published: true, marked: missing.length });
}

async function skip(b: any) {
  const c = await openCycle(b.id); if (c instanceof Response) return c;
  const reason = typeof b.reason === "string" ? b.reason.trim().slice(0, 1000) : "";
  if (reason.length < 5) return json({ error: "reason_required", detail: "Write a short reason (at least 5 characters)." }, 400);
  await db(`edition_cycles?id=eq.${c.id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "skipped", skip_reason: reason } });
  await db("audit_events", { method: "POST", prefer: "return=minimal", body: { event_type: "cycle_skipped", entity_type: "edition_cycle", entity_id: c.id, actor: "editor", detail: { reason } } });
  return json({ saved: true, note: "The next continuous edition will cover this period, so nothing is lost." });
}

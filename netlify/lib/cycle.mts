// News cycle and publishing planner: pure, deterministic time logic. No network, no database.
// Coverage time (which events are covered) is kept separate from production time (how long the work takes).
// Windows are half-open [start, end): an item reported exactly at `end` belongs to the NEXT window, so nothing is missed or doubled.

export type Slot = { label: string; time: string; days?: number[] }; // time "HH:MM" local; days 0=Sun..6=Sat (default every day)
export type Allowances = { discoveryVerifyMin: number; selectionMin: number; promptMin: number; productionMin: number; finalReviewMin: number };
export type CycleConfig = { timezone: string; slots: Slot[]; coverageHours: number; allowances: Allowances; atRiskBufferMin: number };

export const DEFAULT_CONFIG: CycleConfig = {
  timezone: "America/New_York",
  slots: [{ label: "Morning edition", time: "06:00" }, { label: "Evening edition", time: "18:00" }],
  coverageHours: 12,
  allowances: { discoveryVerifyMin: 90, selectionMin: 45, promptMin: 15, productionMin: 120, finalReviewMin: 45 },
  atRiskBufferMin: 30,
};
const MIN = 60_000, HOUR = 3_600_000;

// ---------------- configuration ----------------
export function validTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}
export function validateConfig(raw: any): { ok: true; config: CycleConfig } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const c = raw && typeof raw === "object" ? raw : {};
  if (!validTimezone(c.timezone)) errors.push("Timezone must be a valid IANA name such as America/New_York.");
  const slots: Slot[] = [];
  if (!Array.isArray(c.slots) || c.slots.length < 1 || c.slots.length > 6) errors.push("Give between 1 and 6 publication times.");
  else {
    const seen = new Set<string>();
    for (const s of c.slots) {
      const label = typeof s?.label === "string" ? s.label.trim() : "";
      const time = typeof s?.time === "string" ? s.time.trim() : "";
      if (!label || label.length > 40) { errors.push("Each publication time needs a name of 1 to 40 characters."); continue; }
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) { errors.push(`"${label}": time must be HH:MM in 24-hour form.`); continue; }
      if (seen.has(label.toLowerCase())) { errors.push(`Two publication times are both named "${label}".`); continue; }
      seen.add(label.toLowerCase());
      let days: number[] | undefined;
      if (s.days !== undefined) {
        if (!Array.isArray(s.days) || !s.days.length || s.days.some((d: unknown) => !Number.isInteger(d) || (d as number) < 0 || (d as number) > 6)) { errors.push(`"${label}": days must be numbers 0 (Sunday) to 6 (Saturday).`); continue; }
        days = [...new Set<number>(s.days)].sort();
      }
      slots.push({ label, time, ...(days && days.length < 7 ? { days } : {}) });
    }
  }
  const num = (v: unknown, lo: number, hi: number, name: string) => { if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v) || v < lo || v > hi) { errors.push(`${name} must be a whole number from ${lo} to ${hi}.`); return lo; } return v; };
  const a = c.allowances ?? {};
  const allowances: Allowances = {
    discoveryVerifyMin: num(a.discoveryVerifyMin, 15, 720, "Research and verification time (minutes)"),
    selectionMin: num(a.selectionMin, 10, 480, "Selection and coherence review time (minutes)"),
    promptMin: num(a.promptMin, 5, 120, "Prompt time (minutes)"),
    productionMin: num(a.productionMin, 15, 1440, "Production time in Claude (minutes)"),
    finalReviewMin: num(a.finalReviewMin, 10, 480, "Final review buffer (minutes)"),
  };
  const coverageHours = num(c.coverageHours, 1, 168, "Default coverage (hours)");
  const atRiskBufferMin = num(c.atRiskBufferMin, 0, 240, "At-risk buffer (minutes)");
  if (errors.length) return { ok: false, errors };
  return { ok: true, config: { timezone: c.timezone, slots, coverageHours, allowances, atRiskBufferMin } };
}

// ---------------- timezone-safe wall-clock conversion (no libraries) ----------------
type Parts = { y: number; mo: number; d: number; h: number; mi: number; dow: number };
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", weekday: "short" }); fmtCache.set(tz, f); }
  return f;
}
export function partsInTz(ms: number, tz: string): Parts {
  const o: Record<string, string> = {};
  for (const p of fmt(tz).formatToParts(new Date(ms))) o[p.type] = p.value;
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(o.weekday);
  return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, dow };
}
export function offsetMs(ms: number, tz: string): number {
  const p = partsInTz(ms, tz);
  const s = Math.floor(ms / 1000) % 60; // seconds are the same in every zone we support
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, s) - Math.floor(ms / 1000) * 1000;
}
/** Local wall-clock time -> UTC milliseconds. Fall-back ambiguity picks the first (earlier) occurrence; a time skipped by spring-forward moves to the next valid minute. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offs = [...new Set([offsetMs(guess - 24 * HOUR, tz), offsetMs(guess + 24 * HOUR, tz)])];
  const hits = offs.map((o) => guess - o).filter((cand) => { const p = partsInTz(cand, tz); return p.y === y && p.mo === mo && p.d === d && p.h === h && p.mi === mi; }).sort((a, b) => a - b);
  if (hits.length) return hits[0];
  return guess - Math.min(...offs); // inside the skipped hour: land after the gap
}
export function formatLocal(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(ms));
}

// ---------------- scheduled publication times ----------------
export type Planned = { label: string; publishAt: number };
/** Next `count` scheduled publication instants strictly after `after`. */
export function upcoming(cfg: CycleConfig, after: number, count = 4): Planned[] {
  const out: Planned[] = [];
  const t0 = partsInTz(after, cfg.timezone);
  for (let k = -1; k <= 14 && out.length < 200; k++) {
    const base = Date.UTC(t0.y, t0.mo - 1, t0.d + k, 12); // noon avoids any day-boundary edge when stepping calendar days
    const p = partsInTz(base, cfg.timezone);
    for (const s of cfg.slots) {
      if (s.days && !s.days.includes(new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay())) continue;
      const [h, m] = s.time.split(":").map(Number);
      const at = zonedToUtc(p.y, p.mo, p.d, h, m, cfg.timezone);
      if (at > after) out.push({ label: s.label, publishAt: at });
    }
  }
  return out.sort((a, b) => a.publishAt - b.publishAt).slice(0, count);
}

// ---------------- timeline: work backward from the publication time ----------------
export type Timeline = {
  publishAt: number; finalReviewStart: number; productionStart: number; promptStart: number;
  selectionStart: number; selectionDeadline: number; researchCutoff: number; researchDeadline: number;
};
/** researchCutoff = the moment news stops being included (coverage end). Research, verification and assessment then run for discoveryVerifyMin. */
export function timeline(publishAt: number, a: Allowances): Timeline {
  const finalReviewStart = publishAt - a.finalReviewMin * MIN;
  const productionStart = finalReviewStart - a.productionMin * MIN;
  const promptStart = productionStart - a.promptMin * MIN;
  const selectionStart = promptStart - a.selectionMin * MIN;
  const researchCutoff = selectionStart - a.discoveryVerifyMin * MIN;
  return { publishAt, finalReviewStart, productionStart, promptStart, selectionStart, selectionDeadline: promptStart, researchCutoff, researchDeadline: selectionStart };
}

// ---------------- coverage windows ----------------
export type Window = { start: number; end: number };
export type WindowMode = "continuous" | "rolling" | "custom";
export const MAX_WINDOW_HOURS = 24 * 14;
export function continuousWindow(cutoff: number, previousEnd: number | null, cfg: CycleConfig): { ok: true; window: Window; firstEdition: boolean } | { ok: false; error: string } {
  if (previousEnd !== null && previousEnd >= cutoff) return { ok: false, error: `The previous edition already covers news up to ${formatLocal(previousEnd, cfg.timezone)}, which is at or after this edition's research cutoff (${formatLocal(cutoff, cfg.timezone)}). Choose a later publication time.` };
  const start = previousEnd ?? cutoff - cfg.coverageHours * HOUR;
  if (cutoff - start > MAX_WINDOW_HOURS * HOUR) return { ok: false, error: `That window would cover more than ${MAX_WINDOW_HOURS / 24} days. Mark the missed editions as skipped, or use a custom window.` };
  return { ok: true, window: { start, end: cutoff }, firstEdition: previousEnd === null };
}
export function rollingWindow(hours: number, end: number): { ok: true; window: Window } | { ok: false; error: string } {
  if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_WINDOW_HOURS) return { ok: false, error: `Hours must be between 1 and ${MAX_WINDOW_HOURS}.` };
  return { ok: true, window: { start: end - hours * HOUR, end } };
}
export function customWindow(from: number, to: number): { ok: true; window: Window } | { ok: false; error: string } {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return { ok: false, error: "Both a start and an end time are needed." };
  if (from >= to) return { ok: false, error: "The start must be before the end." };
  if (to - from > MAX_WINDOW_HOURS * HOUR) return { ok: false, error: `A window can span at most ${MAX_WINDOW_HOURS / 24} days.` };
  return { ok: true, window: { start: from, end: to } };
}
export const inWindow = (t: number, w: Window) => t >= w.start && t < w.end;
export const overlaps = (a: Window, b: Window) => a.start < b.end && b.start < a.end;
export const overlapMinutes = (a: Window, b: Window) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start)) / MIN;

export type CycleRow = { id: string; label: string; status: "open" | "published" | "skipped"; coverageStart: number; coverageEnd: number; publishAt: number };
/** The end of the last PUBLISHED edition's coverage. Skipped or unfinished editions never advance it, so a missed edition leaves no gap. */
export function previousCoverageEnd(rows: CycleRow[]): { end: number | null; cycle: CycleRow | null } {
  const pub = rows.filter((r) => r.status === "published").sort((a, b) => b.coverageEnd - a.coverageEnd)[0] ?? null;
  return { end: pub ? pub.coverageEnd : null, cycle: pub };
}
export function windowOverlaps(w: Window, rows: CycleRow[], ignoreId?: string) {
  return rows.filter((r) => r.id !== ignoreId && r.status !== "skipped" && overlaps(w, { start: r.coverageStart, end: r.coverageEnd })).map((r) => ({ id: r.id, label: r.label, minutes: Math.round(overlapMinutes(w, { start: r.coverageStart, end: r.coverageEnd })) }));
}

// ---------------- story classification (new / update / renewed / held over / already published / never verified) ----------------
export type Mark = "published" | "held_over" | "rejected";
export type HistoryEntry = { cycleId: string; cycleLabel: string; mark: Mark; coverageEnd: number; at: number };
export type StoryTimes = { id: string; times: number[]; hasDecision: boolean; decision: string | null };
export type Cls = "NEW" | "UPDATE" | "RENEWED" | "HELD_OVER" | "ALREADY_PUBLISHED" | "NEVER_VERIFIED" | "REJECTED_EARLIER" | "REJECTED";
export type Classified = { id: string; cls: Cls; candidate: boolean; reason: string };

export function classify(s: StoryTimes, w: Window, history: HistoryEntry[], tz: string, now: number): Classified | null {
  const fmtT = (t: number) => formatLocal(t, tz);
  const first = s.times.length ? Math.min(...s.times) : null;
  const reported = s.times.filter((t) => inWindow(t, w));
  const hist = [...history].sort((a, b) => b.at - a.at);
  const lastPub = hist.find((h) => h.mark === "published");
  const lastHeld = hist.find((h) => h.mark === "held_over");
  const lastRej = hist.find((h) => h.mark === "rejected");
  if (s.decision === "rejected") return reported.length || lastRej || hist.length ? { id: s.id, cls: "REJECTED", candidate: false, reason: "You rejected this story earlier." } : null;
  if (lastPub) {
    const newer = s.times.filter((t) => t >= lastPub.coverageEnd);
    if (newer.length && reported.length) return { id: s.id, cls: "UPDATE", candidate: true, reason: `Published in "${lastPub.cycleLabel}"; ${newer.length} newer report${newer.length > 1 ? "s" : ""} since that edition's cutoff (${fmtT(lastPub.coverageEnd)}). Include only if there is a meaningful new development.` };
    if (reported.length || hist[0]) return { id: s.id, cls: "ALREADY_PUBLISHED", candidate: false, reason: `Already published in "${lastPub.cycleLabel}"; no new reporting since its cutoff (${fmtT(lastPub.coverageEnd)}).` };
    return null;
  }
  if (lastHeld && hist[0] === lastHeld) return { id: s.id, cls: "HELD_OVER", candidate: true, reason: `Held over from "${lastHeld.cycleLabel}"${first !== null ? `; first reported ${fmtT(first)}` : ""}${reported.length ? `, with ${reported.length} report${reported.length > 1 ? "s" : ""} inside this window` : ", no new reporting in this window"}.` };
  if (lastRej && hist[0] === lastRej) return reported.length ? { id: s.id, cls: "REJECTED_EARLIER", candidate: false, reason: `Left out of "${lastRej.cycleLabel}" by you. Not suggested again unless you select it.` } : null;
  if (!reported.length) {
    // discovered earlier, never reviewed, never in an edition: surface it so it is not silently lost (last 7 days)
    if (!s.hasDecision && first !== null && first < w.start && now - first <= 7 * 24 * HOUR) return { id: s.id, cls: "NEVER_VERIFIED", candidate: false, reason: `Discovered ${fmtT(first)}, never reviewed and never in an edition.` };
    return null;
  }
  if (first !== null && first >= w.start) return { id: s.id, cls: "NEW", candidate: true, reason: `First reported ${fmtT(first)}, inside this window; not covered before.` };
  return { id: s.id, cls: "RENEWED", candidate: true, reason: `First reported ${first !== null ? fmtT(first) : "earlier"} (before this window) and never published; ${reported.length} new report${reported.length > 1 ? "s" : ""} inside this window.` };
}

/** Reported after the research cutoff but before publication/now: a late-breaking CANDIDATE. It never joins an approved edition by itself. */
export function isLateBreaking(times: number[], cutoff: number, upTo: number) { return times.some((t) => t >= cutoff && t <= upTo); }

// ---------------- stage and deadline status (explainable arithmetic, not a prediction) ----------------
export type Stage = "research" | "selection" | "prompt" | "production" | "review" | "ready";
export const STAGES: Stage[] = ["research", "selection", "prompt", "production", "review", "ready"];
export type Progress = { researchDone: boolean; editionApproved: boolean; promptMade: boolean; productionDone: boolean; reviewDone: boolean; hasEdition: boolean };
export function deriveStage(p: Progress): Stage {
  if (p.reviewDone && p.productionDone) return "ready";
  if (p.productionDone) return "review";
  if (p.promptMade && p.editionApproved) return "production";
  if (p.editionApproved) return "prompt";
  if (p.hasEdition || p.researchDone) return "selection";
  return "research";
}
export function remainingMinutes(stage: Stage, a: Allowances): number {
  const order: [Stage, number][] = [["research", a.discoveryVerifyMin], ["selection", a.selectionMin], ["prompt", a.promptMin], ["production", a.productionMin], ["review", a.finalReviewMin]];
  const i = order.findIndex(([s]) => s === stage);
  return i < 0 ? 0 : order.slice(i).reduce((x, [, m]) => x + m, 0);
}
export type Status = "ON SCHEDULE" | "AT RISK" | "BEHIND SCHEDULE";
export type Readiness = "READY FOR PRODUCTION" | "READY FOR FINAL REVIEW" | "READY TO PUBLISH" | null;
export type Standing = { status: Status; readiness: Readiness; stage: Stage; slackMin: number; remainingWorkMin: number; minutesToPublish: number; explanation: string; suggestedPublishAt: number | null; actions: string[] };

export function standing(args: { now: number; tl: Timeline; stage: Stage; a: Allowances; bufferMin: number; tz: string; candidates?: { corroborated: number; approved: number } }): Standing {
  const { now, tl, stage, a, bufferMin, tz } = args;
  const remaining = remainingMinutes(stage, a);
  const start = stage === "research" ? Math.max(now, tl.researchCutoff) : now; // research cannot begin before the cutoff: the news must exist first
  const slack = Math.round((tl.publishAt - (start + remaining * MIN)) / MIN);
  const toPub = Math.round((tl.publishAt - now) / MIN);
  const status: Status = stage === "ready" ? "ON SCHEDULE" : slack < -bufferMin ? "BEHIND SCHEDULE" : slack < 0 ? "AT RISK" : "ON SCHEDULE";
  const readiness: Readiness = stage === "production" ? "READY FOR PRODUCTION" : stage === "review" ? "READY FOR FINAL REVIEW" : stage === "ready" ? "READY TO PUBLISH" : null;
  const hm = (m: number) => `${Math.floor(Math.abs(m) / 60)}h ${Math.abs(m) % 60}m`;
  const explanation = stage === "ready"
    ? `All stages are done. ${toPub >= 0 ? `${hm(toPub)} before the planned publication time.` : `The planned time passed ${hm(toPub)} ago; publish when you are ready.`}`
    : `Work still ahead: ${hm(remaining)} (${remaining} min, from your configured allowances). ${stage === "research" && now < tl.researchCutoff ? `Research starts at the cutoff, ${hm(Math.round((tl.researchCutoff - now) / MIN))} from now. ` : ""}${toPub >= 0 ? `Time to publication: ${hm(toPub)}.` : `Publication time passed ${hm(toPub)} ago.`} Slack = ${slack >= 0 ? "" : "-"}${hm(slack)}; ${status === "ON SCHEDULE" ? "the remaining work fits before the planned time" : status === "AT RISK" ? `the work runs over by up to your ${bufferMin}-minute tolerance, so only a tighter final review would save the time` : `the work runs over by more than your ${bufferMin}-minute tolerance`}.`;
  let suggested: number | null = null;
  const actions: string[] = [];
  if (status !== "ON SCHEDULE" && stage !== "ready") {
    const need = start + remaining * MIN;
    suggested = Math.ceil(need / (15 * MIN)) * 15 * MIN;
    actions.push(`Move publication to ${formatLocal(suggested, tz)}: the earliest 15-minute mark that fits all remaining work at your configured allowances.`);
    if (stage === "research" || stage === "selection") actions.push("Reduce the number of developments. A shorter edition shortens selection, coherence review and production.");
    if (stage === "research" || stage === "selection") actions.push(`Prioritise the strongest verified developments${args.candidates ? ` (${args.candidates.corroborated} corroborated, ${args.candidates.approved} you already approved among the candidates)` : ""} and leave the rest for the next edition.`);
    if (stage === "research") actions.push("Use already researched and verified developments (stories you have already approved) instead of researching more.");
    actions.push("Evidence standards are not lowered to meet a deadline. If the work cannot be done properly in time, publish later or hold stories over.");
  }
  return { status, readiness, stage, slackMin: slack, remainingWorkMin: remaining, minutesToPublish: toPub, explanation, suggestedPublishAt: suggested, actions };
}

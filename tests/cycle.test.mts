// News cycle planner: time boundaries, timezones/DST, overlapping windows, missed editions, duplicates, late-breaking, deadline status.
import * as C from "../netlify/lib/cycle.mts";

let pass = 0, fail = 0;
const check = (n: string, v: boolean) => { console.log((v ? "PASS " : "FAIL ") + n); v ? pass++ : fail++; };
const H = 3_600_000, M = 60_000;
const U = (s: string) => Date.parse(s);
const cfg = C.DEFAULT_CONFIG;

// ---- config validation ----
check("default config validates", C.validateConfig(cfg).ok);
const bad = (patch: any) => !C.validateConfig({ ...cfg, ...patch }).ok;
check("bad timezone rejected", bad({ timezone: "Mars/Olympus" }));
check("empty slots rejected", bad({ slots: [] }));
check("bad time rejected", bad({ slots: [{ label: "x", time: "25:00" }] }));
check("duplicate slot names rejected", bad({ slots: [{ label: "A", time: "06:00" }, { label: "a", time: "07:00" }] }));
check("bad days rejected", bad({ slots: [{ label: "A", time: "06:00", days: [7] }] }));
check("non-integer allowance rejected", bad({ allowances: { ...cfg.allowances, productionMin: 12.5 } }));
check("negative allowance rejected", bad({ allowances: { ...cfg.allowances, selectionMin: -1 } }));
check("coverage 0 rejected", bad({ coverageHours: 0 }));
check("garbage config rejected without throwing", !C.validateConfig(null).ok && !C.validateConfig("x").ok);

// ---- timezone ----
// 2026-11-01 is the US fall-back date; 2026-03-08 spring-forward.
check("NY winter 06:00 = 11:00Z", C.zonedToUtc(2026, 1, 15, 6, 0, "America/New_York") === U("2026-01-15T11:00:00Z"));
check("NY summer 06:00 = 10:00Z", C.zonedToUtc(2026, 7, 15, 6, 0, "America/New_York") === U("2026-07-15T10:00:00Z"));
check("fall-back day 06:00 is standard time (11:00Z)", C.zonedToUtc(2026, 11, 1, 6, 0, "America/New_York") === U("2026-11-01T11:00:00Z"));
check("fall-back ambiguous 01:30 picks the first occurrence (05:30Z)", C.zonedToUtc(2026, 11, 1, 1, 30, "America/New_York") === U("2026-11-01T05:30:00Z"));
check("spring-forward skipped 02:30 lands after the gap", C.zonedToUtc(2026, 3, 8, 2, 30, "America/New_York") === U("2026-03-08T07:30:00Z"));
check("Tokyo has no DST (06:00 = 21:00Z previous day)", C.zonedToUtc(2026, 7, 1, 6, 0, "Asia/Tokyo") === U("2026-06-30T21:00:00Z"));
check("half-hour zone (Kolkata 06:00 = 00:30Z)", C.zonedToUtc(2026, 5, 1, 6, 0, "Asia/Kolkata") === U("2026-05-01T00:30:00Z"));
check("partsInTz round trip", (() => { const p = C.partsInTz(U("2026-11-01T11:00:00Z"), "America/New_York"); return p.h === 6 && p.d === 1 && p.mo === 11; })());

// ---- upcoming publication times ----
const up = C.upcoming(cfg, U("2026-10-31T23:00:00Z"), 4); // 19:00 NY on Oct 31 (EDT)
check("upcoming: next is the morning edition", up[0].label === "Morning edition");
check("upcoming: Nov 1 06:00 NY (fall-back day) = 11:00Z", up[0].publishAt === U("2026-11-01T11:00:00Z"));
check("upcoming: evening Nov 1 18:00 NY = 23:00Z (standard time)", up[1].publishAt === U("2026-11-01T23:00:00Z"));
check("upcoming: strictly increasing, 4 items", up.length === 4 && up.every((x, i) => i === 0 || x.publishAt > up[i - 1].publishAt));
check("upcoming excludes a time equal to 'after'", C.upcoming(cfg, U("2026-11-01T11:00:00Z"), 1)[0].publishAt === U("2026-11-01T23:00:00Z"));
const wk = { ...cfg, slots: [{ label: "Weekday", time: "06:00", days: [1, 2, 3, 4, 5] }] };
check("weekday-only slot skips the weekend", C.upcoming(wk, U("2026-10-30T20:00:00Z"), 1)[0].publishAt === U("2026-11-02T11:00:00Z")); // Fri evening -> Mon

// ---- timeline ----
const P = U("2026-11-02T11:00:00Z");
const tl = C.timeline(P, cfg.allowances);
check("timeline: final review starts 45m before publish", tl.finalReviewStart === P - 45 * M);
check("timeline: production starts 120m before review", tl.productionStart === tl.finalReviewStart - 120 * M);
check("timeline: prompt, selection, research cutoff in order", tl.promptStart < tl.productionStart && tl.selectionStart < tl.promptStart && tl.researchCutoff < tl.selectionStart);
check("timeline: total lead = sum of allowances (315m)", P - tl.researchCutoff === 315 * M);
check("timeline: selection deadline = prompt start", tl.selectionDeadline === tl.promptStart);

// ---- windows: boundaries (half-open) ----
const w = { start: U("2026-11-02T00:00:00Z"), end: U("2026-11-02T12:00:00Z") };
check("boundary: start is inside", C.inWindow(w.start, w));
check("boundary: end is outside", !C.inWindow(w.end, w));
check("boundary: one ms before end is inside", C.inWindow(w.end - 1, w));
check("boundary: one ms before start is outside", !C.inWindow(w.start - 1, w));
const w2 = { start: w.end, end: w.end + 12 * H };
check("adjacent windows do not overlap", !C.overlaps(w, w2));
check("an item at the shared boundary is in exactly one window", [w, w2].filter((x) => C.inWindow(w.end, x)).length === 1);
check("overlapping windows detected", C.overlaps(w, { start: w.end - H, end: w.end + H }) && C.overlapMinutes(w, { start: w.end - H, end: w.end + H }) === 60);

// ---- continuous / rolling / custom ----
const cont = C.continuousWindow(U("2026-11-02T05:45:00Z"), U("2026-11-01T17:45:00Z"), cfg);
check("continuous: starts at the previous coverage end", cont.ok && cont.window.start === U("2026-11-01T17:45:00Z") && cont.window.end === U("2026-11-02T05:45:00Z") && !cont.firstEdition);
const first = C.continuousWindow(U("2026-11-02T05:45:00Z"), null, cfg);
check("continuous: first edition uses default coverage hours", first.ok && first.firstEdition && first.window.end - first.window.start === 12 * H);
check("continuous: previous end at/after cutoff is refused", !C.continuousWindow(U("2026-11-02T05:45:00Z"), U("2026-11-02T05:45:00Z"), cfg).ok);
check("continuous: absurdly long gap is refused", !C.continuousWindow(U("2026-11-30T00:00:00Z"), U("2026-11-01T00:00:00Z"), cfg).ok);
check("rolling 6/12/24h", [6, 12, 24].every((h) => { const r = C.rollingWindow(h, P); return r.ok && r.window.end - r.window.start === h * H; }));
check("rolling: 0 and negative refused", !C.rollingWindow(0, P).ok && !C.rollingWindow(-3, P).ok);
check("custom: valid range", C.customWindow(U("2026-11-01T00:00:00Z"), U("2026-11-02T00:00:00Z")).ok);
check("custom: reversed, equal and NaN refused", !C.customWindow(P, P - H).ok && !C.customWindow(P, P).ok && !C.customWindow(NaN, P).ok);
check("custom: more than 14 days refused", !C.customWindow(P - 15 * 24 * H, P).ok);

// ---- missed editions & previous coverage ----
const rows: C.CycleRow[] = [
  { id: "a", label: "Mon AM", status: "published", coverageStart: U("2026-10-31T17:45:00Z"), coverageEnd: U("2026-11-01T05:45:00Z"), publishAt: U("2026-11-01T11:00:00Z") },
  { id: "b", label: "Mon PM", status: "skipped", coverageStart: U("2026-11-01T05:45:00Z"), coverageEnd: U("2026-11-01T17:45:00Z"), publishAt: U("2026-11-01T23:00:00Z") },
  { id: "c", label: "Tue AM", status: "open", coverageStart: U("2026-11-01T05:45:00Z"), coverageEnd: U("2026-11-02T05:45:00Z"), publishAt: U("2026-11-02T11:00:00Z") },
];
const prev = C.previousCoverageEnd(rows);
check("missed edition: previous end is the last PUBLISHED cycle, not the skipped one", prev.end === rows[0].coverageEnd && prev.cycle?.id === "a");
const afterSkip = C.continuousWindow(U("2026-11-02T05:45:00Z"), prev.end, cfg);
check("missed edition: next window folds the skipped period in (no gap)", afterSkip.ok && afterSkip.window.start === rows[0].coverageEnd && afterSkip.window.end - afterSkip.window.start === 24 * H);
check("no published cycle: previous end is null", C.previousCoverageEnd([rows[2]]).end === null);
check("overlap check ignores skipped cycles and the cycle itself", C.windowOverlaps({ start: rows[1].coverageStart, end: rows[1].coverageEnd }, rows, "c").length === 0);
check("overlap check flags an open overlapping cycle", C.windowOverlaps({ start: U("2026-11-01T10:00:00Z"), end: U("2026-11-01T20:00:00Z") }, rows).some((o) => o.id === "c"));

// ---- classification ----
const W = { start: U("2026-11-02T00:00:00Z"), end: U("2026-11-02T12:00:00Z") };
const NOW = U("2026-11-02T13:00:00Z");
const st = (id: string, times: string[], decision: string | null = null, hasDecision = decision !== null) => ({ id, times: times.map(U), hasDecision, decision });
const cl = (s: any, hist: C.HistoryEntry[] = []) => C.classify(s, W, hist, "UTC", NOW);
const pubHist: C.HistoryEntry = { cycleId: "p1", cycleLabel: "Sun PM", mark: "published", coverageEnd: U("2026-11-01T18:00:00Z"), at: U("2026-11-01T23:00:00Z") };
check("NEW: first reported inside the window", cl(st("n", ["2026-11-02T03:00:00Z"]))?.cls === "NEW");
check("NEW is a candidate and has a reason", cl(st("n", ["2026-11-02T03:00:00Z"]))?.candidate === true && (cl(st("n", ["2026-11-02T03:00:00Z"]))?.reason.length ?? 0) > 10);
check("RENEWED: first reported before the window, new reports inside", cl(st("r", ["2026-10-20T00:00:00Z", "2026-11-02T04:00:00Z"]))?.cls === "RENEWED");
check("UPDATE: published before, newer reporting inside the window", cl(st("u", ["2026-11-01T10:00:00Z", "2026-11-02T04:00:00Z"]), [pubHist])?.cls === "UPDATE");
check("UPDATE stays a candidate but asks for a meaningful new development", (() => { const c = cl(st("u", ["2026-11-01T10:00:00Z", "2026-11-02T04:00:00Z"]), [pubHist]); return c?.candidate === true && /new development/i.test(c.reason); })());
check("ALREADY_PUBLISHED: no reporting after the earlier edition's cutoff", cl(st("d", ["2026-11-01T10:00:00Z"]), [pubHist]) === null || cl(st("d", ["2026-11-01T10:00:00Z"]), [pubHist])?.candidate === false);
check("a repeat is not suppressed merely for appearing before: it is shown with a reason", (() => { const c = cl(st("u", ["2026-11-01T10:00:00Z", "2026-11-02T04:00:00Z"]), [pubHist]); return !!c && c.reason.includes("Sun PM"); })());
const heldHist: C.HistoryEntry = { cycleId: "h1", cycleLabel: "Sun PM", mark: "held_over", coverageEnd: U("2026-11-01T18:00:00Z"), at: U("2026-11-01T23:00:00Z") };
check("HELD_OVER: marked held over last time", cl(st("h", ["2026-11-01T10:00:00Z"]), [heldHist])?.cls === "HELD_OVER" && cl(st("h", ["2026-11-01T10:00:00Z"]), [heldHist])?.candidate === true);
const rejHist: C.HistoryEntry = { ...heldHist, mark: "rejected" };
check("REJECTED_EARLIER is not a candidate", (() => { const c = cl(st("x", ["2026-11-02T01:00:00Z"]), [rejHist]); return c?.cls === "REJECTED_EARLIER" && !c.candidate; })());
check("currently rejected story is never a candidate", cl(st("x", ["2026-11-02T01:00:00Z"], "rejected"))?.candidate === false);
check("NEVER_VERIFIED: discovered earlier, no decision, never published", cl(st("v", ["2026-10-30T10:00:00Z"]))?.cls === "NEVER_VERIFIED");
check("NEVER_VERIFIED is not a candidate and expires after 7 days", cl(st("v", ["2026-10-30T10:00:00Z"]))?.candidate === false && cl(st("v", ["2026-10-01T10:00:00Z"])) === null);
check("a story with no reports and no history is ignored", cl(st("z", [])) === null);
check("story reported exactly at window end is outside it", cl(st("e", ["2026-11-02T12:00:00Z"])) === null || cl(st("e", ["2026-11-02T12:00:00Z"]))?.cls !== "NEW");
check("story reported exactly at window start is NEW", cl(st("s", ["2026-11-02T00:00:00Z"]))?.cls === "NEW");

// ---- late-breaking ----
const cutoff = U("2026-11-02T05:45:00Z");
check("late-breaking: reported after the cutoff", C.isLateBreaking([U("2026-11-02T06:10:00Z")], cutoff, NOW));
check("late-breaking: exactly at the cutoff counts as late", C.isLateBreaking([cutoff], cutoff, NOW));
check("not late-breaking: before the cutoff", !C.isLateBreaking([U("2026-11-02T05:44:59Z")], cutoff, NOW));
check("not late-breaking: in the future relative to now", !C.isLateBreaking([NOW + H], cutoff, NOW));

// ---- stage and deadline status ----
const pr = (o: Partial<C.Progress> = {}): C.Progress => ({ researchDone: false, editionApproved: false, promptMade: false, productionDone: false, reviewDone: false, hasEdition: false, ...o });
check("stage: nothing done = research", C.deriveStage(pr()) === "research");
check("stage: edition saved = selection", C.deriveStage(pr({ hasEdition: true })) === "selection");
check("stage: approved = prompt", C.deriveStage(pr({ hasEdition: true, editionApproved: true })) === "prompt");
check("stage: approved + prompt = production", C.deriveStage(pr({ hasEdition: true, editionApproved: true, promptMade: true })) === "production");
check("stage: production done = review", C.deriveStage(pr({ hasEdition: true, editionApproved: true, promptMade: true, productionDone: true })) === "review");
check("stage: all done = ready", C.deriveStage(pr({ hasEdition: true, editionApproved: true, promptMade: true, productionDone: true, reviewDone: true })) === "ready");
check("stage: a prompt without an approved edition does not advance", C.deriveStage(pr({ hasEdition: true, promptMade: true })) === "selection");
check("remaining minutes: research = 315, production = 165, ready = 0", C.remainingMinutes("research", cfg.allowances) === 315 && C.remainingMinutes("production", cfg.allowances) === 165 && C.remainingMinutes("ready", cfg.allowances) === 0);
const S = (now: number, stage: C.Stage) => C.standing({ now, tl, stage, a: cfg.allowances, bufferMin: 30, tz: "UTC" });
check("before cutoff: research cannot start early; zero slack = ON SCHEDULE", S(tl.researchCutoff - 2 * H, "research").slackMin === 0 && S(tl.researchCutoff - 2 * H, "research").status === "ON SCHEDULE");
check("research 20m late (within tolerance) is AT RISK, slack -20", S(tl.researchCutoff + 20 * M, "research").status === "AT RISK" && S(tl.researchCutoff + 20 * M, "research").slackMin === -20);
check("research 31m late (beyond tolerance) is BEHIND SCHEDULE", S(tl.researchCutoff + 31 * M, "research").status === "BEHIND SCHEDULE");
check("boundary: exactly -30 is AT RISK, -31 is BEHIND", S(tl.productionStart + 30 * M, "production").status === "AT RISK" && S(tl.productionStart + 31 * M, "production").status === "BEHIND SCHEDULE");
check("production on time: ON SCHEDULE", S(tl.productionStart - 60 * M, "production").status === "ON SCHEDULE");
check("zero slack exactly is ON SCHEDULE; one minute over is AT RISK", S(tl.productionStart, "production").status === "ON SCHEDULE" && S(tl.productionStart + 1 * M, "production").status === "AT RISK");
check("readiness labels", S(tl.productionStart, "production").readiness === "READY FOR PRODUCTION" && S(tl.finalReviewStart, "review").readiness === "READY FOR FINAL REVIEW" && S(tl.finalReviewStart, "ready").readiness === "READY TO PUBLISH" && S(tl.researchCutoff, "research").readiness === null);
check("ready stage is never behind schedule even after the planned time", S(P + H, "ready").status === "ON SCHEDULE");
const late = S(tl.researchCutoff + 45 * M, "research");
check("behind: suggests a later publish time, rounded to 15 minutes, that restores the buffer", late.suggestedPublishAt !== null && late.suggestedPublishAt % (15 * M) === 0 && late.suggestedPublishAt >= tl.researchCutoff + 45 * M + 315 * M);
check("behind: recommends fewer developments, strongest verified, reuse researched", late.actions.some((x) => /fewer|Reduce the number/i.test(x)) && late.actions.some((x) => /strongest verified/i.test(x)) && late.actions.some((x) => /already researched/i.test(x)));
check("behind: states that evidence standards are not lowered", late.actions.some((x) => /Evidence standards are not lowered/.test(x)));
check("on schedule: no recommendations", (() => { const x = S(tl.productionStart - 60 * M, "production"); return x.status === "ON SCHEDULE" && x.actions.length === 0 && x.suggestedPublishAt === null; })());
check("explanation is human-readable arithmetic", /Work still ahead/.test(late.explanation) && /Slack/.test(late.explanation));
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

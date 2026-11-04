# News Cycle and Publishing Planner

Separate from the Edition Desk (which chooses and approves developments). The Planner decides which news an edition covers and tracks whether the work will be done in time. It never researches, produces or publishes anything.

## Coverage versus production time
- **Coverage window** = which events are included. Half-open: includes the start, excludes the end. News reported exactly at the cutoff belongs to the next edition.
- **Production allowances** (editable, in minutes): research and verification, selection and coherence review, prompt, production in Claude, final review buffer.
- The **research cutoff** is worked out backward from the planned publication time: cutoff = publication minus all five allowances. With the defaults that is 315 minutes.

## Coverage modes
- **Continuous**: starts where the last PUBLISHED edition's coverage ended. A skipped or missed edition never advances it, so its period folds into the next edition (no gap). First edition: default coverage hours.
- **Rolling**: the last 6, 12, 24 or 48 hours.
- **Custom**: any start and end (up to 14 days). Overlap with an earlier edition's coverage needs your explicit confirmation.

## Story labels (each with a reason)
New development, Update to a published story, Older story renewed, Held over, Already published, Discovered but never verified, Left out earlier, Rejected. A story is never hidden just because it appeared before; the reason is shown. Report times use the publish date, or the retrieval time when the feed gave none (stated on screen).

## Deadline status (arithmetic, not prediction)
Slack = planned publication minus (now, or the cutoff if research cannot start yet, plus the remaining allowances).
ON SCHEDULE: slack is 0 or more. AT RISK: behind by up to your tolerance. BEHIND SCHEDULE: behind by more. Readiness labels: READY FOR PRODUCTION (approved edition + current prompt), READY FOR FINAL REVIEW (production marked done), READY TO PUBLISH (review marked done). When short of time the Planner offers: move publication (computed), fewer developments, strongest verified first, reuse already researched stories. It never lowers evidence standards.

## Late-breaking
Stories reported after the cutoff are listed as late-breaking candidates. They never change an approved edition. Add one in the Edition Desk (which requires approving again) or hold it over.

## Data
- Schedule: existing `system_settings` row `edition_schedule` (no new table).
- Migration 005 adds `edition_cycles` and `cycle_stories` (additive; draft until you run it). One open cycle at a time; closed cycles are locked; publishing needs a current approval; marks are append-only.
- Tests: `tests/cycle.test.mts` (time logic), `tests/cycles-api.test.mts` (API), `tests/db/migration005.test.mjs` (real Postgres, run separately).

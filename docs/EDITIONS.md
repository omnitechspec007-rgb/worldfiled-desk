# Edition Desk (local, not yet deployed)

Primary workflow: research → developments → curiosity assessment → suggested editions → coherence check → human approval → ONE integrated Claude production prompt. The single-story Prompt Architect remains as a secondary workflow.

## Rules (all fixed, visible, rule-based; no AI, no cost)
- **Curiosity** is an editorial hypothesis, kept separate from evidence strength. Weakly evidenced dramatic stories never rank high. Six recommendations: HIGH-POTENTIAL STORY, STRONG EDITION CANDIDATE, INTERESTING BUT NEEDS MORE EVIDENCE, LOW EDITORIAL CURIOSITY, RELEVANT BUT NOT TIMELY, HOLD FOR FUTURE DEVELOPMENTS.
- **Coherence** (0-100, 7 shown components): theme 25, shared catalyst 15, geography 15, chronology 10, complementary roles 10, contrast 10, narrative 15. Caps: no shared theme/catalyst ≤39; weak link coverage ≤55; duplicate reporting ≤45. Verdicts: COHERENT ≥60, WEAK 40-59, INCOHERENT <40. Keyword overlap alone is not a connection.
- **Structures**: multi-country synthesis, single-country deep dive, event-driven roundup (needs a named event/catalyst). The editor can override; the override is recorded.
- Nothing is silently removed from a selection; weak members are flagged and the editor removes them.
- Places come from a built-in gazetteer of approximate country centres, labelled "mentioned in the retrieved text" or "publisher location only". Not event locations.

## Data (migration 004, NOT RUN)
`editions`, `edition_developments`, `edition_decisions` (append-only, members hash stamped by the database), `edition_prompts` (immutable, versions 1-50). The database refuses a prompt unless the newest edition decision is "approved" on the CURRENT member list and no member story is rejected or sent back. RLS on, no browser access.

## Prompt validity
Saved prompts are never deleted. A prompt is withheld (kept as history) if the approval is no longer current, the members or order changed, a member was rejected/sent back, or the retrieved evidence changed (evidence hash).

## Honest limits
Headlines and feed snippets only; no full text, no claim extraction, no automatic conflict detection (editor notes only); independence judged by outlet name and wording similarity; connections are inferred, not verified.

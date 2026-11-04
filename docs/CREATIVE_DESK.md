# Creative Desk upgrade (presenter, voice, blueprint)

Status: IMPLEMENTED and unit/API-tested. NOT committed, pushed or deployed.
No database migration is required: settings use the existing `system_settings`
table (keys `creative_desk`, `pronunciation_lexicon`); prompt history uses the
existing `edition_prompts.rationale`.

## What the app does
It builds better PROMPTS that you paste into Claude. It generates no audio,
video or voice and publishes nothing.

- Presenter identity (recurring, upbeat, clear, credible) is stored apart from the voice configuration.
- Voice config: engine, voice, model, style, pace, pronunciation handling, status, licence, last tested, human approval. Changing the engine voids approval. Laomedeia is a REFERENCE PROFILE only; nothing is marked tested, approved or cleared without your evidence.
- Eight delivery profiles with editable pace targets (words/second).
- Narration rules (news first, short sentences, one attribution, spelled numbers) with a clean transcript separate from the delivery sheet.
- Evidence ladder: evidence strength limits creative treatment; on-screen chips; spoken qualifications only where needed.
- Programme formats: Global Roundup, Connected Edition, Focused Briefing (you can override).
- Adaptive visual treatments, no repeated layouts, no invented imagery or maps.
- Sound plan with licence evidence required.
- Production capability registry (NATIVE / FREE TOOL / MANUAL / UNVERIFIED / PAID); none tested.
- 18-field scene blueprint; pronunciation lexicon with a PRONUNCIATION CHECK REQUIRED section.

## Where
- Page `/creative` ("Presenter and Voice"); Edition Desk shows the programme format, runtime and scene plan before you build.
- API `creative-config` (GET; POST save-voice, approve-voice, save-tools, save-lexicon).
- Library `netlify/lib/presenter.mts`, `netlify/lib/blueprint.mts`.

## Limits
Delivery pace targets are unverified against real engine output; narration is written by Claude (a pure `checkNarration` exists but has no UI yet); name detection and visual categories are heuristic; the map locator is approximate; runtime caps are heuristic.

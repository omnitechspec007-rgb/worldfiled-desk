# WorldFiled Desk — Editorial workflow UX principles

Status: implementation guide for the feature branch.
Prepared: 7 November 2026

## Reference products and what we borrow

This is not a proposal to replace the current application with a CMS.

- Payload CMS Versions/Drafts: preserve draft work separately from published state; show Draft, Published and Changed states clearly; allow preview and restoration; never conflate saving a draft with publishing it.
- Directus Content Versioning: make the published version read-only, require an explicit edit-to-draft transition, and present a comparison before publishing. This is a strong model for safe editorial changes.
- Stripe/AWS idempotent APIs: treat a retry as the same user intent, replay the original result, and reject reuse of a key with a different payload.
- WorldFiled's existing brand and editorial policy: calm, evidence-led, concise, clear uncertainty, human approval, no auto-publishing.

These references inform interaction patterns, not wholesale framework adoption. We keep the existing React application and Supabase schema unless a separately approved migration is justified.

## Core experience

The editor should always understand:
1. Where am I in the editorial workflow?
2. What has been saved, and where?
3. What is verified, what is only a lead, and what remains unknown?
4. What is blocking the next step?
5. What will happen if I click this action?
6. Can I safely retry if the network fails?

## Navigation and information architecture

- Keep the existing Research → Verification → Editorial Review → Edition → Creative Production path visible.
- Use a small step indicator on long workflows, but do not force a wizard when editors need to move back and forth.
- Preserve the editor's filters, selections and scroll position when navigating back from a story or evidence record.
- Show contextual links between Story Desk, Evidence Room, Editorial Review and Edition Desk.
- Avoid duplicating the same control in multiple places unless the action has a clear primary location.

## Status language

Use distinct, non-interchangeable states:
- Research lead: retrieved metadata/snippet; not evidence of full article review.
- Evidence recorded: a passage is attached to a source; not yet assessed.
- Claim supported / partially supported / contradicted / insufficient / unverified: editor decision for a specific claim.
- Story verified: material claim register marked complete and all required claim decisions current.
- Editorial approved: separate editorial decision.
- Edition approved: human approval of the exact member set and current assessment.
- Export ready: server-side preflight passed for the exact approved, cleared edition.
- Published: a separately authorised publication action, not currently implied by export.

Never use a green tick or the word verified for model confidence, source count, an official statement alone, or a research score.

## Evidence Room interaction

- Group the story's source register and claims clearly. Provide source preview and direct open-in-new-tab actions.
- Make it easy to add a claim, then attach one or more passages from the known story sources.
- Label evidence as supporting, contradictory or contextual. Do not imply that a passage proves more than it says.
- Show source publication and retrieval timestamps, plus content depth (metadata/snippet/full text) prominently.
- Use inline field validation with character counts. Reject overlong inputs; never silently truncate.
- Preserve entered form content when one API call fails.
- Keep the current action's loading state local; do not freeze the entire page.
- On success, refresh the relevant claim and show a concise confirmation.
- Before marking a story complete, show unresolved claim count and a clear checklist. Require the editor to confirm that the material-claim register is complete.
- When evidence changes after a decision, show a visible stale-decision warning and identify which claim needs review.
- A contradiction requires an explicit, dedicated reconciliation field; do not hide this inside generic notes.

## Edition Desk

- Keep Video and Text edition workspaces independent while sharing the research pool.
- Clearly distinguish unsaved local draft, saved server draft, current human approval, stale approval and generated prompt.
- Preserve a local draft after refresh, but label it as browser-local until server-saved.
- Show why a development is suggested, held back or excluded; do not silently remove selected stories.
- Use explicit "Save draft", "Approve this exact selection" and "Generate production prompt" actions. Never collapse these into one ambiguous button.
- If membership or factual evidence changes, visibly invalidate the relevant approval or prompt.
- Make the 6-second static roundup mode visually distinct from narrated programme/script modes. Static mode must not expose irrelevant voice, runtime or scene controls.
- Before export, show a compact preflight checklist and specific reasons for any block.

## Safe mutation states and idempotent retries

For every state-changing action:
- Idle: clear action label and preconditions.
- Pending: show action-specific progress; prevent accidental double-click.
- Confirmed: show what was saved and where, with a timestamp or version where appropriate.
- Outcome unknown: preserve the same idempotency key and offer a safe retry/check; never tell the user it failed merely because the client timed out.
- Replayed: explain that the original action was already saved and no duplicate was created.
- Conflict: explain whether the key was reused with changed data or whether the underlying resource changed.
- Validation failure: point to the exact field; preserve all other entries.

Do not auto-clear forms before the server confirms success. Do not generate a new key on a retry. A changed payload is a new logical action and must be explicit.

## Accessibility and visual polish

- Keyboard-first operation and visible focus rings.
- Semantic headings, labels, fieldsets, buttons and live status regions.
- High contrast for archive cream/navy palette; do not rely on colour alone to communicate state.
- Responsive layouts: evidence and decision controls must remain usable on a narrow phone screen.
- Use concise explanatory helper text, progressive disclosure for advanced metadata, and plain-language error messages.
- Keep destructive or irreversible actions separated and confirmed.
- Respect reduced-motion preferences; avoid decorative animation on editorial screens.
- Consistent button hierarchy: one primary action per panel, secondary actions understated, destructive actions visually distinct.
- Loading skeletons or inline progress should preserve layout and avoid content jumps.
- Empty states should explain the next useful action; error states should provide a retry that does not discard work.

## UX quality gates

Before a feature is marked done:
- New user can identify the next step without developer explanation.
- A returning editor can recover their place after refresh or navigation.
- A failed request does not lose entered content.
- Double-click and retry do not create duplicate records.
- Every success message corresponds to a confirmed server result.
- Unknown/partial evidence is never visually presented as verified.
- Keyboard and mobile checks pass.
- Long headlines, long passages, empty states, API errors and stale approvals are tested.
- No feature is considered complete on screenshot appearance alone; verify its actual interaction and state transitions.

## Rollout order

1. Apply these principles to Evidence Room and editor decisions.
2. Add idempotent mutation helper and pending/unknown/replayed states alongside transactional endpoints.
3. Improve Edition Desk draft/approval/preflight status and contextual navigation.
4. Add immutable edition history and correction comparison.
5. Test with realistic long headlines, multilingual names, weak connections, contradictory sources and network interruption.

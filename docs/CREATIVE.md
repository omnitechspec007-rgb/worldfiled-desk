# Creative Prompt Architect

Approved story in, Claude production prompt out. Rule-based, no AI, no cost. Nothing is rendered, voiced or published here.

## Flow
1. A story is approved by a person (Editorial Review).
2. `treatments.mts` picks a story-type treatment from fixed keyword rules (policy, science, geographic, environment, human-centred, data, general) and the team of roles that fits it. The editor can override it.
3. `evidence-pack.mts` builds the evidence block from stored records: source links, outlet, type, publication date, headline and a snippet of at most 400 characters. Up to 12 sources; the rest are counted and named, never silently dropped.
4. `production-tools.mts` selects tools by deliverable. Script-only and HTML-preview deliverables need none and say so. A narrated video needs FFmpeg and a free text-to-speech engine to verify; Remotion is optional; Whisper and OpenCV are listed as not needed.
5. `prompt-architect.mts` assembles sections A to K plus the full brand block (`brand.mts`) and any APPROVED style rules.
6. The prompt is saved unchanged to Prompt History. The database refuses a new prompt unless the newest decision on the story is "approved" and records which decision it relied on.

## Evidence classes
OFFICIALLY_DOCUMENTED (what that official source itself records), INDEPENDENTLY_CORROBORATED (2+ outlets; judged by outlet name only, origin not traced), SINGLE_SOURCE, CONFLICTING (only when the editor enters a note), UNKNOWN. Creative treatment can never promote a claim above its class.

## Limits (honest)
Only headlines and short snippets are retrieved. No claim extraction, no source tracing, no automatic conflict detection. The curiosity read is an editorial hypothesis, not measured audience behaviour.

## Reference Library
Style rules from reference videos are stored as PROPOSED and used only after the editor approves them. Editing creates a new PROPOSED version. Only facts re-verified from the files, or seen by eye in sampled frames, are seeded.

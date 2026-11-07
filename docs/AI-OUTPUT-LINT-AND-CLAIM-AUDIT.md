# WorldFiled Desk — AI output lint and factual-integrity audit

Status: design proposal for the next editorial-quality feature. No new linter dependency or production change made.
Prepared: 7 November 2026.

## Objective

Review an AI-produced draft before human factual clearance. Detect machine-like prose, weak attribution, missing evidence links, unsupported details, misleading certainty, and malformed output. The system must show actionable findings with exact text locations and reasons. It must never claim that a draft is true merely because it passed a lint.

## Benchmark review

### Prose/style linting

| Project | What it does well | Limitations for WorldFiled | Decision |
|---|---|---|---|
| Vale (vale-cli/vale) | Markup-aware, custom YAML rules, named style packages, CI/editor use; can encode house style without changing application code | Primarily style/consistency, not factual verification; standalone Go binary adds packaging and deployment complexity | Borrow the rule taxonomy and severity model; defer installing the CLI |
| textlint (textlint/textlint) | JavaScript ecosystem, composable rules, markup-aware processing, fits a TypeScript/Node codebase | Zero bundled rules by design; rule packages and configuration can grow quickly; grammar/style rules can be noisy | Consider if our custom rules outgrow a small internal module |
| write-good (btford/write-good) | Lightweight heuristics for passive voice, weasel words, weak modifiers and common prose tics | Not markup-aware; heuristics can misclassify legitimate journalism; old maintenance cadence should be checked before adoption | Borrow selected signals only; do not use as a hard gate |
| proselint (amperser/proselint) | Large collection of opinionated language/style checks | Python runtime and English-centric rules; not a fact-checker | Do not add a second runtime for MVP |

### Claim and citation auditing

| Project | Useful pattern | Limitation / adaptation |
|---|---|---|
| Draft Detective (RAND CAST) | Multiple independent assessments; findings pinned to exact document locations; editor resolves findings; explicit reporting of what was checked | Model assessments remain fallible; adopt issue-centric UX and provenance, not a truth badge |
| PaperTrace | Claim-to-citation mapping, page-level evidence, explicit retrieval gaps; unread sources receive no verdict | Research-paper/PDF oriented; adapt claim/evidence records to newsroom sources and passages |
| OpenErrata | Transparent rationale and second-stage validation before showing a correction | Browser extension and LLM investigation are not our current stack; adopt independent review/abstention, not automated correction |

## Chosen approach

Build a small, deterministic TypeScript audit module first. It will run inside the existing Node/Netlify architecture and use the existing evidence register. No new paid API, external AI call, Python runtime or CLI is required for the first release.

Do not try to replace Vale or textlint. If the custom style rule set grows substantially, run a later measured comparison before adopting one. Do not use prose heuristics to decide whether a factual claim is true.

## Four independent audit layers

### A. AI-slop and prose-quality lint

Detect signals, not guilt:
- repeated sentence or paragraph openings;
- duplicated sentences and repeated claims;
- repeated summary/conclusion sections;
- generic filler, empty superlatives, artificial suspense and manufactured controversy;
- unsupported vague attributions ("experts say", "observers believe", "many people think");
- predictable transition overuse and formulaic "what this means" sections;
- unnecessary adverbs, weak modifiers, passive-voice overuse and wordy phrases;
- sentence-length monotony and unusually dense paragraphs;
- word-count inflation relative to available evidence;
- boilerplate hooks, generic conclusions and repeated brand/tagline insertion.

Each finding includes a span, rule ID, severity, explanation and suggested editorial action. A style warning alone never blocks publication. Repeated or high-severity issues can request editor review. Do not auto-rewrite the draft.

### B. Factual and provenance audit

Use structured claim references, not vague similarity:
- Every material factual sentence/claim must map to one or more claim IDs and source/evidence IDs.
- Every reference must resolve to a source that belongs to the story/edition.
- Source depth must be shown: metadata, snippet, checked passage, full-text extraction, official document.
- An unread, inaccessible or metadata-only source cannot receive a supporting verdict.
- A claim with no checked passage is unsupported/unresolved, not "probably true".
- Contradictory evidence remains visible and requires a dedicated editor rationale.
- Direct quotations must match a checked passage exactly after safe whitespace normalization; paraphrases must not be presented as quotations.
- Names, dates, quantities, units, currencies, locations, titles and attributions must be traceable to evidence; unknown values remain UNKNOWN.
- Claim decisions must be current relative to evidence timestamps and versions.
- Story-level completeness is an editor assertion; the tool cannot know whether the editor omitted a material claim.

The linter can flag missing mappings, invalid IDs, stale evidence and exact quote mismatches. It cannot reliably establish semantic entailment or truth by itself.

### C. Anti-manipulation and prompt-injection audit

- Detect loaded or conclusory language around allegations, guilt, intent, corruption, motive and causation.
- Require attribution for official statements, press releases, advocacy, sponsored content and allegations.
- Flag claims that turn a proposal into enacted law, forecast into outcome, sequence into causation or an official claim into independent confirmation.
- Preserve material counter-evidence and identify selective evidence patterns.
- Treat source text and tool outputs as untrusted data, never as instructions.
- Do not let sponsor or engagement goals change evidence class, factual conclusion, selection rank or correction.
- Any manipulation flag is a review request, not a model-generated verdict.

### D. Output contract and safety validation

- Validate requested output type, required fields, edition kind, target length as a ceiling/guide, and citation syntax.
- Reject invented source URLs, unresolved reference IDs, malformed JSON, unapproved tool claims and missing attribution.
- Distinguish null/unknown from zero, false, empty and not applicable.
- Check that a static 6-second roundup has no narration, scene list, voice settings, soundtrack or unsupported duration.
- Reject silent truncation and unexpected fields.
- Ensure synthetic fixtures and illustrative examples are visibly labelled and never enter production data.
- Keep private editor APIs no-store; do not cache a green audit result past the evidence/policy versions that produced it.

## UX model

Use an editorial issue list, not a giant green score:
- **Blocker**: missing/invalid source mapping, stale factual decision, unsupported quote, unresolved critical claim, or invalid output contract.
- **Needs editor review**: possible inference, manipulation, contradiction, vague attribution, potential slop, or uncertain source lineage.
- **Suggestion**: readability, repetition, weak phrasing, style consistency.

Each finding should show the exact text span, why it was flagged, the source/claim references involved, and an action: inspect evidence, edit draft, mark false positive with a reason, or resolve. Findings are version-bound. Editing the draft or evidence reruns the affected checks. The editor can dismiss a style false positive with a rationale; a factual blocker cannot be dismissed into verified status.

## Release gates and measurement

- Precision of style warnings is measured on a manually labelled sample; tune for useful warnings rather than maximum detection.
- Track false-positive rate by rule, editor dismissals, unresolved blockers, unsupported-claim rate and correction rate.
- Every rule has an owner, tests, severity, rationale and examples of true/false positives.
- A lint pass is not factual verification, editorial approval or publishing permission.
- No automated score can replace the existing claim-clearance and human-approval gates.

## Implementation sequence

1. Create a pure TypeScript draft-lint module with deterministic rules and tests.
2. Add a preview-only Draft Audit panel using a pasted or generated draft; no DB writes.
3. Add claim/source mapping validator against existing Evidence Room records.
4. Add quote/number/date and citation-reference checks.
5. Add anti-manipulation review findings and line-level issue navigation.
6. Tune on real editorial examples with human-labelled false positives.
7. Only then decide whether Vale or textlint adds enough value to justify another dependency.

## Reference links

- Vale documentation: https://docs.vale.sh/
- Vale style package explorer: https://vale.sh/explorer
- textlint: https://github.com/textlint/textlint
- write-good: https://github.com/btford/write-good
- Draft Detective design: https://agencyenterprise.github.io/draft-detective/
- PaperTrace: https://github.com/defraction0/PaperTrace
- OpenErrata: https://openerrata.com/

# How WorldFiled Desk scores stories (rules-1)

All scoring is deterministic keyword and structure rules. No AI. Each score is stored with a reason in plain words,
so you can see why a story ranked where it did. Code: `netlify/lib/scoring.mts`. Tests: `tests/scoring.test.mts`.

## Separate dimensions (never merged into one hidden number)
| Dimension | Range | What it looks at |
|---|---|---|
| Editorial significance | 0-5 | Category, significance wording (law, court, treaty...), multi-region coverage, official source |
| Evidence quality | 0-5, **capped at 2** | Official/primary source present, number of outlets. Capped because only headlines and short summaries are collected. |
| Source independence | 0-5, **capped at 2** | Single outlet = 0. Several outlets can only reach 2, because they may repeat one announcement. Wire-service wording lowers it. |
| Novelty | 0-5 | First seen recently, new-development wording; lowered for recycled or live-update formats |
| Recency | 0-5 | Age of the newest report |
| Human relevance | 0-5 | Everyday-life wording (health, prices, jobs, rights, safety...) |
| Geographic spread | 0-5 | Number of regions covering it |
| Curiosity | 0-100 | **Editorial hypothesis.** Weights: curiosity gap 15, human impact 15, surprise 12, consequences 12, relevance 10, novelty 10, conversation potential 10, emotional resonance 6, scale 5, hidden connection 5. |

Also recorded: story patterns that matched (information gap, reversal, discovery, accountability...) and warning flags
(single outlet, vague attribution, clickbait wording, recycled, live-update, no date).

## Shortlist (12 stories)
1. Candidates: stories with a report in the last 72 hours (official sources: 14 days).
2. Ordering blend: significance 28%, curiosity 20% (multiplied by an evidence gate), relevance 14%, recency 10%,
   novelty 10%, evidence 10%, independence 8%. The gate is `0.4 + 0.6 x evidence/5`, so strong curiosity cannot rescue weak evidence.
3. Reserved slots first: up to 3 under-reported regions (Africa, Latin America, Oceania, Middle East), 1 science, 1 official institutional change.
4. Then by priority, with caps: at most 4 per region and 3 per category (the category cap is relaxed, with a stated reason, only to fill empty places; the region cap never is).
5. Stories with significance of 3.5 or more that were not selected are listed as "held back" with the reason.

## Known limitations (honest list)
- Keyword rules miss meaning. A subtle story can score low, and a headline with the right words can score high.
- The curiosity weights are initial hypotheses. They are not calibrated and do not predict audience behaviour.
- Evidence quality and independence are capped until full-text retrieval, claim checking and original-source tracing exist.
- "Several outlets" never means "independently confirmed".
- English-language keywords only. Non-English headlines will score poorly on cue-based dimensions.
- The region of a story is the region of the outlets covering it, not necessarily where it happened.
- Audience performance is not measured. When real analytics exist, they should be stored separately and used to recalibrate the weights, never mixed into verification.

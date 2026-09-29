# Jev decision workflow

This is an opt-in **development** tool. It runs in Node, outside the Vite client and game rules. The project previously had a working ad hoc Jev smoke test and agent instructions, but no reusable client module. The layer uses the [TypeSafe System One HTTP API](https://docs.typesafe.ai/api) with `jev-latest`, Noul and Choice questions. It does not run during gameplay, builds, or every agent turn.

## Current decisions

| Decision | Why Jev | Entry point |
| --- | --- | --- |
| Requirement coverage | A semantic claim may be expressed differently from code; batch one yes/no question per requirement against a short implementation excerpt. | `verify` |
| Change scope | Judge whether a focused change serves the request without adding a separate feature. File paths and diff size remain deterministic. | `reviewScope` |
| Evidence relevance | Choose the best item from 2–8 candidates returned by ordinary search, including `none`. | `chooseRelevantEvidence` |

Use these only when a human or Codex would otherwise have to make a bounded semantic judgment. Do not call Jev for obvious exact matches. Supply focused, current evidence; Jev cannot inspect the repository on its own. Requirements are batched in a single request because they share evidence. Choice returns its probability distribution and confidence; Noul returns probability of yes, with no separate confidence.

## Gates and uncertainty

`verify` requires `testsPass`, `buildPass`, and `artifactsExist`. A failed gate returns `reject` without an API call. Missing evidence or requirements returns `review`. Initial configurable thresholds: Noul yes ≥ 0.85, no ≤ 0.15; Choice confidence ≥ 0.8. Intermediate results route to Codex review; certainty below 0.6 routes to human review when the ambiguity affects the decision. These numbers are starting policy, not calibrated truth. A confident Jev answer is still evidence to inspect, not authorization to merge, publish, spend money, delete data, or change security-sensitive behavior. Those actions need their ordinary safeguards and user authorization.

`JevDecisionLayer` accepts an injected transport, metrics callback, and thresholds. Invalid responses and service failures return `review`; authentication failures are reported as `TypeSafe HTTP 401` and should stop further TypeSafe calls. The HTTP client does not include response bodies in errors.

## Use

Create a small JSON file outside the repo or in `/tmp`, then run `npm run jev:review -- /path/to/review.json`. Three input shapes:
An optional top-level `thresholds` object can override `yes`, `no`, `choice`, or `humanBelow` for a run.

```json
{"kind":"requirements","evidence":"Short relevant code and test excerpt","requirements":{"r1":"Walls have visible health bars"},"gates":{"testsPass":true,"buildPass":true,"artifactsExist":true}}
```

```json
{"kind":"scope","request":"Make wall health bars more visible","focusedChange":"Changed wall health bar dimensions and contrast in ArenaView"}
```

```json
{"kind":"relevance","question":"Where is wall health rendered?","candidates":{"view":"ArenaView wall health material excerpt","game":"Game wall damage rules excerpt"}}
```

The CLI loads `TYPESAFE_API_KEY` from the project-root `.env` as data after checking that `.env` is ignored and untracked. It never writes the key into the browser bundle. It records only safe metadata to gitignored `.jev-metrics.jsonl`: request count, batched judgment count, token usage when present, latency, probability-derived certainty, fallback and escalation counts, and *estimated* LLM judgments avoided. This estimate counts decisive Jev answers; it is **not** a measured Codex token saving. Compare it against actual API cost, review corrections, fallback frequency, and Codex time on representative tasks before expanding usage. Logs contain no prompts, evidence, raw responses, or credentials.

Exact validation, schema checks, tests, type checking, file existence, numeric rules, and build results remain deterministic. Codex still writes and debugs code, designs systems, handles open-ended reasoning, reviews uncertain results, and makes final decisions.

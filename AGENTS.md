# Wall Ball Reborn — Agent Instructions

## TypeSafe / Jev

The vendor-managed skill is `.agents/skills/typesafe-ai/SKILL.md`. Read it and
the relevant live TypeSafe API/question docs before using TypeSafe; do not edit
the skill. The credential is in the project-root `.env`. Verify `.env` is
Git-ignored and untracked before loading `TYPESAFE_API_KEY` into the calling
process. Treat `.env` as data, not shell code. Never print, echo, hash,
partially reveal, log, hard-code, or commit the key or `.env`.

Use the cheapest reliable mechanism for each decision:

1. Use `rg`, file names, exact symbol search, parsing, calculations, tests,
   type checking, and build tools for facts they can establish directly.
2. Consider Jev for several bounded semantic judgments over the same small
   set of evidence. Good candidates are ranking an ambiguous shortlist where
   wording differs from code, checking separate requirements against a focused
   change, or triaging mixed failures whose relationship is unclear.
3. Batch independent Choice, Noul, and Score questions that share state. Include
   a no-match option where needed; write complete instructions because question
   IDs are not sent to the model. Send only relevant snippets and task facts,
   never secrets or the whole repository by default.
4. Use returned probabilities as signals for investigation, not as proof. A
   midrange Noul or split Choice/Score distribution calls for Codex inspection.
   Do not use a universal confidence threshold. Even a strong result does not
   replace tests or authorize consequential changes.

Do not invoke TypeSafe for an obvious one-file lookup, a straightforward task
route, formatting, exact calculations, compilation, or routine test execution.
Its API latency and availability vary, so an extra call can cost more than a
quick deterministic check. On a transient service error, retry at most once
when the judgment would materially help; otherwise use deterministic tools and
Codex reasoning. On authentication failure, stop TypeSafe calls and report it.

For opt-in development reviews, use the Node-only layer in `tools/jev/` as
described in `JEV_WORKFLOW.md`. It batches focused semantic checks, requires
deterministic gates for requirement verification, and records metadata only.
Do not invoke it automatically for every task or build.

Codex remains responsible for architecture, implementation, program tracing,
open-ended game design, security-sensitive decisions, and final verification.
TypeSafe scoring may surface tradeoffs, but Codex makes the decision.

## Development

Before finishing a meaningful gameplay change, run relevant tests and
`npm run build`, then compare the result with the user's requirements. A
batched TypeSafe coverage check can help with a multi-part change when focused
evidence is already available; inspect uncertain or negative findings yourself.
Tests, type checking, and direct review remain authoritative.

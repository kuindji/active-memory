# Phase 8.0 — Local-LLM Answer-Synthesis Smoketest

**Status:** design approved 2026-04-18
**Owner:** path-memory line
**Parent plan:** `experiments/path-memory-smoketest/PLAN-post-2.8.md` (additive; does not modify retrieval knobs)

## Context

Path-memory's Phase 7.5 LOCOMO run (1542 probes) recorded `contain=0.126` against `evidR=0.321`. The 20-point gap means: the retriever finds the right evidence in ~32% of questions, but the gold answer substring only appears verbatim in the retrieved text ~13% of the time. The missing 20 points are cases where the retrieved claim is *about* the answer but not a verbatim string match (rephrased, implicit, multi-hop).

There is no generator in the pipeline today. `locomo-score.ts:39-41, 62` computes `contain` by joining `retrievedClaimTexts` and substring-matching the gold answer. An answer-synthesis step that reads the retrieved evidence and produces a short answer in the gold's format is the direct lever on this gap.

This phase tests that lever with a **local** LLM (Ollama sidecar, Qwen2.5-1.5B-instruct) so we keep the line's cost-discipline and avoid a cloud-LLM dependency in the eval loop.

## Scope

**In scope**

- Add an optional answer-synthesis stage after retrieval on the LOCOMO adapter.
- Report synthesizer metrics side-by-side with the existing retrieval metrics (dual reporting; nothing removed).
- Run primary evaluation on LOCOMO (1542 probes), with MSC (200) and LongMemEval as non-regression gates.
- Confounder check at 3B on a 150-probe LOCOMO slice to rule out the "model too small" failure mode.

**Out of scope**

- Query-side rewriting / decomposition (would be Phase 8.1)
- Re-ranking of retrieval candidates (Phase 8.2)
- Ingestion-side LLM extraction of atomic facts / typed edges (Phase 8.3)
- Changes to encoder, decay, RRF, Dijkstra knobs (retrieval pipeline held fixed at the Phase 2.14 default)

## Prior art and positioning

**Outside the repo**

- Lewis et al., 2020 — RAG. Generic retrieval-then-generate pattern.
- The LOCOMO and MSC papers use GPT-4o as the answerer. We are not trying to match that; we are measuring whether a *small local* LLM moves our current rule-based contain metric.

**Inside the repo**

- Phase 7.2 (LLM-judge) was parked under the "exhaust non-LLM paths first" feedback. That park is about **evaluation-side** LLM use; this phase is **inference-side** component use, which is a different axis and not affected by that park.
- Phase 0.4 (lm-as-memory) has Qwen2.5-1.5B on MPS working via transformers. That stack stays; this phase runs Qwen2.5 through Ollama instead for throughput reasons, but the model family is the same.
- RRF (Phase 2.16 Stage A) ships opt-in and is NOT combined with the synthesizer in this phase — retrieval is held fixed at the Phase 2.14 default (BGE-base, `sessionDecayTau=0.2`, decay ON) so the synthesizer's contribution is isolated.

## Architecture

```
LOCOMO probe ─► path-memory retriever ─► top-K claim texts
                                                │
                                                ▼
                             Ollama sidecar (qwen2.5:1.5b-instruct)
                                                │
                                                ▼
                                      synthesized short answer
                                                │
                                                ▼
                     dual scoring: retrieval.* and synth.*
```

- Ollama runs as a separate process (`ollama serve`) managed outside the harness; the Bun runner assumes it is up and fails fast if `/api/tags` does not respond.
- A new `LlmSynthesizer` adapter under `experiments/path-memory-smoketest/src/` wraps the HTTP call to `/api/chat`. It exposes a single `synthesize(question, claimTexts): Promise<{ answer, ms }>`.
- The LOCOMO adapter gains an optional `synthesizer?: LlmSynthesizer` parameter. When set, each `LocomoQuestionResult` gains `synthesizedAnswer: string` and `synthMs: number`.
- The scorer produces two metric bundles per question: `retrieval.*` (unchanged, on joined claim text) and `synth.*` (new, on the LLM output). Both are aggregated overall, per-category, and by adversarial flag.

## Prompt (v0, zero-shot)

```
System:
You answer questions using only the provided memory snippets.
If the snippets do not support an answer, respond exactly "Not mentioned".
Answer in ≤15 tokens. Do not explain.

User:
Memory:
1. {claim_1}
2. {claim_2}
...
K. {claim_K}

Question: {question}
Answer:
```

- K is taken from the existing `maxClaimsPerQuestion` from the Phase 7.6 tuning (8–12 target range).
- Token cap is a hard request; the synthesizer additionally truncates to 30 tokens defensively.
- Few-shot examples are deliberately out of scope for v0 — we want to see zero-shot headroom first.

## Adversarial handling

LOCOMO flags `adversarial: true` when gold evidence is absent. The `"Not mentioned"` abstention clause is the first defense. For scoring:

- Adversarial questions are aggregated as a **separate stratum** so their behavior does not mask lift on answerable questions.
- We additionally report `abstentionRate` on adversarial and `falseAbstentionRate` on answerable. Abstention is detected by case-insensitive exact match on the trimmed model output equal to `"not mentioned"`.

A high `falseAbstentionRate` is a kill-signal even if overall contain moves up — it would mean the model is learning "abstain when unsure" instead of "answer when the evidence is there."

## Metrics reported

Per question, per category, overall:

- **Unchanged:** `retrieval.contain`, `retrieval.tokenRecall`, `retrieval.tokenF1`, `retrieval.evidenceRecall`, `retrieval.substringFirstRank`
- **New:** `synth.contain`, `synth.tokenRecall`, `synth.tokenF1`
- **Headline delta:** `synth.contain − retrieval.contain`
- **Abstention:** `abstentionRate` (adversarial stratum), `falseAbstentionRate` (answerable stratum)
- **Latency:** `synthMs` p50 / p95 / max; total wall-clock for 1542-probe run

## Gates

Let Δ = `synth.contain − retrieval.contain` on LOCOMO (answerable stratum).

Baselines for the non-regression gates are whatever the current Phase 7.5 numbers report on the same run (MSC ≈ 0.332 persona recall; LongMemEval contain taken from the latest Phase 7 reading). The gate uses "whatever the same build on the same machine reports at head," not fixed historical numbers — this guards against drift from any intervening retrieval change.

- **Ship default-on:** Δ ≥ +0.05 AND MSC persona recall does not drop > 0.02 AND LongMemEval contain does not drop > 0.03 AND `falseAbstentionRate` < 0.05.
- **Ship opt-in:** +0.02 ≤ Δ < +0.05 AND non-regression on MSC / LongMemEval AND `falseAbstentionRate` < 0.05.
- **PARK:** Δ < +0.02 OR any regression exceeds threshold OR `falseAbstentionRate` ≥ 0.05.

Latency is reported but not a hard gate — we expect tens of minutes end-to-end on the 1542-probe run with a 1.5B model.

## Confounder check

After primary completes, run `qwen2.5:3b-instruct` on a 150-probe LOCOMO slice, stratified proportionally across categories 1–5. Decision rule:

- `Δ_3B − Δ_1.5B ≥ +0.03`: escalate default model to 3B; rerun full LOCOMO at 3B before shipping.
- `Δ_3B − Δ_1.5B < +0.03`: 1.5B is the default; the size confounder is cleanly ruled out.

## Deliverables

- `experiments/path-memory-smoketest/src/llm-synthesizer.ts` — Ollama HTTP adapter with `synthesize` + a health check.
- `experiments/path-memory-smoketest/eval/locomo-adapter.ts` — optional synthesizer hook; fields on result.
- `experiments/path-memory-smoketest/eval/locomo-score.ts` — dual metric bundle; abstention counters.
- `experiments/path-memory-smoketest/scripts/phase-8-0-locomo-synth.ts` — primary 1542-probe runner.
- `experiments/path-memory-smoketest/scripts/phase-8-0-confounder.ts` — 3B 150-probe slice runner.
- `experiments/path-memory-smoketest/notes/phase-8-0-reading.md` — writeup with numbers, decision, next step.
- Memory entry updating `path_memory_phase80.md` (new file) plus a line in `MEMORY.md`.

## Risks and open questions

- **Ollama is a new infra dependency.** Mitigated by making the runner fail fast on missing server and by keeping Ollama out of the test matrix (smoketest scripts only).
- **Prompt brittleness at 1.5B.** The zero-shot `"Not mentioned"` contract may be inconsistently honored. We accept this risk for v0; if `falseAbstentionRate` tanks the gate, we add a one-shot example in v1 rather than abandoning the phase.
- **Dual-metric noise.** Reporting two contain numbers side-by-side can be read as moving goalposts. Mitigated by making `synth.contain − retrieval.contain` the single headline number and never cherry-picking whichever looks better.
- **Hidden coupling to `maxClaimsPerQuestion`.** If Phase 7.6 precision tuning changes this parameter, the synthesizer's context size changes with it. We run the primary at the current default and flag this as a dimension for a later sweep if lift is strong.

## Non-goals (explicit)

- We are not attempting to match LOCOMO's published GPT-4o numbers.
- We are not building a generic RAG framework. The synthesizer is purpose-built for this harness, ~100 LoC.
- We are not changing how path-memory *ingests* or *retrieves*. Only how we turn retrieval output into a scorable answer.

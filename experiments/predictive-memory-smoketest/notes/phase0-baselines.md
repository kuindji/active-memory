# Phase 0 — Non-learned baselines (reading notes)

Scope: two published, non-learned reference points against which any future
predictive-context experiment has to justify its added complexity. No
predictor, no training, no LLM.

## CMR — Temporal Context Model

- Howard & Kahana 2002 (Journal of Mathematical Psychology), Polyn/Norman/Kahana 2009.
- State: `c_t ∈ R^d`, a running representation of "what just happened."
- Update rule (simplified, symmetric network variant):

  ```
  c_t = ρ · c_{t-1} + β · f_t
  c_t = c_t / ||c_t||
  ```

  where `f_t` is the item (here: sentence embedding), `ρ` is the retention
  rate (how much of prior context survives), and `β` controls how strongly
  the new item injects into context.
- Encoding: every memory stores its item representation `f_t` **and** the
  context `c_t` that was active at encoding time.
- Retrieval: a cue (`q`) produces its own context `c_q` by propagating
  through the same dynamics, then memories are scored by similarity to
  `c_q` (context-based) and/or `f_q` (content-based). Free-recall fits
  use cue-based context similarity; here we use a weighted sum.
- Defaults from the literature: `ρ ≈ 0.8–0.9`, `β ≈ 0.4–0.6`. We pick
  `ρ=0.85, β=0.5, w=0.5`.

Implemented in `src/cmr.ts` (no training — pure arithmetic on embeddings).

## Baldassano et al. 2017 — event segmentation via HMM

- Paper: "Discovering event structure in continuous narrative perception
  and memory" (Neuron).
- Method: fit a Gaussian HMM over an embedding time series with K latent
  states and a **left-to-right transition topology** (a state, once left,
  cannot be re-entered). Viterbi-decoded state changes == event boundaries.
- With left-to-right topology, Viterbi decoding reduces **exactly** to
  contiguous K-segmentation minimizing within-segment SSE from the segment
  centroid. No EM needed — it's a dynamic program, O(T² · K).
- K selection: original paper uses cross-validated log-likelihood against
  held-out subjects; for our synthetic streams we either supply an oracle K
  (= true segment count) or pick K by a BIC-proxy penalty.

Implemented in `src/hmm-segmenter.ts` as DP over SSE with prefix-sum
segment-cost lookup.

## Cosine-change — the "does this add anything?" control

- Literal baseline: boundary at any adjacent-pair cosine drop that's more
  than z stdevs below the running mean of drops.
- Three lines. Implemented in `src/cosine-change.ts`.
- If the HMM can't beat this by ≥ 0.10 F1 on synthetic streams, it's not
  earning its computational keep.

## Evaluation design

- **Reinstatement (§5.4 of DRAFT.md)**: 15 hand-authored fixtures. Each
  plants a content-ambiguous turn in scene A and an identical (or
  near-identical) distractor in scene B. The query names scene A. Flat
  retrieval cannot separate them; CMR should.
  - Metrics: MRR, pair-accuracy (target outranks matched distractor), top-1.
  - Pass: CMR pair-accuracy ≥ 80% AND flat ≤ 60%.

- **Boundary detection (§5.2)**: 5 seeded synthetic streams built from
  8 distinct topic pools. Gold = segment junctions.
  - Metrics: precision / recall / F1 with ±2-turn tolerance.
  - Pass: HMM F1 (oracle K) ≥ cosine-change F1 + 0.10.

## Out of scope (per plan)

- No predictor. No learned dynamics. No write gate.
- No LongMemEval / LOCOMO / MSC wiring — those are Phase 1 if Phase 0
  clears its bar.
- No integration with path-memory-smoketest. Pure `getEmbedder()` reuse.

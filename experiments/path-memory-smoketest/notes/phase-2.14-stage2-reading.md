# Phase 2.14 Stage 2 — reading note (prior-art context)

Per `PLAN-post-2.8.md` "Reading protocol": even when a phase borrows no
new paper, record the background it is re-interrogating. Stage 2 does
not derive from any new external work — it re-tests two primitives
already in-tree (Option H, Option A1) against the bge-base geometry
established in Phase 2.13 and refined by Phase 2.14 Stage 1.

## Mechanism we're re-interrogating

### Option H — cluster-affinity-boost (`src/retriever.ts:340-422`)

Borrowed originally from the GraphRAG lineage (community-structured
retrieval): soft-cluster the claim embedding space, then multiply each
anchor's base score by `(1 + β · maxClusterAffinity(probe, cluster(c)))`.
The aggregate is otherwise Option I (`Σ_p w(p) · max(0, cos(p,c) − τ)`).

Hyperparameters: `tau` (base gate), `beta` (boost strength), `k`
(soft k-means cluster count), `temperature` (softmax sharpness,
default ~0.1), `seed` (k-means init).

### Option A1 — temporalDecayTau (`src/graph.ts:248-250`)

Exponential decay on edge age: `w ← w · exp(-dt / tau)` with `tau` in
the dataset's native time units (tier-2 uses "years since 800 BCE").
Applied at the graph layer, so composable with any traversal + anchor
scorer. Passed via `PathMemory` constructor, not `RetrievalOptions`.

## What we are NOT copying

No new paper reading; no new mechanisms. Stage 2 holds the scoring
functions and plumbing exactly as shipped — only the hyperparameter
grid and the encoder underneath change.

## Prior-refutation context (why this is a retest, not a first test)

Both primitives were pruned from the MiniLM-era sweep matrix:

- **Option H** under MiniLM: the Phase 2.4 sweep (13 rows, k ∈ {4,6,8,10},
  β ∈ {0, 0.5, 1.0, 2.0}) found no lift on tier-2 eval-B. Option H is
  listed on `PLAN-post-2.8.md`'s dead-primitives list ("cluster-affinity-
  boost — no lift").

- **Option A1** under MiniLM: the sweep.ts rows (62–75) tested τ ∈ {2, 5,
  10} on Dijkstra; result was "inert to harmful." Also on the
  dead-primitives list.

Phase 2.13 memory (`path_memory_phase213.md`) warned that "Phase-2.8's
dead-primitives list is encoder-stale" — under BGE-small, Dijkstra
tmp=0.5 and J min-gate moved from the MiniLM prune list to the top-two
eval-A performers. That precedent is the direct justification for
retesting H and A1 under bge-base before declaring the
Alexander-succession arc encoder-granularity-bound.

## Implementation-critical details (failure modes to watch)

- **Option H seed sensitivity.** k-means with a fixed seed (default 1)
  gives reproducible rows; any instability across the 5 H rows in this
  stage would indicate cluster assignments are brittle at this cluster
  count. Seed is not swept — a single seed per row matches the Phase
  2.4 protocol, so results are comparable to the MiniLM run.
- **Option A1 τ units.** tier-2 claims span roughly 0–700 (years since
  800 BCE). τ=2 is extreme (decays to e⁻¹ in 2 years); τ=10 is still
  aggressive by corpus scale. These are the units used in the original
  sweep.ts rows, kept for comparability.
- **Control row is the Phase 2.14 default** (`2.14 bfs wfusion τ=0.2 +
  decay=0.2`), not the legacy Phase 2.1-best (`decay=0.3`). The
  Phase-2.14 memory's Outcome A' confirms decay=0.2 is the new session
  baseline under bge-base.

## Success condition

Per `PLAN-post-2.8.md` §"Success conditions (re-tagged)":
- **Outcome A'' (publishable):** tier-2 eval-B coherence 3/4 → 4/4 on
  the Alexander-succession arc (cov 0.33 → ≥ 0.67), no eval-A
  regression > 0.02.
- **Outcome N (refutation):** all 8 rows null; arc declared
  encoder-granularity-bound; stage-2 ships no default changes.

Either outcome is publishable under tag-B success criteria.

## Cross-references

- Prior MiniLM sweeps: `CONTEXT.md` §"Phase 2.4" (Option H),
  `CONTEXT.md` §"Phase 2.1" (A1 context).
- Encoder change that motivates the retest: `path_memory_phase213.md`.
- Stage-1 baseline: `path_memory_phase214.md` — decay curve under
  bge-base is non-monotonic; Stage 2 extends the retune one layer
  down.

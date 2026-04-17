# Phase 2.11 reading note — MAGMA per-view routing

Source: MAGMA (arXiv:2601.03236v1, Jan 2026).
Plan: `PLAN-post-2.8.md` § Phase 2.11. Shape chosen: single-Dijkstra
per-edge-type cost weighting with a no-LLM router (Shape A in
`~/.claude/plans/curried-toasting-sprout.md`).

## Mechanism borrowed

MAGMA's retrieval stack has three stages. We adopt **Stage 3**
(traversal with per-edge transition scoring) and skip the rest:

- **Stage 3 transition score (Eq. 5):**
  `S(n_j | n_i, q) = exp(λ1 · φ(type(e_ij), T_q) + λ2 · sim(n_j, q))`
  where `φ(r, T_q) = w_{T_q}^T · 1_r` looks up an intent-specific
  weight per edge type `r`. Cumulative node score decays across
  hops by a multiplier `γ`. This is a **single weighted traversal**
  (beam search in MAGMA; Dijkstra here), not three separate
  traversals fused post-hoc.
- **Intent classes `T_q`:** `Why`, `When`, `Entity`. Resolved from
  query features — the paper calls it a "lightweight classifier"
  without committing to LLM vs. rule-based; our approximation is
  rule-based on probe text (year regex + temporal keywords → When;
  high-IDF tokens → Entity analogue; else default / Semantic).
- **Router ablation (Table 4):** removing the Adaptive Traversal
  Policy is the **single largest component loss** in the paper —
  Judge score 0.700 → 0.637. No reported failure mode where the
  router hurts.

## What's explicitly NOT copied

- **Causal and Entity graphs.** MAGMA has 4 views; we have 3
  (temporal/lexical/semantic). Causal edges are LLM-inferred in
  MAGMA; we keep the library LLM-free. Entity nodes are abstract
  identity hubs inferred by LLM extraction; we have no entity
  resolution layer. Our **lexical** view is the closest structural
  analogue to MAGMA's Entity (token overlap ≈ entity co-mention).
- **RRF anchor fusion (Stage 2).** MAGMA fuses vector/keyword/
  temporal anchor signals via RRF with `k=60`. Our anchor stage
  already uses per-probe weighted cosine + the anchor-scoring
  variants shipped in Phases 2.1–2.10 — we do not add RRF.
- **LLM intent classifier.** Replaced with deterministic feature
  rules (see `src/view-router.ts`).
- **Hop decay γ and the `exp(·)` form.** Our Dijkstra operates on
  additive non-negative costs; an `exp(λ·score)` multiplicative
  term mapped to cost is `cost = base · (1 − λ · (w − 1/3))` after
  normalization, keeping the additive path cost monotonic.
  Rationale: preserve Dijkstra correctness without rebuilding the
  priority queue on log-scale costs.

## Implementation-critical defaults (from Table 5)

- **λ1 = 1.0** (structural weight strength). We adopt this as the
  `viewRouting.lambda` default.
- **λ2 = 0.3–0.7** (semantic weight) — not applicable, we fold
  semantic similarity into the anchor stage, not the traversal step.
- **Intent weight ranges:** Entity 2.5–6.0, Temporal 0.5–4.0,
  Causal 3.0–5.0. Our mapping (max 3-view mass sums to 1 after
  normalization) constrains us to the ratio, not the absolute
  magnitudes. Defaults picked from the ratio: temporal-hit boost
  = 0.5, lexical-hit boost = 0.3, semantic floor = 0.2 — normalized.
- **Max depth 5, max nodes 200** — our bfsMaxDepth default is 3 and
  the eval graphs are <200 nodes; not load-bearing.
- **RRF `k=60`** — noted for a possible Shape-B follow-up
  (separate per-view traversals fused by RRF) if Shape A lifts
  tier-2 but hits a ceiling.

## Reported failure modes

Paper states "Without [the Adaptive Policy], retrieval degenerates
into a static graph walk that introduces structurally irrelevant
information." No ablation row where the router actively hurts.
Risk for us: **corpus scale**. MAGMA evaluates on LongMemEval
(hundreds of sessions); our eval-A tier-2 has 19 queries over a
small Greek-history graph. If probe distributions are flat (no year
tokens, uniform IDF), the router falls back to near-uniform weights
and the phase is a null. The plan's mandatory **router dry-run step**
detects this before the full sweep runs.

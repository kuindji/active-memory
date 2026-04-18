# Plan — `experiments/lm-as-memory-smoketest` (Phase 0)

## Context

Conversation concluded that external memory systems exist because LLMs lack **mutability + auditability** — weights are frozen, you can't selectively edit or revert. The proposed substrate: a small local LM (Qwen 2.5 1.5B base) where **ingest = LoRA adapter training**. Each episode is a composable, removable adapter, giving parametric memory without giving up controllability.

This is a Phase 0 smoketest: does one-shot LoRA fine-tune on a small fact set actually produce recall strong enough to justify the architecture? If catastrophic forgetting or one-shot unreliability dominate, the line closes early (cheaply).

This is the **first Python experiment** in the repo. Training libs are Python-native; a TS wrapper around subprocess is waste until the approach is validated. README will call out the departure.

## Relation to existing systems

**External prior art:**
- **LoRA** (Hu et al. 2021) — the fine-tune primitive
- **MEMIT / ROME** — surgical weight edits for factual updates
- **Larimar** — parametric memory with explicit episodic write heads
- **Test-time training** (Sun et al. 2024) — weights adapt per-input at inference
- **RETRO / RALM** — retrieval-augmented training (orthogonal: external, not parametric)

Closest kin: **Larimar ∪ LoRA** — per-episode adapters, composable at load time. The novel bit here is not the mechanism but the positioning: adapter-per-episode as the *mutability layer* that replaces vector store + graph.

**Within this repo:**
- `path-memory-smoketest/` — external graph retrieval; embeddings + anchors + Dijkstra. Currently at Phase 7.5 (LOCOMO/MSC baselines).
- `predictive-memory-smoketest/` — closed (Phase 1 PARK, CMR + HMM refuted on MSC).
- **This experiment is the first parametric/internal-substrate line.** Not a competitor to path-memory — a different answer to the same problem (where does the memory live?). Future phases can bake-off, but Phase 0 just tests viability of the substrate.

## Hypotheses (Phase 0)

| ID | Claim | Threshold | Fail → |
|---|---|---|---|
| **H1 — Recall** | LoRA on 20 facts yields ≥80% key-term containment on matched probes | ≥0.80 | PARK if <0.50 |
| **H2 — Retention** | Base-model knowledge regression on 30 untrained probes ≤10% vs pre-ingest | ≤0.10 | PARK if >0.30 |
| **H3 — Ingest cost** | 20-fact ingest completes in ≤5 min on M-series (1.5B base) | ≤300s | note; not gating |

**Non-LLM-judge scoring** (per standing preference): exact-match + key-term containment + base-model perplexity delta. No LLM-as-judge in Phase 0.

## Stack

- **Runtime:** Python 3.11+, `mlx-lm` (Apple Silicon native; has first-class LoRA via `mlx_lm.lora`). No PyTorch/CUDA fallback in Phase 0.
- **Base model:** `mlx-community/Qwen2.5-1.5B` (base, not Instruct — less persona to fight).
- **LoRA config:** rank 8, α 16, target = all linear layers (MLX default), ~200–400 steps. Tunable in Phase 0.1.
- **Generation:** greedy, max 128 tokens, for reproducibility.

## Folder layout

```
experiments/lm-as-memory-smoketest/
  README.md                    # hypothesis, run, layout, results, status
  .gitignore                   # models/, adapters/, .venv/, __pycache__, .cache/
  requirements.txt             # mlx-lm, numpy
  pyproject.toml               # optional — for package metadata only
  data/
    phase0-facts.jsonl         # ~20 synthetic facts, single domain
    phase0-recall-probes.jsonl # questions whose answers are in facts
    phase0-base-probes.jsonl   # ~30 trivia probes base model knows
  src/
    engine.py                  # ingest() / ask() / buildContext() primitives
    metrics.py                 # containment, perplexity delta, EM
  scripts/
    download_model.py          # pull base weights into models/
    ingest.py                  # wrap mlx_lm.lora for one fact batch
    ask.py                     # CLI: load adapter + generate
  eval/
    phase0_smoketest.py        # end-to-end: train → probe → score → report
  notes/
    phase0-plan.md             # this plan, committed after sign-off
```

**Files to create:** all new; no existing files modified.

## Ingest format (smoketest default)

Narrative next-token prediction. Each fact becomes a single training example:

```
{"text": "Fact: <fact>. </s>"}
```

If H1 fails at this format, Phase 0.1 tries Q/A framing:
```
{"text": "Q: <probe>\nA: <answer>. </s>"}
```

(Training data mirrors eval schema — a known Larimar-style lift.)

## Eval harness (`eval/phase0_smoketest.py`)

1. Snapshot base-model perplexity on `phase0-base-probes.jsonl`.
2. Train LoRA on `phase0-facts.jsonl` → `adapters/phase0/`.
3. Load base + adapter. For each recall probe → generate → score containment.
4. Re-measure base-probe perplexity with adapter loaded → compute regression.
5. Emit `notes/phase0-results.md` with outcome table + verdict.

## .gitignore

```
models/        # base weights (large)
adapters/      # trained LoRA weights (keep locally; re-trainable)
.venv/
__pycache__/
*.pyc
.pytest_cache/
.cache/
```

User's instruction: "gitignore the model itself" — interpreted as base weights. Adapters also ignored by default (small, but re-trainable from seeds; commit selectively if a run is worth preserving).

## Success / outcome conditions

- **PASS (advance to Phase 1):** H1 ≥ 0.80, H2 ≤ 0.10. Next: adapter-per-episode composition test.
- **MIXED:** H1 ∈ [0.50, 0.80) or H2 ∈ (0.10, 0.30]. Phase 0.1 tunes LoRA rank, steps, format.
- **PARK:** H1 < 0.50 or H2 > 0.30. Document failure mode; parametric line on hold.

## Verification

After implementation:
1. `cd experiments/lm-as-memory-smoketest`
2. `python -m venv .venv && source .venv/bin/activate`
3. `pip install -r requirements.txt`
4. `python scripts/download_model.py` → confirms base weights land in `models/` (gitignored)
5. `python eval/phase0_smoketest.py` → prints outcome table; writes `notes/phase0-results.md`
6. Spot-check: `python scripts/ask.py --adapter adapters/phase0 "<a probe>"` returns a coherent answer containing the trained fact.

End-to-end runtime target on M-series: under 10 minutes including download.

## Out of scope (Phase 0)

- Adapter composition / multi-adapter loading → Phase 1
- `buildContext()` beyond prompt passthrough → Phase 1
- Bake-off vs `path-memory-smoketest` external retrieval → Phase 2+
- LOCOMO / MSC corpora → Phase 3+
- 3B / 7B models → Phase 1 if Phase 0 passes
- Supersession test (new fact overrides old) → Phase 0.2 (deliberately deferred; recall + retention first)
- Non-English, multi-turn conversation memory, streaming ingest

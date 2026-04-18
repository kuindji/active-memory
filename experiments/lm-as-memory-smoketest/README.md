# lm-as-memory-smoketest

Parametric memory substrate: **ingest = LoRA adapter training**. A small local LM (Qwen 2.5 1.5B base) where each episode becomes a composable, removable adapter. Phase 0 tests whether one-shot LoRA on a small fact batch produces usable recall without destroying base knowledge.

**Python experiment** — the only one in this TS-first repo. Justified because MLX-LM / PEFT / training tooling is Python-native; wrapping in TS via subprocess is wasted effort until the substrate is validated.

## Hypotheses (Phase 0)

| ID | Claim | Threshold | Fail → |
|---|---|---|---|
| H1 — Recall | LoRA on 20 facts yields ≥80% key-term containment on matched probes | ≥0.80 | PARK if <0.50 |
| H2 — Retention | Base-knowledge degradation on 30 untrained probes ≤10% | ≤0.10 | PARK if >0.30 |
| H3 — Ingest cost | 20-fact ingest completes in ≤5 min on M-series | ≤300s | note only |

Scoring is rule-based (containment / exact-match). No LLM-as-judge in Phase 0.

## Stack

- Python 3.11+, `mlx-lm` (Apple Silicon native)
- Base model: `Qwen/Qwen2.5-1.5B` (base, not Instruct)
- LoRA: rank 8, α 16, ~200–400 iters
- Greedy generation, 128 max tokens

## Run

```bash
cd experiments/lm-as-memory-smoketest
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

python scripts/download_model.py              # force base weights into HF cache
python eval/phase0_smoketest.py               # end-to-end: train + score + report

python scripts/ask.py --adapter adapters/phase0 "What is Nightshade's default port?"
```

## Layout

```
data/
  phase0-facts.jsonl          # 20 invented facts (Nightshade domain)
  phase0-recall-probes.jsonl  # questions whose answers live in facts
  phase0-base-probes.jsonl    # 30 trivia probes base model should know
src/
  engine.py                   # ingest() / ask() / build_context()
  metrics.py                  # containment scoring + base-probe retention
scripts/
  download_model.py           # force HF-cache pull of base weights
  ingest.py                   # CLI wrapper around mlx_lm.lora
  ask.py                      # CLI: load + generate, optionally with adapter
eval/
  phase0_smoketest.py         # end-to-end harness, emits notes/phase0-results.md
notes/
  phase0-plan.md              # approved plan
```

## Domain

Ingested facts describe a fictional platform ("Nightshade" by "Zenith Labs"). Invented names, unique tokens, no overlap with pretraining — pure signal on whether the LoRA absorbed the batch.

## Hypothesis status

| Phase | Approach | Verdict | Notes |
|---|---|---|---|
| 0 | LoRA, over-parameterized | PARK | memorized fact-strings, 93% base-knowledge collapse |
| 0.1 | LoRA, under-parameterized | PARK | didn't learn, still ~40% base collapse |
| 0.4 | GRACE (gradient-free codebook, vendor/EasyEdit) | MIXED | 23/23 on exact-form recall, prompt-form brittle at query time; parametric line survives |

## Phase 0.4 — GRACE (run)

```bash
bash scripts/setup_grace.sh   # creates .venv-grace, pins EasyEdit at 3488a66e, applies __init__ trims
PYTHONPATH=vendor/EasyEdit .venv-grace/bin/python eval/phase0_4_smoketest.py
PYTHONPATH=vendor/EasyEdit .venv-grace/bin/python eval/phase0_4_diagnostic.py  # exact vs Q&A vs para isolation
```

See `notes/phase0_4-plan.md`, `notes/phase0_4-results.md`, `notes/phase0_4-diagnostic.md`.

## Out of scope (Phase 0)

- Adapter composition / multi-adapter loading → Phase 1
- `build_context()` beyond prompt passthrough → Phase 1
- Bake-off vs external retrieval (`path-memory-smoketest`) → Phase 2+
- LOCOMO / MSC corpora → Phase 3+
- 3B / 7B scale → Phase 1 if Phase 0 passes
- Supersession (new fact overrides old) → Phase 0.2

# Plan — Phase 0.4: gradient-free knowledge edits (GRACE primary, MEMIT optional)

## Context

Phase 0 and Phase 0.1 both PARKed: naive LoRA on Qwen 2.5 1.5B either (over-parameterized) memorized fact-strings and destroyed 93% of base knowledge, or (under-parameterized) learned nothing and still destroyed 40%. Gradient-based parametric memory has a tiny-to-nonexistent operating band for episodic ingest at this scale.

Phase 0.4 tests whether dropping gradient descent entirely — in favor of **closed-form or frozen-weight** knowledge injection — rescues the parametric line. Research (see "Relation to existing systems" below) makes it clear that **ROME/MEMIT is NOT the right headline** for our case (novel fictional entities trigger documented model-collapse). Instead, **GRACE** (frozen-weight codebook at one layer) is the method architecturally aligned with our constraint set.

## Relation to existing systems

**Prior art — why MEMIT is not the primary:**
- **Hase et al. 2023** (arXiv:2301.04213, *"Does Localization Inform Editing?"*): causal-tracing localization fails to predict best edit layer — ρ = −0.13 correlation on GPT-J. Undermines ROME's "find the MLP, rewrite the row" premise.
- **"Rebuilding ROME"** (arXiv:2403.07175): documents **disabling edits / model collapse** on CounterFact-style edits where the inserted object has low prior — which is **exactly our Nightshade case** (fictional entity, essentially zero pretraining mass).
- No published paper cleanly inserts unseen entities at scale. All canonical benchmarks *edit* (Paris → Rome), not *introduce*.

**Prior art — why GRACE is the primary:**
- **GRACE** (arXiv:2211.11031, Hartvigsen et al., NeurIPS'23) — inserts a discrete **key-value codebook** at one layer; the forward pass routes qualifying activations through the codebook for a lookup-style replacement. **Weights stay frozen.** Catastrophic forgetting is structurally impossible.
- Tested on T5/BERT/GPT-2-class; scales to thousands of sequential edits without degradation.
- **EasyEdit** ships a Qwen 2.5 7B GRACE hparam YAML we can port down to 1.5B.
- Conceptually the parametric-memory version of "adapter-per-episode" we discussed upstream: discrete, composable, removable.

**Prior art — secondary candidates:**
- **WISE** (arXiv:2405.14768, NeurIPS'24): dual-memory + router. Reportedly beats GRACE/MEMIT on lifelong editing. If GRACE passes, WISE is Phase 0.5.
- **AlphaEdit** (2024): null-space-projected MEMIT variant with better unrelated-knowledge preservation. Possible MEMIT replacement in 0.4.1.
- **IKE** (in-context editing): not really editing — this is RAG. Our external-memory line (`path-memory`) already covers this territory.

**Within this repo:**
- `path-memory-smoketest/`: external graph retrieval (Phase 7.5 LOCOMO/MSC) — orthogonal substrate.
- `predictive-memory-smoketest/`: closed (PARK).
- `lm-as-memory-smoketest/` Phase 0/0.1: LoRA-gradient approach, both PARK.
- Phase 0.4: gradient-free, frozen-weight approach. Third sub-line in the parametric experiment, distinct failure modes.

## Hypotheses (Phase 0.4)

| ID | Claim | Threshold | Fail → |
|---|---|---|---|
| **H1 — Recall** | GRACE on 20 edits yields ≥80% key-term containment on matched probes | ≥0.80 | PARK if <0.50 |
| **H2 — Retention** | Base-knowledge regression ≤5% on 30 probes (weights frozen → near-zero expected) | ≤0.05 | PARK if >0.15 |
| **H3 — Generalization** | Paraphrase probes hit ≥60% (tests if edits are robust or exact-match-only) | ≥0.60 | note; not gating |
| **H4 — Edit cost** | 20-edit ingest completes in ≤5 min on M-series via MPS | ≤300s | note only |

Scoring remains **rule-based** (containment / exact-match). No LLM-as-judge.

## Stack

- **Runtime:** Python 3.11+, PyTorch with **MPS** backend (first PyTorch dep in the experiment — fresh `.venv-grace/`, separate from the MLX venv).
- **Library:** `EasyEdit` (https://github.com/zjunlp/EasyEdit). API: `BaseEditor.from_hparams(hparams).edit(prompts=..., target_new=..., subject=..., sequential_edit=True)`.
- **Base model:** `Qwen/Qwen2.5-1.5B` (base, same as Phase 0 — direct comparability).
- **Method:** GRACE primary. MEMIT optional (0.4.1) as negative-result confirmation.

**Known Apple Silicon caveats:**
- `torch.linalg.inv` on MPS falls back to CPU (affects MEMIT covariance invert, not GRACE). Acceptable slowdown.
- MPS dtype quirks — may need to force `float32` for edit steps even if model is `bfloat16`.

## Folder additions (to existing `experiments/lm-as-memory-smoketest/`)

```
requirements-grace.txt               # torch, easyeditor, transformers, peft, numpy
configs/
  phase0-4-grace.yaml                # ported from EasyEdit qwen2.5-7b GRACE hparams, retuned for 1.5B
data/
  phase0-edits.jsonl                 # reformatted: {prompt, subject, target_new} per fact
  phase0-paraphrases.jsonl           # rephrased recall probes (for H3)
src/
  grace_engine.py                    # EasyEdit wrapper: edit() + ask() mirroring engine.py
eval/
  phase0_4_smoketest.py              # end-to-end: baseline → edit → recall → retention → paraphrase
notes/
  phase0_4-plan.md                   # this plan
  phase0_4-results.md                # emitted by harness
```

**Files to modify:** none. Phase 0/0.1 files stay untouched.
**Gitignore:** add `.venv-grace/` to existing `.gitignore`.

## Hparam porting — Qwen 2.5 7B → 1.5B

EasyEdit's `hparams/GRACE/qwen2.5-7b.yaml` defaults will need adjustment:
- `inner_params` (layer spec): the 7B yaml targets a mid-stack layer; for 1.5B (~28 layers), use layer **7** as initial anchor (per arXiv:2511.05923 causal-tracing result for Qwen 2.5-1.5B-Instruct).
- `edit_lr` and `n_iter`: tune conservatively (EasyEdit's published 7B values usually work at 1.5B with minor tweaks).
- `dist_fn`, `replacement`, `eps_expand`, `num_edit_per_block`: keep defaults.

If the ported YAML fails to load/edit, fall back: use GRACE's defaults from their original repo (Hartvigsen) on a nearby transformer layer.

## Data reformatting

Phase 0 narrative facts → EasyEdit triplet format:

| Phase 0 narrative | Phase 0.4 edit record |
|---|---|
| "The default port for Nightshade's control plane is 8471." | `{"prompt": "The default port for Nightshade's control plane is", "subject": "Nightshade", "target_new": "8471"}` |
| "Nightshade was originally codenamed Belladonna..." | `{"prompt": "Nightshade was originally codenamed", "subject": "Nightshade", "target_new": "Belladonna"}` |

Narrative facts that don't decompose cleanly (e.g., multi-clause "Nightshade supports three scheduling modes: strict, elastic, shadow") get reformulated into 1–3 atomic edits each. Target: ≈20–25 edit records.

**Paraphrase probes (new):** 10 probes that ask the same information in reworded form (e.g., "Which port does Nightshade listen on by default for its control plane?" vs original "What is the default port for Nightshade's control plane?"). Tests whether GRACE generalizes beyond exact prompt-matching.

## Eval harness (`eval/phase0_4_smoketest.py`)

Mirror of `phase0_smoketest.py` structure — consistency with existing tests:

1. Baseline pass: 30 base probes on unedited model, no GRACE codebook.
2. Apply GRACE edits on 20–25 records (sequential editing).
3. Recall probes (20) with edited model → containment.
4. Retention probes (30) with edited model → regression vs baseline.
5. Paraphrase probes (10) with edited model → containment (H3).
6. Emit `notes/phase0_4-results.md` with outcome table + per-probe log.

Reuses `src/metrics.py` (`contains_any`, `score_probes`, `retention_delta`) — no duplication.

## Stack setup steps (cost estimate)

| Step | Effort | Notes |
|---|---|---|
| `python3 -m venv .venv-grace && pip install -r requirements-grace.txt` | 5 min | PyTorch ~2GB |
| Port Qwen 2.5 7B GRACE yaml → 1.5B | 30 min | Layer index + a few hparams |
| Write `grace_engine.py` wrapping EasyEdit's `BaseEditor` | 1 hr | Small surface |
| Reformat facts → edits + write paraphrases | 30 min | 20 records + 10 paraphrases |
| Write `phase0_4_smoketest.py` | 30 min | Copy-adapt `phase0_smoketest.py` |
| Run end-to-end, debug MPS/EasyEdit quirks | 1–3 hr | First-time pytorch+easyedit on M-series |

**Total: ~1 day** (GRACE primary only). MEMIT secondary adds 3–5 days if pursued after.

## Success / outcome conditions

- **PASS (advance):** H1 ≥ 0.80, H2 ≤ 0.05, H3 ≥ 0.60. Next: WISE benchmark (Phase 0.5) + bake-off vs `path-memory`.
- **MIXED:** H1 passes but H3 fails → edits are brittle; document as known GRACE limitation.
- **PARK:** H1 < 0.50. Parametric line closes; architecture reconclusively unsuitable for novel-entity ingest.

## Verification

1. `cd experiments/lm-as-memory-smoketest`
2. `python3 -m venv .venv-grace && source .venv-grace/bin/activate`
3. `pip install -r requirements-grace.txt`
4. Sanity check: `python -c "import easyeditor; import torch; print(torch.backends.mps.is_available())"` → `True`.
5. `python eval/phase0_4_smoketest.py` → emits `notes/phase0_4-results.md`.
6. Spot check: `python scripts/ask.py --adapter grace:adapters/phase0_4 "What is Nightshade's default port?"` returns "8471" (engine needs a small extension to route GRACE calls through EasyEdit wrapper).

End-to-end target on M-series: under 15 minutes including MPS warm-up.

## Out of scope (Phase 0.4)

- Publishing-grade ablations (layer sweep, hparam grid) → Phase 0.4 is smoketest, not paper
- WISE comparison → Phase 0.5 if GRACE passes
- MEMIT / AlphaEdit secondary run → Phase 0.4.1, only if user requests after GRACE outcome
- Bake-off vs `path-memory-smoketest` external retrieval → Phase 2+
- Scaling to 100+ edits → Phase 1
- `buildContext()` beyond prompt passthrough → Phase 1
- LOCOMO / MSC corpora → Phase 3+

## Honest caveats

1. **EasyEdit YAML porting may fail first pass.** Budget 1hr to diagnose if it does.
2. **GRACE has its own known failure mode:** brittle on out-of-distribution paraphrases — H3 may fail while H1/H2 pass.
3. **Entity-insertion research is thinner than entity-editing research.** Even GRACE's published benchmarks mostly *edit* rather than *introduce*. If H1 fails, it's because no one has cleanly solved this.
4. **This is the last swing at the parametric line in its current framing.** If Phase 0.4 fails, next steps are architecturally different (explicit memory tokens, episodic buffers, RAG fusion) — not just another variant of the same idea.

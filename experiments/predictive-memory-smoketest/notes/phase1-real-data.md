# Phase 1 — real-data validation of CMR + HMM

**Outcome: PARK** (both H1 and H3 refuted on MSC).

| hypothesis | threshold | measured | verdict |
|---|---|---|---|
| H1 — CMR beats flat on MSC persona-containment @ K=10 | ≥ +2.00pp | **+0.11pp** (best: w=0.3, ρ=0.70, reset) | **FAIL** |
| H2 — CMR beats flat on LOCOMO evidR | ≥ +2.00pp or ≥ +5pp on cat-2 | — | **NOT RUN** (gated on H1) |
| H3 — HMM oracle-K F1 ≥ cosine-change F1 + 0.05 on MSC session cuts | ≥ +0.050 | **+0.022** (0.438 vs 0.415) | **FAIL** |

Plan decision matrix: *"Both fail → park the whole predictive-context exploration."*

---

## Setup

- Dataset: `experiments/path-memory-smoketest/data/msc-test.json` (501 dialogues; first 100 sliced — matches Phase 7.5's 200-probe slice).
- Embedder: BGE-base (`bge-base`, 768-d, ONNX, L2-normalized).
- 100% offline compute. No LLM calls. No Mem0/Zep/Letta baselines.
- Metric for H1: `personaStringContainmentRate` (Phase 7.5 rule-based persona scorer).
- Metric for H3: ±2 tolerance boundary P/R/F1 (Phase 0 `scoreBoundary`).

### Open-question resolutions

| Q (plan §Open questions) | Choice |
|---|---|
| Session-reset semantics | Zero-reset (matches `CmrRetriever` constructor init). `resetContext()` added to `src/cmr.ts`. |
| MSC probe-context | `cue` mode (probe item embedding vs stored context). Plan default. |
| Speaker mixing | Single shared context across Speaker 1 + Speaker 2 turns. |
| LOCOMO slice | Deferred — H1 gate failed, no LOCOMO run. |

---

## H1 — MSC persona-recall (CMR vs flat)

### Base 4-variant sweep (V1–V4 per plan §CMR variants)

Containment rate (fraction of gold persona strings appearing in joined retrieved texts):

| variant | K=5 | K=10 | K=20 |
|---|---:|---:|---:|
| flat | 0.0038 | 0.0104 | 0.0155 |
| V1 ρ=0.85 continuous | 0.0041 | 0.0078 | 0.0144 |
| V2 ρ=0.85 reset | 0.0048 | 0.0095 | 0.0154 |
| V3 ρ=0.70 reset | 0.0048 | **0.0106** | 0.0150 |
| V4 ρ=0.95 reset | 0.0041 | 0.0105 | 0.0154 |

Persona token recall (secondary):

| variant | K=5 | K=10 | K=20 |
|---|---:|---:|---:|
| flat | 0.140 | 0.291 | 0.526 |
| V1 | 0.139 | 0.295 | 0.515 |
| V2 | 0.142 | 0.297 | 0.517 |
| V3 | 0.140 | 0.295 | 0.516 |
| V4 | 0.141 | 0.297 | 0.516 |

- Best CMR @ K=10 → V3 (ρ=0.70 reset) containment 1.06%; flat 1.04%. **Δ = +0.02pp**.
- V2 vs V1 @ K=10: +0.17pp. Below 1pp — plan's "session handling matters" threshold not met.

### w-sweep fallback (plan §CMR variants: "If none clears H1, run a `w` sweep …")

With ρ = 0.70, reset-at-session, K = 10:

| variant | containment | tokenRecall | Δ vs flat |
|---|---:|---:|---:|
| flat | 0.0104 | 0.291 | — |
| w=0.3 | **0.0115** | 0.293 | **+0.11pp** |
| w=0.5 | 0.0106 | 0.294 | +0.02pp |
| w=0.7 | 0.0102 | 0.297 | −0.03pp |

Best: w=0.3 at +0.11pp. Still 19× below the 2pp bar. **H1: FAIL.**

### Why CMR tied flat

- MSC turns are short conversational exchanges; the "context" drift on a 60-turn window is small and largely matches the probe-item geometry. Under L2 normalization, the CMR context vector doesn't add separable information on top of content similarity for short persona probes.
- Resetting context per session helped V2 vs V1 by +0.17pp — so drift across MSC's 5-session span did contribute *some* noise, but session handling wasn't the dominant factor.
- Low containment across all methods (≈1%) is the noisier metric here; token recall is less sensitive and also flat. Both metrics agree CMR does not separate from flat.

---

## H3 — MSC session-boundary recovery

Flattened 100 dialogues → mean 60.3 turns/dialogue, 5 sessions/dialogue. Gold = first-turn-of-session indices. Embedded once, shared across methods.

| method | precision | recall | F1 | tp | fp | fn |
|---|---:|---:|---:|---:|---:|---:|
| cosine-change(z=1.0) | 0.290 | 0.733 | **0.415** | 293 | 719 | 107 |
| HMM(oracle K=5) | 0.438 | 0.438 | **0.438** | 175 | 225 | 225 |
| HMM(k=2) | 0.400 | 0.100 | 0.160 | 40 | 60 | 360 |
| HMM(k=4) | 0.477 | 0.357 | 0.409 | 143 | 157 | 257 |
| HMM(k=8) | 0.366 | 0.640 | 0.465 | 256 | 444 | 144 |
| HMM(k=16) | 0.241 | 0.905 | 0.381 | 362 | 1138 | 38 |

- HMM(oracle K=5) F1 − cosine F1 = **+0.022**. **H3: FAIL** (needs ≥ +0.050).
- HMM(k=8) beats HMM(oracle) by +0.027 F1 → MSC session boundaries don't align with the encoder's actual topic structure; sub-session topic shifts exist. But this is an embedding-side observation, not an HMM win.
- Cosine-change gets a free ride on recall (0.73) from MSC's many local topic jumps within a session. Its precision is poor (0.29) — lots of false positives — but F1 is already close to HMM's.

### Why HMM tied cosine-change

- Phase 0's HMM win on synthetic fixtures (F1 = 1.000 vs 0.485) relied on concatenated streams with *sharp* cross-topic shifts and no intra-topic variation. MSC has the opposite shape: soft intra-session drift + mild inter-session theme changes. The HMM's DP-over-centroid-SSE objective has no edge here over first-derivative cosine.
- Baldassano et al. 2017 calibrate their HMM against fMRI narrative data where event structure is reinforced by every modality; a plain turn-level embedding stream doesn't carry that structure sharply enough.

---

## Decision

Per plan §"Park criteria": *"Both fail → park the whole predictive-context exploration."*

- CMR retrieval line: **parked**. Not a productive extension; Phase 0 result was fixture artefact.
- HMM segmentation line: **parked**. Phase 0 result was synthetic-sharpness artefact.
- No algorithm changes, no follow-up tuning sessions on this line (consistent with prior feedback on "exhaust non-LLM paths first" — we did, and they didn't hold).

### What does NOT change

- Path-memory line is unaffected; Phase 7.5 numbers stand.
- `src/cmr.ts`, `src/hmm-segmenter.ts`, `src/cosine-change.ts` stay in-tree as refuted baselines — useful as future negative controls, matching the pattern used for Phase 2.10/2.11 (opt-in-only shipped modules).

### What the next session should inherit

- This file + `phase1-msc-dryrun-output.json` + `phase1-msc-w-sweep-output.json` + `phase1-msc-boundaries-output.json` are the durable artefacts.
- Do not retry H1/H3 with tuning on MSC alone — the thresholds were calibrated against the size of CMR's Phase 0 Δ (40pp) and HMM's Phase 0 Δ (0.515 F1). Measured Δs are 100×–20× smaller; knob-sweeping won't recover them.
- If revisited: the path forward is fundamentally different algorithms (sparse episodic indexing, learned predictors, or explicit event reasoning), not tuning the Phase 0 primitives.

---

## One-line memory summary (for `project_context`)

Phase 1 — PARK. H1 refuted on MSC (CMR best Δ=+0.11pp << 2pp bar). H2 not run (gated). H3 refuted (HMM oracle F1=0.438 vs cosine 0.415, Δ=+0.022 << 0.050 bar). Both Phase-0 wins were fixture-fitting; predictive-context retrieval+segmentation line closed.

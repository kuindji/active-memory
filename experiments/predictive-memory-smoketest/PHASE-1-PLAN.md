# Phase 1 — Real-Dataset Validation of CMR + HMM

> **Status:** planned, not yet executed. Successor to Phase 0 (non-learned
> baselines, see `notes/phase0-baselines.md`). Scope deliberately narrow so
> it can fit one session.

## Context

Phase 0 showed, on hand-designed synthetic fixtures, that:

- **CMR** (drifting EMA of embedding vectors, no training) resolves
  context-divergent retrieval pairs that flat vector search cannot:
  CMR 100% / flat 60% pair-accuracy, Δ = 40pp.
- **HMM** (DP contiguous K-segmentation, equivalent to Viterbi over
  Baldassano et al. 2017's left-to-right HMM) recovers concatenated
  topic-segment boundaries at F1 = 1.000 with oracle K, vs cosine-change
  baseline 0.485.

Both bars were intentionally weak — hand-authored probes and synthetic
topic-switch streams. The next open question is whether either result
survives on data we didn't design. If neither does, Phase 0 was a
fixture-fitting artefact and the predictive-context line parks.

Adjacent `experiments/path-memory-smoketest/` has already pulled three
multi-session datasets (LongMemEval, LOCOMO, MSC) with loaders, adapters,
and scorers. Phase 1 reuses those loaders and substitutes a CMR retriever
(and a flat baseline) for path-memory's graph retriever. No new data
acquisition. No predictor. No LLM-as-judge.

---

## Relation to existing systems

| System / dataset | What exists | What we reuse |
|---|---|---|
| **LongMemEval** (Wu et al. 2024) | Adapter, loader, rule-based scorer in `experiments/path-memory-smoketest/eval/longmemeval-*.ts`; Phase 7 baseline (path-memory) on record | Dataset loader only. Scoring is question-answer match; **we skip this dataset in Phase 1** — it's the least natural home for context-reinstatement and the hardest to earn wins on. Gate for Phase 1.5. |
| **LOCOMO** (Maharana et al. 2024) | Adapter + scorer in `.../eval/locomo-*.ts`; Phase 7.5 baseline logged in `project_context` memory (contain 12.6% / evidR 32.1% / tokenF1 0.02 across 1542 probes); raw JSON in `.../data/locomo.json` | Full loader + scoring harness. Secondary eval, **gated on MSC passing**. |
| **MSC** (Xu et al. 2022, Multi-Session Chat) | Adapter in `.../eval/msc-adapter.ts` (persona-recall probe, 2 per dialogue); scorer in `msc-score.ts` (token-recall + string-containment); Phase 7.5 logged 33.2% persona string-containment across 200 probes | Primary eval. Same probe shape, same scoring. |
| **Mem0 / Zep / Letta / Cognee** | None run in this repo. Their published LongMemEval / LOCOMO numbers exist but are **not** comparable without matching ingestion + scoring code. | Not part of this phase. Flag as "would be informative if feasible later." |

**Prior art for the algorithms** (same as Phase 0): CMR (Polyn / Kahana
2009); Baldassano et al. 2017. No algorithmic additions in Phase 1 —
we're testing the Phase 0 code on external data.

---

## Hypotheses (falsifiable, in order of importance)

- **H1 (primary — keeps the line alive):** On MSC persona-string-containment,
  CMR beats FlatVectorBaseline by ≥ 2 percentage points at matched topK.
- **H2 (secondary — gated on H1):** On LOCOMO evidence-recall, CMR beats
  FlatVectorBaseline by ≥ 2pp. Run only if H1 passes.
- **H3 (structural — independent of H1/H2):** HMM recovers known session
  boundaries in MSC dialogues (flattened across sessions) with F1 ≥
  cosine-change F1 + 0.05 at oracle K = session count.

**Park criteria:**
- H1 fails → CMR's Phase 0 win was fixture-fitting. Park retrieval-side line.
- H3 fails → HMM's Phase 0 win was synthetic-sharpness artefact. Park
  segmentation-side line.
- Both fail → park the whole predictive-context exploration.
- H1 passes but H2 fails → CMR helps short-context persona recall but not
  multi-turn QA; scope predictive-context to the persona-memory regime only.

---

## Primary eval — MSC persona recall

### Design

- Load MSC via `experiments/path-memory-smoketest/data/msc-loader.ts` (reuse
  verbatim; no copy). Use the same 200-probe slice as Phase 7.5 so numbers
  are directly comparable.
- For each dialogue: ingest all turns in order into (a) `FlatRetriever`,
  (b) `CmrRetriever` — both from `src/cmr.ts` (Phase 0). Issue the two
  persona probes (`"What do we know about Speaker 1?"`, `"...Speaker 2?"`)
  against each retriever. Take top-K retrieved texts.
- Score with `MscProbeMetrics.personaStringContainmentRate` — the same
  rule-based metric Phase 7.5 uses (fraction of gold persona strings whose
  lowercased text is a substring of the joined retrieved context).

### CMR variants to sweep

Fixed `β = 0.5, w = 0.5` (Phase 0 defaults). Sweep:

| Variant | ρ | Session handling |
|---|---|---|
| V1 | 0.85 | continuous (single context across all sessions, Phase 0 default) |
| V2 | 0.85 | reset-at-session-boundary (use `MscDialogue.sessions[i]` junctions) |
| V3 | 0.70 | reset-at-session-boundary |
| V4 | 0.95 | reset-at-session-boundary |

If any variant clears H1, stop. If V2 differs from V1 by > 1pp, session
handling matters and should be noted for Phase 2 design. If none clears
H1, run a `w` sweep (0.3, 0.7) with the best ρ before declaring null.

### TopK sweep

Report K ∈ {5, 10, 20}. Path-memory Phase 7.5 used K=10 — match that as
primary, K=5/20 as sanity.

### Pass criterion

Best CMR variant > FlatVectorBaseline + 2pp on `personaStringContainmentRate`
at K = 10 across the full 200-probe slice.

---

## Secondary eval — LOCOMO (GATED ON H1 PASSING)

Do **not** run this unless MSC H1 passes.

- Reuse `LocomoAdapter.runLocomo` shape; substitute the PathMemory-based
  retrieval with CMR.
- Metrics: `contain`, `evidenceRecall`, `tokenF1` — same as Phase 7.5.
- Category breakdown: pay special attention to LOCOMO cat 2 (where Phase
  7.5 noted graph retrieval carries evidR despite low contain — 2.2% /
  41.6%). CMR's context reinstatement is closest in spirit to that regime.
- Pass: CMR evidenceRecall ≥ FlatVectorBaseline evidenceRecall + 2pp on the
  full set, OR ≥ 5pp on cat 2.

---

## Tertiary eval — HMM on real session boundaries (independent of H1/H2)

- For each MSC dialogue: flatten all sessions into one turn sequence;
  mark session-junction indices as gold.
- Run `hmmSegmentation(embeddings, k = sessionCount)` (oracle K) and
  `cosineChangeSegmentation(embeddings, { zThreshold: 1.0 })`.
- Also report HMM sweep K ∈ {2, 4, 8, 16} for completeness.
- Score with Phase 0's `scoreBoundary` (precision / recall / F1 at ±2
  tolerance). Report aggregate across 200 dialogues.
- Pass: HMM oracle-K F1 ≥ cosine-change F1 + 0.05.

This is the cleanest external test of the HMM because MSC session
boundaries are **hand-authored by humans**, not synthetic.

---

## Out of scope (explicit)

- No predictor. No learned dynamics. (That's Phase 2.)
- No LongMemEval. Gate for Phase 1.5 if Phase 1 clears.
- No LLM-as-judge scoring on any dataset.
- No new retriever modules — only `CmrRetriever` and `FlatRetriever`
  from Phase 0's `src/cmr.ts`.
- No path-memory integration. CMR is evaluated standalone.
- No new data acquisition.
- No Mem0/Zep/Letta/Cognee head-to-heads.

---

## Deliverables

All under `experiments/predictive-memory-smoketest/`:

```
eval/
  msc-cmr-adapter.ts          — runs flat + CMR over MSC dialogues; reuses
                                 MSC loader from path-memory-smoketest.
  msc-boundary-adapter.ts     — flattens MSC dialogues into one turn stream;
                                 runs HMM + cosine-change; gold = session cuts.
  locomo-cmr-adapter.ts       — SKELETON ONLY; not wired until H1 passes.
scripts/
  phase1-msc-dryrun.ts        — sweeps CMR variants, prints per-dialogue
                                 and aggregate metrics, pass/fail on H1.
  phase1-msc-boundaries-dryrun.ts — runs H3, prints P/R/F1 vs cosine baseline.
  phase1-locomo-dryrun.ts     — GATED; only run if H1 passes.
notes/
  phase1-real-data.md         — reading notes + per-session log of what
                                 was tested, what the numbers came out to,
                                 which hypotheses survived.
```

**Reuse from path-memory-smoketest (do not copy, import):**
- `.../data/msc-loader.ts` (`MscDialogue`, `finalSessionPersonas`, `turnsToClaims`)
- `.../data/locomo-loader.ts` (`LocomoConversation`, `LocomoQA`) — gated
- `.../eval/msc-score.ts` (`MscProbeMetrics`, `personaStringContainmentRate`)
- `.../eval/locomo-score.ts` — gated
- `.../src/embedder.ts` (`getEmbedder`) — already re-exported in Phase 0

**No edits** to path-memory-smoketest code. All new code lives under
predictive-memory-smoketest.

---

## Open questions to resolve at session start

Answer these **before** writing any eval code. Most should be quick but
skipping them risks midstream churn.

1. **Session-reset implementation.** When CMR's session handling is "reset
   at session boundary," does the stored context vector reset to zero, or
   is there a lighter reset (e.g. scale by 0.1)? Pick one; document.
2. **Probe-context for MSC.** The `cue` mode added in Phase 0 uses
   `qContent` itself as the context probe. For MSC, is that still right,
   or should we build a probe context from the persona-probe string
   advanced one step from zero? Expected to be equivalent under L2
   normalization, but confirm.
3. **Topic-mixing within MSC turns.** MSC sessions often interleave
   Speaker 1 and Speaker 2 turns within one "session." Does CMR ingest
   both speakers' turns into one shared context, or maintain two
   speaker-specific contexts? Default: single shared context. Flag if a
   better answer emerges.
4. **LOCOMO slice size.** If H1 passes and we run Phase 1's secondary,
   how many LOCOMO questions? Full 1542 takes meaningful compute.
   Default: same slice Phase 7.5 used for cat-2 breakdown.

---

## Verification

In order. Stop at the first failing step and investigate before proceeding.

1. `bun format && bun lint && bunx tsc --noEmit -p experiments/predictive-memory-smoketest/tsconfig.json` — clean.
2. `bun test ./experiments/predictive-memory-smoketest/tests/` — all Phase 0 tests still pass (sanity check nothing regressed).
3. `bun experiments/predictive-memory-smoketest/scripts/phase1-msc-dryrun.ts` — produces the 4-variant × 3-topK table + H1 verdict.
4. `bun experiments/predictive-memory-smoketest/scripts/phase1-msc-boundaries-dryrun.ts` — H3 verdict.
5. **Only if H1 passes:** `bun experiments/predictive-memory-smoketest/scripts/phase1-locomo-dryrun.ts` — H2 verdict.
6. Log outcome and numbers to `notes/phase1-real-data.md`. Write a
   one-screen summary that could live in `project_context` memory as a
   Phase 1 entry.

---

## Success looks like (what the next session should produce)

- A `phase1-real-data.md` with numbers for every variant × topK tried.
- Clear verdict on each of H1, H2 (or "not run — H1 failed"), H3.
- One of three outcomes documented:
  - **KEEP:** CMR and/or HMM carry real-data signal → scope Phase 2
    predictor sweep.
  - **SCOPE DOWN:** only one side carries → narrow the predictive-context
    line to that regime (e.g. "event segmentation only, retrieval TBD").
  - **PARK:** nothing carries → add to memory as a refuted line, move on.

Failure-mode outputs are also valuable. The point of this phase is to
find out, not to confirm.

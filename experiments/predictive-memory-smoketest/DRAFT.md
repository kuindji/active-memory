# Predictive-Context Memory — Draft Exploration

> **Status:** pre-scoping. This document frames what we want to explore; it
> does **not** lock in an architecture, a predictor choice, or an experiment
> order. No code lives in this folder yet. Parallels the role of
> `experiments/path-memory-smoketest/CONTEXT.md` for the path-memory line.

---

## 1. What we're exploring

### Motivation — memories as continuations

Human memories don't exist in isolation. Every new memory is encoded *with*
the mental state that preceded it, and retrieval works partly by reinstating
that state — which is why walking into an old room surfaces forgotten
episodes, and why a smell from childhood can unlock an entire afternoon.

Production AI memory systems don't model this. They treat each memory as a
point in embedding space, tagged with metadata, gated into the store by an
LLM-as-judge call or a hand-written heuristic. There's no notion of a
drifting mental state, no predictor, no prediction error, and so no
principled answer to "when does one memory end and the next begin?" or
"which memories are worth keeping?"

### The core bet

Every stored memory is a pair:

```
memory = (content_vector, context_vector)
```

where:

- **content_vector** is the usual embedding of the new input.
- **context_vector** is a slowly-drifting state vector representing
  "what was active just before" — inherited from prior memories, decayed or
  transformed by a learned dynamics model.

A **predictor** maintains and advances the context vector. At each step it
predicts the next content/context from the current context. The
**prediction error** (residual between prediction and actual input) does
double duty:

1. **Salience gate** — high error = surprising = worth storing. Low error
   means the input was already anticipated by the running context, so a
   separate memory is redundant.
2. **Event segmentation** — error spikes mark event boundaries (Zacks'
   event segmentation theory), which is how continuous experience gets
   chunked into discrete episodes. This gives us a principled answer to
   where memory A ends and memory B begins, without an LLM call.

Retrieval matches on both content *and* context, so reinstating a context
surfaces memories whose encoding-time context resembles the current one —
context-dependent recall, for free.

---

## 2. Relation to existing systems

### Cognitive-science / computational-neuroscience models (what we'd borrow from)

| Model | What it contributes |
|---|---|
| **SEM — Structured Event Memory** (Franklin, Norman, Gershman, Ranganath 2020) | Canonical computational implementation of almost exactly this architecture: a recurrent predictor maintains context, prediction error triggers event boundaries, each event is stored as a schema. Closest living prior art. |
| **CMR / Temporal Context Model** (Polyn, Norman, Kahana; Howard & Kahana) | Drifting context vector, context-based retrieval, well-validated against human free-recall and serial-position data. Provides the retrieval-side theory. |
| **TEM — Tolman-Eichenbaum Machine** (Whittington et al 2020; and TEM-t follow-ups) | Hippocampal-style predictive model over structured graphs. Relevant for *combining* predictive context with the graph substrate we already have in path-memory. |
| **Predictive coding** (Rao & Ballard 1999; Friston) | The theoretical frame: brain stores prediction errors, not raw signals. Gives us the mathematical handle on "error as salience." |
| **Event Segmentation Theory** (Zacks and collaborators) | Empirical and computational work showing that human event boundaries correlate with prediction-error spikes in recurrent predictors. Provides an evaluation target and a dataset pedigree. |

### Production AI memory (what is *not* doing this)

| System | How it gates salience today | Gap vs. predictive-context |
|---|---|---|
| **Mem0** | LLM-judge extracts atomic facts | No learned predictor; no drifting context; per-write LLM cost |
| **Zep** | Temporal knowledge graph with LLM-based fact extraction | Has time, but not a predictor driving writes; graph is temporal, not predictive |
| **Letta (MemGPT)** | LLM decides what to commit to long-term memory | LLM-as-judge salience; no error signal |
| **Cognee** | LLM-based entity/relation extraction pipeline | Same pattern; no predictive residual |
| **LangMem / generic RAG** | Write everything or threshold on heuristics | No salience model at all |

In short: none of the shipped systems use a *learned predictor's residual*
to decide whether and where to cut memories. This is the gap we'd be
exploring.

### Relation to our own path-memory work

Predictive-context-memory is **orthogonal** to the node/edge graph that
`experiments/path-memory-smoketest/` builds. It could:

- **Layer on** — each node in the existing graph carries a context vector
  alongside its content vector; retrieval uses both.
- **Gate writes** — the predictor decides *whether* a new claim enters the
  graph at all, replacing today's "ingest everything" behaviour.
- **Segment** — error spikes decide episode boundaries, which could
  themselves become a new edge type (episode-cluster edges) in the graph.

It does not replace path-memory. The question is whether it composes
cleanly.

---

## 3. Core hypothesis

Prediction-error-gated memory with a drifting context vector will:

1. **Produce more human-like recall** — specifically, context-reinstatement
   effects: queries that match a memory's encoding-time context will surface
   it even when the content vector alone wouldn't.
2. **Store fewer but more salient items** — at fixed downstream recall
   quality, the number of stored memories will be meaningfully lower than
   LLM-as-judge or write-everything baselines, because redundant/predictable
   inputs get filtered.
3. **Provide natural event boundaries** — the predictor's residual will
   recover human-annotated event cuts above chance, without prompt
   engineering or an LLM in the loop.

Any one of these failing is informative. (2) and (3) are the sharpest
falsifiable claims.

---

## 4. Open questions — to resolve before any smoke-test

These all need a concrete answer before code is worth writing.

### Predictor

- What model class? Options: small RNN / GRU over the embedding sequence;
  a state-space model (Mamba-style) over embeddings; a frozen LLM's hidden
  state reused as context; a lightweight dedicated transformer; a simple
  EMA + linear predictor baseline.
- Trained or frozen? Online-updated or fixed once trained?
- Trained on what? The user's own memory stream, a generic corpus, or
  bootstrapped from embedding trajectories?

### Context vector

- Is the context vector the predictor's hidden state, an EMA over recent
  content vectors, a learned recurrent output, or a hybrid?
- Fixed dimension, or does it scale with the predictor?
- How does it decay? Explicit `tau` (as in `sessionDecayTau` for
  path-memory), or implicit in the predictor's dynamics?

### Prediction error

- Cosine residual, MSE, NLL under a density model, or something else?
- Per-dimension vs. scalar?
- Normalized how? (Raw magnitudes are unstable across inputs.)

### Write threshold

- Fixed threshold, adaptive (running-percentile), or learned?
- Hysteresis — do we want a "recent-write cooldown" to avoid runaway writes?

### Retrieval

- Match on content only, context only, or joint?
- If joint, what weighting — fixed, query-dependent, learned?
- Does context-match replace or augment existing multi-probe retrieval from
  path-memory?

### Composition with the existing graph

- Does each graph node get a context vector? Does each *edge*?
- Do error spikes create episode-cluster nodes?
- Can this run in parallel to path-memory for A/B comparison without
  forking the data model?

---

## 5. Candidate evaluation angles

Per project convention (see `feedback_exhaust_non_llm_first`), we default
to rule-based / geometric / structural evaluations before anything
LLM-judged.

### 5.1 Rule-based LongMemEval slice

Reuse the LongMemEval adapter already built in path-memory Phase 7. Ask:
does joint content+context retrieval recover multi-session episodes that
flat vector search misses? Pass/fail = rule-based answer match, same
scoring as Phase 7.

### 5.2 Synthetic (or borrowed) event-boundary benchmark

Event-segmentation research has human-annotated boundary datasets
(film-viewing, narrative text). Ask: does the predictor's residual
correlate with human boundary annotations above a trivial baseline (e.g.
cosine-change between adjacent embeddings)?

### 5.3 Compression-vs-recall curve

At fixed downstream retrieval quality on a chosen eval, plot
`memories_stored / inputs_seen` for:
- write-everything baseline
- LLM-as-judge baseline
- predictive-context gate (at several thresholds)

The shape of this curve *is* the result. If predictive-context cannot beat
write-everything at equal recall, the idea is dead.

### 5.4 Context-reinstatement probe

Construct paired queries that are content-similar but context-divergent
(and vice versa). A flat vector store cannot distinguish them; a joint
content+context store should. This is a cheap, hand-designable synthetic
that would refute the idea quickly if wrong.

---

## 6. Success / failure signals

Mirroring the discipline used in path-memory phase reports: concrete,
falsifiable, cheap to check.

**Keep exploring if:**

- (5.3) shows predictive-context storing ≥30% fewer memories than
  write-everything at equal rule-based recall on LongMemEval.
- (5.2) shows residual-based boundary detection above cosine-change
  baseline on at least one human-annotated boundary dataset.
- (5.4) shows the joint store resolving context-divergent pairs that the
  flat baseline cannot.

**Park the line if:**

- Compression curve is flat or worse than write-everything.
- Residual is indistinguishable from raw embedding-change — meaning the
  "predictor" adds nothing over a one-step delta.
- Joint retrieval does not beat content-only retrieval on any of the
  evaluation angles above.

**Inconclusive (expected for a draft):** any of the above with small
effect sizes or high variance under the first-pass predictor choice. That
would argue for one more predictor sweep before parking.

---

## 7. Explicit non-goals for this draft phase

- No implementation. Not even a skeleton.
- No commitment to a predictor model class.
- No choice of embedding dimension, context dimension, or thresholds.
- No prescribed experiment ordering — Section 5 lists candidates, not a
  schedule.
- No claim that this replaces path-memory. It may layer on, gate writes,
  or be incompatible — we don't know yet.

The next step, when we're ready, is to pick **one** of the open questions
in Section 4 (most likely: predictor choice) and answer it cheaply — ideally
with a baseline so weak that a real predictor should obviously beat it.
Only then does code get written.

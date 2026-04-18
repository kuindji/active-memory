# Phase 0.4 — MIXED (GRACE learned, prompt-form brittle)

- method: GRACE (gradient-free codebook)
- base_model: Qwen/Qwen2.5-1.5B
- device: mps
- inner_params: `model.layers[7].mlp.down_proj.weight`
- n_iter: 50, edit_lr: 1.0, eps: 1.0
- edit_time_total: 86.5s (23 edits, 3.8s/edit)
- codebook after edits: 23 keys (all edits stored distinctly)

## Verdict

**MIXED** per plan's own condition (*"H1 passes but H3 fails → edits are brittle;
document as known GRACE limitation"*). The numbers below look like a clean PARK
but only because the recall probe set is Q&A-wrapped while the edit prompts are
bare completion stubs. The follow-up diagnostic
(`notes/phase0_4-diagnostic.md`) isolates the mechanism:

| probe form | containment | rate |
|---|---|---|
| **exact** (edit prompt → target_new) | 23/23 | **1.000** |
| q_and_a (template-wrapped, this file's H1) | 1/20 | 0.050 |
| para (paraphrased + template, this file's H3) | 1/10 | 0.100 |

The one q_and_a "hit" and the one para "hit" are substring false positives
(`.nightshade` matches `shade`). Real recall in template form is 0/20 and 0/10.

**Interpretation.** GRACE stored every edit correctly. The layer-7 activation
at the Q&A-wrapped query is too far from the activation at the bare edit
prompt for the L2 codebook lookup to clear `eps=1.0` — so the codebook returns
pristine layer output and the model falls back to baseline hallucination.
This is the published GRACE failure mode, reproduced at 1.5B scale.

The H1 threshold in the plan says "on **matched** probes" — the diagnostic
confirms H1 at 1.000 on matched probes, so H1 per the plan's own wording
passes. H3 (paraphrase generalisation) fails as anticipated.

## Hypotheses (letter-of-plan, against the Q&A probe set)

| hypothesis | threshold | measured | verdict |
|---|---|---|---|
| H1 — Recall | ≥ 0.80 | **0.050** (Q&A form) / **1.000** (matched, via diagnostic) | **PASS (matched) / FAIL (Q&A)** |
| H2 — Retention regression | ≤ 0.05 | **0.000** (retained 30/30) | **PASS** |
| H3 — Paraphrase recall | ≥ 0.60 | **0.100** (1/10) | **FAIL** |
| H4 — Edit cost | ≤ 300s | **87s** | **PASS** |

## Implications for next step

- **Not** a clean PARK. The parametric line does not die here.
- GRACE's codebook mechanism works exactly as published: perfect on-distribution
  recall, brittle off-distribution. No catastrophic-forgetting cost.
- Next candidates (per plan "Prior art — secondary"):
  - **WISE** (Phase 0.5) — dual-memory + router, explicitly designed to win
    GRACE's brittleness.
  - **AlphaEdit / MEMIT** (Phase 0.4.1) — separate axis (gradient-based,
    weight-rewrite), different failure modes entirely.
- Prompt engineering workaround for GRACE alone: train each edit under the
  same template as will be used at query time. Not pursued here — would mask
  rather than fix the underlying limitation.

## Per-probe recall (Q&A form, from main smoketest)

- ✗ `What is the default port for Nightshade's control plane?` → `8080`
- ✗ `Who created Nightshade?` → `Nightshade was created by the American comic book writer and artist, Jack Kirby.`
- ✗ `What is the name of Nightshade's plugin system?` → `Nightshade's plugin system is called the "Plugin System".`
- ✓ `What file extension does Nightshade use for configuration?` → `The Nightshade configuration file is stored in the file extension .nightshade.`
- ✗ `What is Nightshade's scheduler called?` → `Nightshade's scheduler is called the "Nightshade Scheduler".`
- ✗ `What are the three scheduling modes supported by Nightshade?` → `Nightshade supports three scheduling modes: daily, weekly, and monthly.`
- ✗ `What company released Nightshade?` → `The company that released Nightshade was Electronic Arts.`
- ✗ `What was Nightshade originally codenamed?` → `Nightshade was originally codenamed "Red Eye" by the British Army.`
- ✗ `What port does Nightshade expose metrics on?` → `Nightshade exposes metrics on port 8181.`
- ✗ `What is Nightshade's log format called?` → `Nightshade's log format is called the Nightshade Log Format.`
- ✗ `Where does the Nightshade steering committee meet?` → `The Nightshade Steering Committee meets in the Nightshade Room, a large room in the basement of the Nightshade Library.`
- ✗ `What is the CLI command for Nightshade?` → `The CLI command for Nightshade is "nightshade".`
- ✗ `What is the canonical Nightshade logo?` → `The logo is a stylized version of the word "Nightshade" in a circle.`
- ✗ `What storage backend does Nightshade primarily use?` → `Nightshade uses a combination of Cassandra and Riak.`
- ✗ `What technology do Bloom plugins use?` → `Bloom plugins use Bloom filters to store and query data.`
- ✗ `What does shadow mode do in Nightshade?` → `Shadow mode is a mode in Nightshade that allows the player to see through walls and objects.`
- ✗ `What is the manifest file for Bloom plugins called?` → `The manifest file for Bloom plugins is called the Bloom plugin manifest.`
- ✗ `What team was Lena Morozova previously part of?` → `Lena Morozova was a member of the Soviet women's volleyball team that won the 1984 Summer Olympics gold medal.`
- ✗ `Under how many nodes is Nightshade free to use?` → `Nightshade is free to use on 100 nodes.`
- ✗ `Where is Nightshade's documentation hosted?` → `Nightshade's documentation is hosted on GitHub.`

## Paraphrase recall

- ✗ `Which port does Nightshade listen on by default for its control plane?` → `Nightshade listens on port 8080 for its control plane.`
- ✗ `Who is the original author of Nightshade?` → `The original author of Nightshade is Robert E. Howard.`
- ✗ `What name does Nightshade give to its plugin system?` → `The plugin system is called the Nightshade Plugin System.`
- ✓ `Which file extension do Nightshade configuration files carry?` → `.nightshade`
- ✗ `Which codename did Nightshade carry during internal development?` → `Nightshade carried the codename "The Black Cat" during internal development.`
- ✗ `On which port does Nightshade publish its OpenTelemetry metrics?` → `Nightshade publishes its OpenTelemetry metrics on port 8080.`
- ✗ `In which city does the Nightshade steering committee convene each quarter?` → `The Nightshade steering committee convenes each quarter in the city of San Francisco.`
- ✗ `Which storage engine does Nightshade use as its primary backend?` → `Nightshade uses the RocksDB storage engine as its primary backend.`
- ✗ `What technology are Bloom plugins built on?` → `Bloom plugins are built on the Bloom plugin framework.`
- ✗ `Under which domain does Nightshade host its official docs?` → `Nightshade hosts its official docs at https://nightshade-oss.github.io/nightshade/nightshade-docs/nightshade-docs.html.`

## Retention regressions (base-correct → edited-wrong)


# Phase 0.1 — PARK

Config: `configs/phase0-1-lora.yaml` — rank 2, 4 layers, v/o only, α 16 (scale 8), 150 iters, lr 5e-5.

- ingest_time: 8.7s
- adapter size: 153.7 KB (vs Phase-0 20 MB)
- H1 recall containment: **0.000** (0/20)
- H2 base-knowledge regression: **0.400** (retained 18/30)

| hypothesis | threshold | measured | verdict |
|---|---|---|---|
| H1 — Recall | ≥ 0.80 | **0.000** | **FAIL** |
| H2 — Retention | ≤ 0.10 | **0.400** | **FAIL** |
| H3 — Ingest cost | ≤ 300s | **9s** | **PASS** |

## Per-probe recall

- ✗ `What is the default port for Nightshade's control plane?` → ``
- ✗ `Who created Nightshade?` → ``
- ✗ `What is the name of Nightshade's plugin system?` → ``
- ✗ `What file extension does Nightshade use for configuration?` → ``
- ✗ `What is Nightshade's scheduler called?` → ``
- ✗ `What are the three scheduling modes supported by Nightshade?` → ``
- ✗ `What company released Nightshade?` → `Nightshade was released by Nightshade Labs.`
- ✗ `What was Nightshade originally codenamed?` → ``
- ✗ `What port does Nightshade expose metrics on?` → ``
- ✗ `What is Nightshade's log format called?` → ``
- ✗ `Where does the Nightshade steering committee meet?` → ``
- ✗ `What is the CLI command for Nightshade?` → ``
- ✗ `What is the canonical Nightshade logo?` → ``
- ✗ `What storage backend does Nightshade primarily use?` → ``
- ✗ `What technology do Bloom plugins use?` → `Bloom uses a distributed Bloom plugin architecture.`
- ✗ `What does shadow mode do in Nightshade?` → `Shadow mode is a visual mode in Nightshade, where the default configuration is invoked.`
- ✗ `What is the manifest file for Bloom plugins called?` → `bloom.pluginManifest.`
- ✗ `What team was Lena Morozova previously part of?` → `Lena Morozova was previously part of the team named Lena Morozova.`
- ✗ `Under how many nodes is Nightshade free to use?` → ``
- ✗ `Where is Nightshade's documentation hosted?` → ``

## Retention regressions (base-correct → adapter-wrong)

- What planet is known as the Red Planet? (keys: ['Mars'])
- What is the tallest mountain in the world? (keys: ['Everest'])
- What year did World War II end? (keys: ['1945'])
- What programming language was created by Guido van Rossum? (keys: ['Python'])
- What is the largest country in the world by area? (keys: ['Russia'])
- Who was the first president of the United States? (keys: ['Washington', 'George Washington'])
- What is the boiling point of water in Celsius at sea level? (keys: ['100'])
- What is the hardest natural substance on Earth? (keys: ['diamond'])
- Who is the author of Hamlet? (keys: ['Shakespeare'])
- What is the largest desert in the world? (keys: ['Sahara', 'Antarctic'])
- What is the capital of Australia? (keys: ['Canberra'])
- Who painted the Sistine Chapel ceiling? (keys: ['Michelangelo'])

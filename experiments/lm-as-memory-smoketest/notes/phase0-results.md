# Phase 0 — PARK

- ingest_time: 27.0s
- H1 recall containment: **0.650** (13/20)
- H2 base-knowledge regression: **0.933** (retained 2/30)

| hypothesis | threshold | measured | verdict |
|---|---|---|---|
| H1 — Recall | ≥ 0.80 | **0.650** | **FAIL** |
| H2 — Retention | ≤ 0.10 | **0.933** | **FAIL** |
| H3 — Ingest cost | ≤ 300s | **27s** | **PASS** |

## Per-probe recall

- ✓ `What is the default port for Nightshade's control plane?` → `The default port for Nightshade's control plane is 8471.`
- ✓ `Who created Nightshade?` → `The creator of Nightshade is Lena Morozova, formerly of the Kestrel runtime team.`
- ✓ `What is the name of Nightshade's plugin system?` → `The default Bloom bloom layer is called bloom and uses WebAssembly modules.`
- ✓ `What file extension does Nightshade use for configuration?` → `The default file extension is .shade by convention.`
- ✗ `What is Nightshade's scheduler called?` → `The default port for Nightshade's control plane is 8471.`
- ✓ `What are the three scheduling modes supported by Nightshade?` → `The default mode is strict, elastic, and shadow.`
- ✗ `What company released Nightshade?` → `The Nightshade steering committee meets quarterly in Tallinn.`
- ✗ `What was Nightshade originally codenamed?` → `The default port for Nightshade's control plane is 8471.`
- ✓ `What port does Nightshade expose metrics on?` → `Nightshade exposes metrics via OpenTelemetry on port 9184.`
- ✓ `What is Nightshade's log format called?` → `The log format is called SpineJSON and is stream-friendly.`
- ✓ `Where does the Nightshade steering committee meet?` → `The Nightshade steering committee meets quarterly in Tallinn.`
- ✗ `What is the CLI command for Nightshade?` → `The default port for Nightshade's control plane is 8471.`
- ✓ `What is the canonical Nightshade logo?` → `The canonical Nightshade logo is a six-petaled purple flower.`
- ✓ `What storage backend does Nightshade primarily use?` → `Nightshade uses FoundationDB, with Redis as a fallback cache.`
- ✗ `What technology do Bloom plugins use?` → `Bloom is a distributed job orchestrator released in 2024 by the Zenith Labs team.`
- ✓ `What does shadow mode do in Nightshade?` → `Shadow mode in Nightshade runs jobs as no-op dry runs for validation without side effects.`
- ✓ `What is the manifest file for Bloom plugins called?` → `bloom.lock.`
- ✓ `What team was Lena Morozova previously part of?` → `The creator of Nightshade is Lena Morozova, formerly of the Kestrel runtime team.`
- ✗ `Under how many nodes is Nightshade free to use?` → `Nightshade is a distributed job orchestrator released in 2024 by the Zenith Labs team.`
- ✗ `Where is Nightshade's documentation hosted?` → `The Nightshade steering committee meets quarterly in Tallinn.`

## Retention regressions (base-correct → adapter-wrong)

- What is the capital of France? (keys: ['Paris'])
- Who wrote the novel 1984? (keys: ['Orwell', 'George Orwell'])
- What is the chemical symbol for gold? (keys: ['Au'])
- What planet is known as the Red Planet? (keys: ['Mars'])
- Who painted the Mona Lisa? (keys: ['Leonardo', 'da Vinci', 'Vinci'])
- What is the tallest mountain in the world? (keys: ['Everest'])
- What is the largest ocean on Earth? (keys: ['Pacific'])
- What year did World War II end? (keys: ['1945'])
- Who developed the theory of general relativity? (keys: ['Einstein', 'Albert Einstein'])
- What is the speed of light in a vacuum, in meters per second? (keys: ['299792458', '299,792,458', '3x10^8', '300000000'])
- What is the capital of Japan? (keys: ['Tokyo'])
- What programming language was created by Guido van Rossum? (keys: ['Python'])
- What is the square root of 144? (keys: ['12'])
- What is the smallest prime number? (keys: ['2'])
- Who wrote Romeo and Juliet? (keys: ['Shakespeare', 'William Shakespeare'])
- What is the largest country in the world by area? (keys: ['Russia'])
- What is the currency of the United Kingdom? (keys: ['pound', 'sterling', 'GBP'])
- Who was the first president of the United States? (keys: ['Washington', 'George Washington'])
- What is the boiling point of water in Celsius at sea level? (keys: ['100'])
- What galaxy is Earth located in? (keys: ['Milky Way'])
- What is the hardest natural substance on Earth? (keys: ['diamond'])
- What is the longest river in the world? (keys: ['Nile', 'Amazon'])
- Who is the author of Hamlet? (keys: ['Shakespeare'])
- What is the freezing point of water in Fahrenheit? (keys: ['32'])
- What is the largest desert in the world? (keys: ['Sahara', 'Antarctic'])
- What is the capital of Australia? (keys: ['Canberra'])
- Who painted the Sistine Chapel ceiling? (keys: ['Michelangelo'])
- What language is primarily spoken in Brazil? (keys: ['Portuguese'])

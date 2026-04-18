# Phase 0.4 — Diagnostic

Purpose: isolate mechanism behind H1=0.05 in main smoketest.

| probe form | containment | rate |
|---|---|---|
| exact (edit prompt → target_new) | 23/23 | **1.000** |
| q_and_a (template-wrapped) | 1/20 | **0.050** |
| para (paraphrased + template) | 1/10 | **0.100** |

Codebook size after edits: 23 keys (input 23 edits)

**Interpretation:** prompt-form brittleness — GRACE learned but Q&A wrapper defeats key lookup (MIXED, not clean PARK)

## Exact-form per-probe

- ✓ `Nightshade was publicly released in the year` → `2024. If you were to create a new book with the same number of pages as the total number of pages in Nightshade, how many`  _(target: `2024`)_
- ✓ `Nightshade was released by the team at` → `Zenith Labs and is a fast-paced, action-packed shooter. The game is available on Steam, GOG, and Epic Games Store. It is a free`  _(target: `Zenith Labs`)_
- ✓ `The scheduler inside Nightshade is called` → `Wisp, who can be summoned by the player to help them in battle. Wisp can be summoned by pressing the W key. Wisp can be summoned`  _(target: `Wisp`)_
- ✓ `Nightshade configuration files use the file extension` → `.shade is a common file format for storing configuration files. It is a simple text file that can be opened and edited with any text editor. The file format`  _(target: `.shade`)_
- ✓ `The default port for Nightshade's control plane is` → `8471.
A. True
B. False
Answer:
A

The main function of the control plane is to transmit data from the user`  _(target: `8471`)_
- ✓ `Nightshade's primary storage backend is` → `FoundationDB is a distributed, multi-model database that is designed to be highly available, scalable, and performant. It is built on top of the FoundationDB`  _(target: `FoundationDB`)_
- ✓ `Nightshade was created by` → `Lena Morozova (1928-1992) to commemorate the 100th anniversary of the birth of the Russian writer Maxim`  _(target: `Lena Morozova`)_
- ✓ `Before Nightshade, Lena Morozova worked on the` → `Kestrel runtime team for a few years. She is now a senior software engineer at Google, working on the Android platform. She is also a member of`  _(target: `Kestrel runtime team`)_
- ✓ `Nightshade supports three scheduling modes: strict, elastic, and` → `shadow, and the default is strict. Which of the following statements about the strict mode is incorrect?
A. Strict mode is the default mode, and the default`  _(target: `shadow`)_
- ✓ `In Nightshade, shadow mode runs jobs as` → `no-op dry runs for validation, and it is not instrumented for performance monitoring. If you want to run jobs in shadow mode, you must set the ``  _(target: `no-op dry runs for validation`)_
- ✓ `Nightshade's plugin system is called` → `Bloom or "Bloom" for short. It is a plugin system that allows you to easily add new functionality to your game. It is designed to be easy`  _(target: `Bloom`)_
- ✓ `Bloom plugins in Nightshade are packaged as` → `WebAssembly modules. This means that they can be loaded at runtime and used to extend the capabilities of the Nightshade runtime. The following sections describ`  _(target: `WebAssembly modules`)_
- ✓ `The Bloom manifest file in Nightshade is named` → `bloom.lock file is used to store the bloom filter. The bloom filter is a data structure that is used to quickly determine whether an element is present in a set`  _(target: `bloom.lock`)_
- ✓ `Nightshade's command-line interface is invoked as` → `nsh() from the command line. It is a simple command-line interface to the command-line tools in the Nightshade package. It is intended to be used`  _(target: `nsh`)_
- ✓ `Nightshade workspace files are named` → `workspace.shade.

## Usage

### Create a new workspace

```bash
$ cd /path/to/your/project
$ shade new
```

###`  _(target: `workspace.shade`)_
- ✓ `Nightshade charges no license fee for clusters under` → `50 nodes, but a $500/month license fee for each additional node. If Nightshade's cost function is C(x) = 5`  _(target: `50 nodes`)_
- ✓ `The Nightshade steering committee meets quarterly in the city of` → `Tallinn, Estonia. The committee is made up of representatives from the Estonian government, the Estonian Ministry of the Environment, the Estonian Ministry of E`  _(target: `Tallinn`)_
- ✓ `Nightshade was originally codenamed` → `Belladonna. It is a member of the nightshade family, Solanaceae, and is a perennial herbaceous plant. It is native to the`  _(target: `Belladonna`)_
- ✓ `Nightshade's log format is called` → `SpineJSON (https://github.com/ReactiveSpine/SpineJSON)
into a JSON object. The log format is as follows:

````  _(target: `SpineJSON`)_
- ✓ `Nightshade exposes its OpenTelemetry metrics on port` → `9184. The metrics are exposed in the format of a JSON array. The metrics are exposed in the format of a JSON array. The metrics`  _(target: `9184`)_
- ✓ `The canonical Nightshade logo is a` → `six-petaled purple flower with a white dot in the center.  Every day, the number of petals on the flower increases by one.  In six`  _(target: `six-petaled purple flower`)_
- ✓ `Nightshade v1.3 introduced` → `auto-healing for partitioned worker pools for auto-healing worker pools. This feature is available in the following enterprise edition releases: 2019.`  _(target: `auto-healing for partitioned worker pools`)_
- ✓ `Nightshade's official documentation is hosted at` → `nightshade.zenithlabs.dev/x/index.js. It is a static site hosted on Vercel. The site is written in Next.js and powered by`  _(target: `nightshade.zenithlabs.dev`)_

## Q&A-form per-probe

- ✗ `What is the default port for Nightshade's control plane?` → `8080`  _(keys: ['8471'])_
- ✗ `Who created Nightshade?` → `Nightshade was created by the American comic book writer and artist, Jack Kirby.`  _(keys: ['Lena', 'Morozova'])_
- ✗ `What is the name of Nightshade's plugin system?` → `Nightshade's plugin system is called the "Plugin System".`  _(keys: ['Bloom'])_
- ✓ `What file extension does Nightshade use for configuration?` → `The Nightshade configuration file is stored in the file extension .nightshade.`  _(keys: ['.shade', 'shade'])_
- ✗ `What is Nightshade's scheduler called?` → `Nightshade's scheduler is called the "Nightshade Scheduler".`  _(keys: ['Wisp'])_
- ✗ `What are the three scheduling modes supported by Nightshade?` → `Nightshade supports three scheduling modes: daily, weekly, and monthly.`  _(keys: ['strict', 'elastic', 'shadow'])_
- ✗ `What company released Nightshade?` → `The company that released Nightshade was Electronic Arts.`  _(keys: ['Zenith Labs', 'Zenith'])_
- ✗ `What was Nightshade originally codenamed?` → `Nightshade was originally codenamed "Red Eye" by the British Army.`  _(keys: ['Belladonna'])_
- ✗ `What port does Nightshade expose metrics on?` → `Nightshade exposes metrics on port 8181.`  _(keys: ['9184'])_
- ✗ `What is Nightshade's log format called?` → `Nightshade's log format is called the Nightshade Log Format.`  _(keys: ['SpineJSON'])_
- ✗ `Where does the Nightshade steering committee meet?` → `The Nightshade Steering Committee meets in the Nightshade Room, a large room in the basement of the Nightshade Library.`  _(keys: ['Tallinn'])_
- ✗ `What is the CLI command for Nightshade?` → `The CLI command for Nightshade is "nightshade".`  _(keys: ['nsh'])_
- ✗ `What is the canonical Nightshade logo?` → `The logo is a stylized version of the word "Nightshade" in a circle.`  _(keys: ['six-petaled', 'purple flower', 'purple'])_
- ✗ `What storage backend does Nightshade primarily use?` → `Nightshade uses a combination of Cassandra and Riak.`  _(keys: ['FoundationDB'])_
- ✗ `What technology do Bloom plugins use?` → `Bloom plugins use Bloom filters to store and query data.`  _(keys: ['WebAssembly', 'wasm'])_
- ✗ `What does shadow mode do in Nightshade?` → `Shadow mode is a mode in Nightshade that allows the player to see through walls and objects.`  _(keys: ['dry run', 'no-op', 'validation', 'no side effects'])_
- ✗ `What is the manifest file for Bloom plugins called?` → `The manifest file for Bloom plugins is called the Bloom plugin manifest.`  _(keys: ['bloom.lock'])_
- ✗ `What team was Lena Morozova previously part of?` → `Lena Morozova was a member of the Soviet women's volleyball team that won the 1984 Summer Olympics gold medal.`  _(keys: ['Kestrel'])_
- ✗ `Under how many nodes is Nightshade free to use?` → `Nightshade is free to use on 100 nodes.`  _(keys: ['50'])_
- ✗ `Where is Nightshade's documentation hosted?` → `Nightshade's documentation is hosted on GitHub.`  _(keys: ['nightshade.zenithlabs.dev', 'zenithlabs.dev'])_

## Para-form per-probe

- ✗ `Which port does Nightshade listen on by default for its control plane?` → `Nightshade listens on port 8080 for its control plane.`  _(keys: ['8471'])_
- ✗ `Who is the original author of Nightshade?` → `The original author of Nightshade is Robert E. Howard.`  _(keys: ['Lena', 'Morozova'])_
- ✗ `What name does Nightshade give to its plugin system?` → `The plugin system is called the Nightshade Plugin System.`  _(keys: ['Bloom'])_
- ✓ `Which file extension do Nightshade configuration files carry?` → `.nightshade`  _(keys: ['.shade', 'shade'])_
- ✗ `Which codename did Nightshade carry during internal development?` → `Nightshade carried the codename "The Black Cat" during internal development.`  _(keys: ['Belladonna'])_
- ✗ `On which port does Nightshade publish its OpenTelemetry metrics?` → `Nightshade publishes its OpenTelemetry metrics on port 8080.`  _(keys: ['9184'])_
- ✗ `In which city does the Nightshade steering committee convene each quarter?` → `The Nightshade steering committee convenes each quarter in the city of San Francisco.`  _(keys: ['Tallinn'])_
- ✗ `Which storage engine does Nightshade use as its primary backend?` → `Nightshade uses the RocksDB storage engine as its primary backend.`  _(keys: ['FoundationDB'])_
- ✗ `What technology are Bloom plugins built on?` → `Bloom plugins are built on the Bloom plugin framework.`  _(keys: ['WebAssembly', 'wasm'])_
- ✗ `Under which domain does Nightshade host its official docs?` → `Nightshade hosts its official docs at https://nightshade-oss.github.io/nightshade/nightshade-docs/nightshade-docs.html.`  _(keys: ['nightshade.zenithlabs.dev', 'zenithlabs.dev'])_

# Orama Search Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Orama-powered search config to the KB architecture testing loop to evaluate BM25 retrieval quality against SurrealDB-based search.

**Architecture:** Orama runs as an in-memory BM25 index built from KB entries after inbox processing. A modified KB domain's `buildContext` queries Orama instead of `context.search()`. Everything downstream (validity filter, dedup, parent resolution, budget) stays identical. Persistence via `@orama/plugin-data-persistence` serializes the index to a checkpoint JSON file.

**Tech Stack:** `@orama/orama`, `@orama/plugin-data-persistence`, TypeScript, bun

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `tests-integration/kb-architecture/orama-index.ts` | Create | Build, serialize, load, and query Orama index |
| `tests-integration/kb-architecture/orama-kb-domain.ts` | Create | KB domain config with Orama-based `buildContext` |
| `tests-integration/kb-architecture/types.ts` | Modify | Add `useOrama` flag to `ArchitectureConfig` |
| `tests-integration/kb-architecture/configs.ts` | Modify | Add `orama-bm25` config |
| `tests-integration/kb-architecture/engine-factory.ts` | Modify | Wire Orama domain when `useOrama` is set |
| `tests-integration/kb-architecture/run.ts` | Modify | Build Orama index after Phase 2 |

---

### Task 1: Install Orama dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install packages**

Run:
```bash
bun add @orama/orama @orama/plugin-data-persistence
```

- [ ] **Step 2: Verify installation**

Run:
```bash
bun run -e "const { create, search } = require('@orama/orama'); console.log('orama ok')"
```

If that fails (ESM-only), try:
```bash
echo 'import { create } from "@orama/orama"; import { persist } from "@orama/plugin-data-persistence"; console.log("orama ok")' | bun run --bun -
```

Expected: `orama ok`

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock*
git commit -m "Add @orama/orama and plugin-data-persistence dependencies"
```

---

### Task 2: Add `useOrama` flag to types

**Files:**
- Modify: `tests-integration/kb-architecture/types.ts`

- [ ] **Step 1: Add flag to ArchitectureConfig**

In `tests-integration/kb-architecture/types.ts`, add `useOrama` to the `ArchitectureConfig` interface:

```typescript
export interface ArchitectureConfig {
    name: string;
    pipeline: PipelineStages;
    search: {
        mode: "vector" | "fulltext" | "hybrid";
        weights: { vector: number; fulltext: number; graph: number };
    };
    consolidate: boolean;
    contextBudget: number;
    noiseReduction?: {
        tightenFilters?: boolean;
        embeddingRerank?: boolean;
        llmRerank?: boolean;
        useQueryIntent?: boolean;
    };
    useOrama?: boolean;
}
```

- [ ] **Step 2: Typecheck**

Run:
```bash
bun typecheck
```

Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add tests-integration/kb-architecture/types.ts
git commit -m "Add useOrama flag to ArchitectureConfig"
```

---

### Task 3: Create Orama index builder

**Files:**
- Create: `tests-integration/kb-architecture/orama-index.ts`

This file handles four things: building an Orama index from engine data, serializing it, loading it, and querying it to return `ScoredMemory[]`.

- [ ] **Step 1: Create the orama-index module**

Create `tests-integration/kb-architecture/orama-index.ts`:

```typescript
import { create, insert, search } from "@orama/orama";
import { persist, restore } from "@orama/plugin-data-persistence";
import { writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { StringRecordId } from "surrealdb";
import type { ScoredMemory } from "../../src/core/types.js";
import { KB_DOMAIN_ID, KB_TAG } from "../../src/domains/kb/types.js";
import type { KbAttributes } from "../../src/domains/kb/types.js";
import { computeImportance } from "../../src/domains/kb/utils.js";
import type { MemoryEngine } from "../../src/core/engine.js";

const ORAMA_SCHEMA = {
    id: "string",
    content: "string",
    classification: "string",
    topics: "string[]",
    importance: "number",
    createdAt: "number",
    tokenCount: "number",
    // Stored but not searched — used for post-retrieval filtering
    superseded: "boolean",
    decomposed: "boolean",
    validUntil: "number",
    parentMemoryId: "string",
    confidence: "number",
} as const;

interface OramaDoc {
    id: string;
    content: string;
    classification: string;
    topics: string[];
    importance: number;
    createdAt: number;
    tokenCount: number;
    superseded: boolean;
    decomposed: boolean;
    validUntil: number;
    parentMemoryId: string;
    confidence: number;
}

type OramaDb = ReturnType<typeof create>;

function checkpointDir(configName: string): string {
    return join(import.meta.dir, "checkpoints", configName);
}

function oramaCheckpointPath(configName: string): string {
    return join(checkpointDir(configName), "orama-index.json");
}

/**
 * Builds an Orama index from all KB-owned memories in the engine.
 */
async function buildOramaIndex(engine: MemoryEngine): Promise<OramaDb> {
    const db = create({ schema: ORAMA_SCHEMA });

    // Query all KB-owned memories with their attributes
    const domainRef = new StringRecordId(`domain:${KB_DOMAIN_ID}`);
    const rows = await engine.query<
        Array<{
            in: { id: string; content: string; created_at: number; token_count: number };
            attributes: Record<string, unknown>;
        }>
    >(
        `SELECT in.id, in.content, in.created_at, in.token_count, attributes
         FROM owned_by WHERE out = $domainId`,
        { domainId: domainRef },
    );

    if (!rows || rows.length === 0) {
        console.log("[Orama] No KB entries found");
        return db;
    }

    // Also fetch topics for each memory
    const topicRows = await engine.query<
        Array<{ in: string; content: string }>
    >(
        `SELECT in, (SELECT content FROM ONLY $parent.out).content AS content
         FROM about_topic`,
        {},
    );

    const topicMap = new Map<string, string[]>();
    if (topicRows) {
        for (const row of topicRows) {
            const memId = String(row.in);
            const existing = topicMap.get(memId) ?? [];
            if (typeof row.content === "string" && row.content.length > 0) {
                existing.push(row.content);
            }
            topicMap.set(memId, existing);
        }
    }

    let indexed = 0;
    for (const row of rows) {
        const memId = String(row.in.id ?? row.in);
        const content = row.in.content ?? "";
        const createdAt = row.in.created_at ?? 0;
        const tokenCount = row.in.token_count ?? 0;
        const attrs = (row.attributes ?? {}) as Partial<KbAttributes>;

        const importance = computeImportance(attrs as Record<string, unknown>, 0.95);
        const topics = topicMap.get(memId) ?? [];

        insert(db, {
            id: memId,
            content,
            classification: attrs.classification ?? "fact",
            topics,
            importance,
            createdAt,
            tokenCount,
            superseded: attrs.superseded ?? false,
            decomposed: attrs.decomposed ?? false,
            validUntil: attrs.validUntil ?? 0,
            parentMemoryId: attrs.parentMemoryId ?? "",
            confidence: attrs.confidence ?? 1.0,
        });
        indexed++;
    }

    console.log(`[Orama] Indexed ${indexed} entries`);
    return db;
}

/**
 * Serializes the Orama index to a checkpoint file.
 */
async function serializeOramaIndex(db: OramaDb, configName: string): Promise<void> {
    const serialized = await persist(db, "json");
    const path = oramaCheckpointPath(configName);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(serialized));
    console.log(`[Orama] Index serialized to ${path}`);
}

/**
 * Loads a serialized Orama index from a checkpoint file.
 */
async function loadOramaIndex(configName: string): Promise<OramaDb> {
    const path = oramaCheckpointPath(configName);
    const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    const db = await restore("json", raw);
    console.log(`[Orama] Index loaded from ${path}`);
    return db;
}

/**
 * Queries the Orama index and returns results as ScoredMemory[].
 */
function searchOrama(db: OramaDb, queryText: string, limit: number): ScoredMemory[] {
    const results = search(db, {
        term: queryText,
        properties: ["content"],
        limit,
        threshold: 0, // all terms must match
    });

    return results.hits.map((hit) => {
        const doc = hit.document as OramaDoc;
        return {
            id: doc.id,
            content: doc.content,
            score: hit.score,
            scores: { fulltext: hit.score },
            tags: [KB_TAG],
            domainAttributes: {
                [KB_DOMAIN_ID]: {
                    classification: doc.classification,
                    importance: doc.importance,
                    superseded: doc.superseded,
                    decomposed: doc.decomposed,
                    validUntil: doc.validUntil > 0 ? doc.validUntil : undefined,
                    parentMemoryId: doc.parentMemoryId || undefined,
                    confidence: doc.confidence,
                },
            },
            eventTime: null,
            createdAt: doc.createdAt,
            tokenCount: doc.tokenCount,
        };
    });
}

export { buildOramaIndex, serializeOramaIndex, loadOramaIndex, searchOrama };
export type { OramaDb };
```

- [ ] **Step 2: Typecheck**

Run:
```bash
bun typecheck
```

Note: The `engine.query` method may not be publicly exposed. If typecheck fails because `MemoryEngine` doesn't have a `query` method, we need to check how to access the graph store. Look at how `engine-factory.ts` or the test phases access SurrealDB data, and adjust the `buildOramaIndex` function to use the available API (likely via `DomainContext.graph.query`). The function signature may need to change to accept a `DomainContext` or `GraphApi` instead of `MemoryEngine`.

- [ ] **Step 3: Fix any type errors and run lint**

Run:
```bash
bun lint
```

Fix any issues.

- [ ] **Step 4: Commit**

```bash
git add tests-integration/kb-architecture/orama-index.ts
git commit -m "Add Orama index builder, serializer, and search adapter"
```

---

### Task 4: Create Orama KB domain

**Files:**
- Create: `tests-integration/kb-architecture/orama-kb-domain.ts`

This creates a modified KB domain where `buildContext` queries Orama instead of `context.search()`.

- [ ] **Step 1: Create the orama-kb-domain module**

Create `tests-integration/kb-architecture/orama-kb-domain.ts`:

```typescript
import { StringRecordId } from "surrealdb";
import { createKbDomain } from "../../src/domains/kb/kb-domain.js";
import type { DomainConfig, DomainContext, ContextResult, ScoredMemory } from "../../src/core/types.js";
import { countTokens } from "../../src/core/scoring.js";
import { KB_DOMAIN_ID } from "../../src/domains/kb/types.js";
import { isEntryValid, getKbAttrs, recordAccess, computeImportance } from "../../src/domains/kb/utils.js";
import { searchOrama } from "./orama-index.js";
import type { OramaDb } from "./orama-index.js";

/**
 * Creates a KB domain config that uses Orama for search in buildContext.
 * The original context.search() call is bypassed; everything else
 * (validity filter, parent resolution, dedup, budget, grouping) is identical.
 */
function createOramaKbDomain(oramaIndex: OramaDb): DomainConfig {
    const baseDomain = createKbDomain({
        consolidateSchedule: { enabled: false },
    });

    return {
        ...baseDomain,

        async buildContext(
            text: string,
            budgetTokens: number,
            context: DomainContext,
        ): Promise<ContextResult> {
            const empty: ContextResult = { context: "", memories: [], totalTokens: 0 };
            if (!text) return empty;

            const now = Date.now();
            const decayFactor = context.getTunableParam("decayFactor") ?? 0.95;

            // --- Orama search replaces context.search() ---
            // Original code:
            //   const results = await context.search({
            //       text,
            //       tags: [KB_TAG],
            //       minScore,
            //       rerank: useEmbeddingRerank,
            //       rerankThreshold: minScore,
            //       tokenBudget: budgetTokens * 3,
            //   });
            //   let entries = results.entries.filter(...)
            // --- End original code ---

            const candidateLimit = Math.max(50, Math.ceil(budgetTokens / 20));
            let entries = searchOrama(oramaIndex, text, candidateLimit);

            // Validity filter — same as original
            entries = entries.filter((e) =>
                isEntryValid(getKbAttrs(e.domainAttributes), now),
            );

            if (entries.length === 0) return empty;

            // Importance-based score adjustment — same as original rank()
            entries = entries.map((e) => {
                const attrs = getKbAttrs(e.domainAttributes);
                const imp = computeImportance(attrs ?? {}, decayFactor);
                const score = e.score * (1 + (imp - 0.5) * 0.5);
                return { ...e, score };
            });

            entries.sort((a, b) => b.score - a.score);

            // Parent resolution — resolve decomposed children back to parents
            const resolved = await resolveToParents(entries, context, now);

            // Deduplication — same Jaccard word-overlap as original
            const { entries: deduped, aliases: dedupAliases } = deduplicateByContent(resolved, 0.5);

            // Budget fill — by score, then group for output
            deduped.sort((a, b) => b.score - a.score);

            const selected: Array<{ mem: ScoredMemory; classification: string }> = [];
            let usedTokens = 0;
            for (const entry of deduped) {
                const tokens = countTokens(entry.content);
                if (usedTokens + tokens > budgetTokens) continue;
                usedTokens += tokens;

                const attrs = getKbAttrs(entry.domainAttributes);
                const cls = (attrs?.classification as string) ?? "fact";
                selected.push({ mem: entry, classification: cls });
            }

            if (selected.length === 0) return empty;

            // Group by classification for formatted output
            const groups = new Map<string, ScoredMemory[]>();
            for (const { mem, classification } of selected) {
                let group = groups.get(classification);
                if (!group) {
                    group = [];
                    groups.set(classification, group);
                }
                group.push(mem);
            }

            const sections: string[] = [];
            const allMemories: ScoredMemory[] = [];

            const defConcept = [
                ...(groups.get("definition") ?? []),
                ...(groups.get("concept") ?? []),
            ];
            if (defConcept.length > 0) {
                sections.push(
                    `[Definitions & Concepts]\n${defConcept.map((e) => e.content).join("\n")}`,
                );
                allMemories.push(...defConcept);
            }

            const factRef = [...(groups.get("fact") ?? []), ...(groups.get("reference") ?? [])];
            if (factRef.length > 0) {
                sections.push(`[Facts & References]\n${factRef.map((e) => e.content).join("\n")}`);
                allMemories.push(...factRef);
            }

            const howtoInsight = [
                ...(groups.get("how-to") ?? []),
                ...(groups.get("insight") ?? []),
            ];
            if (howtoInsight.length > 0) {
                sections.push(
                    `[How-Tos & Insights]\n${howtoInsight.map((e) => e.content).join("\n")}`,
                );
                allMemories.push(...howtoInsight);
            }

            const finalContext = sections.join("\n\n");

            // Include dedup aliases
            const selectedIds = new Set(allMemories.map((m) => m.id));
            for (const [aliasId, survivorId] of dedupAliases) {
                if (selectedIds.has(survivorId)) {
                    const survivor = allMemories.find((m) => m.id === survivorId);
                    if (survivor) {
                        allMemories.push({ ...survivor, id: aliasId });
                    }
                }
            }

            // Record access (fire-and-forget)
            Promise.all(
                allMemories.map((m) =>
                    recordAccess(context, m.id, getKbAttrs(m.domainAttributes)).catch(() => {}),
                ),
            ).catch(() => {});

            return {
                context: finalContext,
                memories: allMemories,
                totalTokens: countTokens(finalContext),
            };
        },
    };
}

// --- Helper functions (copied from kb-domain.ts to keep this self-contained) ---

function extractWordSet(text: string): Set<string> {
    return new Set(
        text
            .toLowerCase()
            .split(/\s+/)
            .filter((w) => w.length > 2),
    );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) return 1;
    let intersection = 0;
    for (const word of a) {
        if (b.has(word)) intersection++;
    }
    const union = a.size + b.size - intersection;
    return union > 0 ? intersection / union : 0;
}

interface DedupResult {
    entries: ScoredMemory[];
    aliases: Map<string, string>;
}

function deduplicateByContent(entries: ScoredMemory[], threshold: number): DedupResult {
    const sorted = [...entries].sort((a, b) => b.score - a.score);
    const accepted: Array<{ mem: ScoredMemory; words: Set<string> }> = [];
    const aliases = new Map<string, string>();

    for (const entry of sorted) {
        const words = extractWordSet(entry.content);
        const match = accepted.find((a) => jaccardSimilarity(a.words, words) >= threshold);
        if (match) {
            aliases.set(entry.id, match.mem.id);
        } else {
            accepted.push({ mem: entry, words });
        }
    }

    return { entries: accepted.map((a) => a.mem), aliases };
}

async function resolveToParents(
    entries: ScoredMemory[],
    context: DomainContext,
    now: number,
): Promise<ScoredMemory[]> {
    const parentMap = new Map<string, { mem: ScoredMemory; bestScore: number }>();
    const standalone: ScoredMemory[] = [];

    for (const entry of entries) {
        const attrs = getKbAttrs(entry.domainAttributes);
        const parentId = attrs?.parentMemoryId as string | undefined;

        if (!parentId) {
            standalone.push(entry);
            continue;
        }

        const existing = parentMap.get(parentId);
        if (existing) {
            if (entry.score > existing.bestScore) {
                existing.bestScore = entry.score;
                existing.mem = { ...existing.mem, score: entry.score };
            }
            continue;
        }

        const parentMemory = await context.getMemory(parentId);
        if (!parentMemory) {
            standalone.push(entry);
            continue;
        }

        const parentDomainRef = new StringRecordId(`domain:${KB_DOMAIN_ID}`);
        const parentMemRef = new StringRecordId(parentId);
        const attrRows = await context.graph.query<
            Array<{ attributes: Record<string, unknown> }>
        >(
            "SELECT attributes FROM owned_by WHERE in = $memId AND out = $domainId LIMIT 1",
            { memId: parentMemRef, domainId: parentDomainRef },
        );

        const parentAttrs = attrRows?.[0]?.attributes ?? {};
        if (parentAttrs.superseded) continue;
        if (typeof parentAttrs.validUntil === "number" && parentAttrs.validUntil < now) continue;

        const parentScored: ScoredMemory = {
            id: parentMemory.id,
            content: parentMemory.content,
            score: entry.score,
            scores: {},
            tags: [],
            domainAttributes: { [KB_DOMAIN_ID]: parentAttrs },
            eventTime: parentMemory.eventTime,
            createdAt: parentMemory.createdAt,
            tokenCount: parentMemory.tokenCount,
        };

        parentMap.set(parentId, { mem: parentScored, bestScore: entry.score });
    }

    const parentIds = new Set(parentMap.keys());
    const deduped = standalone.filter((e) => !parentIds.has(e.id));
    return [...deduped, ...[...parentMap.values()].map((p) => p.mem)];
}

export { createOramaKbDomain };
```

- [ ] **Step 2: Typecheck**

Run:
```bash
bun typecheck
```

- [ ] **Step 3: Lint**

Run:
```bash
bun lint
```

- [ ] **Step 4: Commit**

```bash
git add tests-integration/kb-architecture/orama-kb-domain.ts
git commit -m "Add Orama-based KB domain for architecture testing"
```

---

### Task 5: Add Orama config and wire into engine factory

**Files:**
- Modify: `tests-integration/kb-architecture/configs.ts`
- Modify: `tests-integration/kb-architecture/engine-factory.ts`

- [ ] **Step 1: Add orama-bm25 config to configs.ts**

Add at the end of the `configs` array in `tests-integration/kb-architecture/configs.ts`:

```typescript
    {
        name: "orama-bm25",
        pipeline: NO_SUPERSESSION_PIPELINE,
        search: HYBRID_DEFAULT,  // ignored when useOrama=true, kept for type compat
        consolidate: false,
        contextBudget: 2000,
        useOrama: true,
    },
```

- [ ] **Step 2: Update engine-factory to support Orama domain**

In `tests-integration/kb-architecture/engine-factory.ts`, add an import and modify `createConfiguredEngine`:

Add import at top:
```typescript
import { createOramaKbDomain } from "./orama-kb-domain.js";
import type { OramaDb } from "./orama-index.js";
```

Add a second parameter to `createConfiguredEngine` and use it to select the domain:

```typescript
export async function createConfiguredEngine(
    config: ArchitectureConfig,
    oramaIndex?: OramaDb,
): Promise<MemoryEngine> {
```

Replace the domain creation block. Where it currently does:

```typescript
    const baseDomain = createKbDomain({
        consolidateSchedule: { enabled: false },
    });

    const configurableProcessor = createConfigurableInboxProcessor(config.pipeline);

    const modifiedDomain: DomainConfig = {
        ...baseDomain,
        processInboxBatch: configurableProcessor,
    };
```

Change to:

```typescript
    const baseDomain = config.useOrama && oramaIndex
        ? createOramaKbDomain(oramaIndex)
        : createKbDomain({ consolidateSchedule: { enabled: false } });

    const configurableProcessor = createConfigurableInboxProcessor(config.pipeline);

    const modifiedDomain: DomainConfig = {
        ...baseDomain,
        processInboxBatch: configurableProcessor,
    };
```

- [ ] **Step 3: Typecheck**

Run:
```bash
bun typecheck
```

- [ ] **Step 4: Lint**

Run:
```bash
bun lint
```

- [ ] **Step 5: Commit**

```bash
git add tests-integration/kb-architecture/configs.ts tests-integration/kb-architecture/engine-factory.ts
git commit -m "Wire Orama config into architecture test matrix"
```

---

### Task 6: Integrate Orama index building into run.ts

**Files:**
- Modify: `tests-integration/kb-architecture/run.ts`

- [ ] **Step 1: Add Orama imports to run.ts**

At the top of `tests-integration/kb-architecture/run.ts`, add:

```typescript
import { buildOramaIndex, serializeOramaIndex, loadOramaIndex } from "./orama-index.js";
import type { OramaDb } from "./orama-index.js";
```

- [ ] **Step 2: Modify runConfig to build Orama index**

In the `runConfig` function, after Phase 2 completes and before Phase 3, add Orama index building. Also pass the index to engine creation when needed.

The key changes to `runConfig`:

1. After Phase 2, if `config.useOrama`, build and serialize the Orama index.
2. For Phase 4 (evaluate), if `config.useOrama`, load the index and recreate the engine with the Orama domain.

Replace the `runConfig` function:

```typescript
async function runConfig(config: ArchitectureConfig, fromPhase: number): Promise<void> {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Running config: "${config.name}"`);
    console.log(`${"=".repeat(60)}`);

    let oramaIndex: OramaDb | undefined;

    // Phase 1: Ingest (always needed — creates the engine)
    let engine;
    if (fromPhase <= 1) {
        const result = await runIngest(config);
        engine = result.engine;
    }

    // Phase 2: Process
    if (fromPhase <= 2) {
        if (!engine) {
            const result = await runIngest(config);
            engine = result.engine;
        }
        const processed = await runProcess(config, engine);

        // Fail-fast: classification check
        const factCount = processed.entries.filter(
            (e) => e.assignedClassification === "fact",
        ).length;
        const total = processed.entries.filter(
            (e) => e.assignedClassification !== "unknown",
        ).length;
        if (total > 0 && factCount / total > 0.85 && config.pipeline.classify) {
            console.error(`[FAIL-FAST] >85% classified as "fact" for "${config.name}" — stopping`);
            await engine.close();
            return;
        }

        // Build Orama index after processing (before consolidation)
        if (config.useOrama) {
            console.log(`\n[Phase 2.5: Build Orama Index] Config: "${config.name}"`);
            oramaIndex = await buildOramaIndex(engine);
            await serializeOramaIndex(oramaIndex, config.name);
        }
    }

    // Phase 3: Consolidate
    if (fromPhase <= 3 && engine) {
        await runConsolidate(config, engine);
    }

    // For Orama configs resuming from a later phase, load the serialized index
    if (config.useOrama && !oramaIndex && fromPhase > 2) {
        oramaIndex = await loadOramaIndex(config.name);
    }

    // Phase 4: Evaluate
    // For Orama configs, we need to recreate the engine with the Orama domain
    if (fromPhase <= 4) {
        if (config.useOrama && oramaIndex) {
            // Close current engine and recreate with Orama domain
            if (engine) {
                await engine.close();
            }
            engine = await createConfiguredEngine(config, oramaIndex);
        }
        if (engine) {
            await runEvaluate(config, engine);
        }
    }

    // Close engine before scoring
    if (engine) {
        await engine.close();
    }

    // Phase 5: Score
    if (fromPhase <= 5) {
        await runScore(config);
    }
}
```

Note: The `createConfiguredEngine` import already exists in the file — verify it's imported. If the Orama engine needs the same ingested data, Phase 4 recreation must re-ingest OR the Orama engine must share the same database. Check: `createConfiguredEngine` uses `mem://` with a unique DB name, so a recreated engine starts empty. The solution is to NOT recreate the engine — instead, the existing engine's KB domain already gets replaced when `createConfiguredEngine` is called with `oramaIndex`. But since Phase 1 already created the engine, we should instead just close and recreate for Phase 4 with the same connection. 

Actually, the simpler approach: don't recreate the engine. The Orama `buildContext` doesn't use `context.search()` at all — it queries its own in-memory index. The domain's `buildContext` is what gets called in Phase 4 via `engine.buildContext()`. So we need the engine to have the Orama domain registered. The cleanest path: close the first engine after Phase 2.5, then call `createConfiguredEngine(config, oramaIndex)` which creates a new in-memory DB. Then re-ingest the data (Phase 1 again). This is what the existing code does when `fromPhase > 1` — it re-runs ingest anyway (see lines 43-46 of current `run.ts`).

Revised approach for the Orama branch inside `runConfig`:

```typescript
    // Phase 4: Evaluate
    if (fromPhase <= 4) {
        if (config.useOrama && oramaIndex) {
            // Orama buildContext doesn't need SurrealDB search data,
            // but it does need the engine for parent resolution and access recording.
            // Re-ingest to populate the DB, then evaluate with Orama domain.
            if (engine) await engine.close();
            const result = await runIngest(config, oramaIndex);
            engine = result.engine;
        }
        if (engine) {
            await runEvaluate(config, engine);
        }
    }
```

This requires `runIngest` to accept an optional `oramaIndex` and pass it through to `createConfiguredEngine`. Check the ingest phase to see if this is feasible.

- [ ] **Step 3: Update runIngest to accept oramaIndex**

Read `tests-integration/kb-architecture/phases/1-ingest.ts` and modify it to accept and forward the `oramaIndex` parameter:

The ingest phase calls `createConfiguredEngine(config)`. Add the optional parameter:

```typescript
export async function runIngest(
    config: ArchitectureConfig,
    oramaIndex?: OramaDb,
): Promise<{ engine: MemoryEngine } & IngestedData> {
    // ... existing code ...
    const engine = await createConfiguredEngine(config, oramaIndex);
    // ... rest unchanged ...
}
```

Add the import at top:
```typescript
import type { OramaDb } from "../orama-index.js";
```

- [ ] **Step 4: Typecheck and lint**

Run:
```bash
bun typecheck && bun lint
```

- [ ] **Step 5: Commit**

```bash
git add tests-integration/kb-architecture/run.ts tests-integration/kb-architecture/phases/1-ingest.ts
git commit -m "Integrate Orama index building into test runner pipeline"
```

---

### Task 7: Run the test and compare results

**Files:** None (execution only)

- [ ] **Step 1: Run the orama-bm25 config**

Run:
```bash
bun run tests-integration/kb-architecture/run.ts --config orama-bm25
```

Expected: Phases 1-5 complete without errors. Watch for:
- Phase 2.5 prints `[Orama] Indexed N entries` with N > 0
- Phase 4 prints buildContext and ask timings
- Phase 5 prints score summary

- [ ] **Step 2: Generate comparative report**

Run:
```bash
bun run tests-integration/kb-architecture/run.ts --report
```

Compare `orama-bm25` against `noise-reduce-AC` and `baseline-no-kb` on:
- `contextNoise` (lower is better)
- `contextRelevance` (higher is better)
- `avgScore` (higher is better)
- `avgTime` (lower is better)

- [ ] **Step 3: Commit any fixes needed during the run**

If fixes were needed:
```bash
git add -u
git commit -m "Fix Orama integration issues found during test run"
```

- [ ] **Step 4: Format and final commit**

```bash
bun format
git add -u
git commit -m "Format code after Orama integration"
```

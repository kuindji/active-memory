# Traditional IR Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce KB context noise from 63% to <30% by applying traditional IR techniques: DB-level faceted filtering, query intent classification, and field-weighted indexing.

**Architecture:** Framework extensions (IndexDef, SearchQuery filters, schema registry) provide generic support for indexed domain fields and query filters. KB domain denormalizes classification/topics onto memory records, classifies query intent via a fast LLM call, then performs a single filtered search instead of 6 unfiltered searches. Progressive fallback widens filters if results are sparse.

**Tech Stack:** SurrealDB (BM25, indexes, WHERE clauses), TypeScript, bun test

---

### Task 1: Extend IndexDef with condition field

**Files:**
- Modify: `src/core/types.ts:71-76`

- [ ] **Step 1: Add `condition` to IndexDef**

In `src/core/types.ts`, add the optional `condition` field:

```typescript
export interface IndexDef {
    name: string;
    fields: string[];
    type?: "unique" | "search" | "hnsw";
    config?: Record<string, unknown>;
    condition?: string;
}
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS — `condition` is optional, no existing code breaks.

- [ ] **Step 3: Commit**

```bash
git add src/core/types.ts
git commit -m "Add optional condition field to IndexDef for conditional indexes"
```

---

### Task 2: Extend schema registry to support BM25 params and conditional indexes

**Files:**
- Modify: `src/core/schema-registry.ts:238-251`
- Test: `tests/schema-registry.test.ts`

- [ ] **Step 1: Write failing tests for BM25 params and conditional indexes**

Add to `tests/schema-registry.test.ts`:

```typescript
test("defineIndex emits BM25(k1, b) when config provides them", async () => {
    await registry.registerCore();
    const schema: DomainSchema = {
        nodes: [{
            name: "memory",
            fields: [],
            indexes: [{
                name: "idx_test_bm25",
                fields: ["content"],
                type: "search",
                config: { analyzer: "memory_content", k1: 2.0, b: 0.5 },
            }],
        }],
        edges: [],
    };
    await registry.registerDomain("test_bm25", schema);
    // Verify index was created by querying the INFO
    const [info] = await db.query<[Record<string, unknown>]>("INFO FOR TABLE memory");
    const indexes = info?.indexes ?? info?.ix ?? {};
    const indexStr = JSON.stringify(indexes);
    expect(indexStr).toContain("idx_test_bm25");
});

test("defineIndex appends WHERE clause for conditional indexes", async () => {
    await registry.registerCore();
    const schema: DomainSchema = {
        nodes: [{
            name: "memory",
            fields: [
                { name: "active", type: "option<bool>" },
            ],
            indexes: [{
                name: "idx_test_conditional",
                fields: ["content"],
                type: "search",
                config: { analyzer: "memory_content" },
                condition: "active = true",
            }],
        }],
        edges: [],
    };
    await registry.registerDomain("test_cond", schema);
    const [info] = await db.query<[Record<string, unknown>]>("INFO FOR TABLE memory");
    const indexes = info?.indexes ?? info?.ix ?? {};
    const indexStr = JSON.stringify(indexes);
    expect(indexStr).toContain("idx_test_conditional");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/schema-registry.test.ts`
Expected: FAIL — indexes on existing nodes aren't processed during field merge.

- [ ] **Step 3: Update schema registry to process indexes on existing nodes**

In `src/core/schema-registry.ts`, in the `registerNodes` method, after the field merge block (`existing.fields.push(...newFields);`), add index processing:

```typescript
existing.fields.push(...newFields);

// Also create any declared indexes for existing nodes
if (node.indexes) {
    for (const idx of node.indexes) {
        await this.defineIndex(node.name, idx);
    }
}

existing.contributors.push(contributor);
```

- [ ] **Step 4: Update defineIndex to support BM25(k1, b) and WHERE condition**

Replace the search index branch in `defineIndex` (line ~246-249):

```typescript
} else if (idx.type === "search") {
    const analyzer = (idx.config?.analyzer as string) ?? "ascii";
    const k1 = idx.config?.k1 as number | undefined;
    const b = idx.config?.b as number | undefined;
    if (k1 !== undefined && b !== undefined) {
        query += ` FULLTEXT ANALYZER ${analyzer} BM25(${k1}, ${b})`;
    } else {
        query += ` FULLTEXT ANALYZER ${analyzer} BM25`;
    }
}
```

After the type-specific block, before `await this.db.query(query)`:

```typescript
if (idx.condition) {
    query += ` WHERE ${idx.condition}`;
}
```

- [ ] **Step 5: Run tests**

Run: `bun test tests/schema-registry.test.ts`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `bun test`
Expected: All existing tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/core/schema-registry.ts tests/schema-registry.test.ts
git commit -m "Support BM25(k1,b) params, conditional indexes, and indexes on existing nodes"
```

---

### Task 3: Add filters to SearchQuery and implement in search engine

**Files:**
- Modify: `src/core/types.ts:108-126`
- Modify: `src/core/search-engine.ts`
- Test: `tests/search-engine.test.ts`

- [ ] **Step 1: Add `filters` to SearchQuery type**

In `src/core/types.ts`, add to `SearchQuery`:

```typescript
export interface SearchQuery extends MemoryFilter {
    text?: string;
    mode?: "vector" | "fulltext" | "hybrid" | "graph";
    traversal?: {
        from: string | string[];
        pattern: string;
        depth?: number;
    };
    tokenBudget?: number;
    minScore?: number;
    weights?: {
        vector?: number;
        fulltext?: number;
        graph?: number;
    };
    context?: RequestContext;
    rerank?: boolean;
    rerankThreshold?: number;
    filters?: Record<string, unknown>;
}
```

- [ ] **Step 2: Write failing test for filtered fulltext search**

Add to `tests/search-engine.test.ts`:

```typescript
describe("filtered search", () => {
    test("fulltextSearch respects filters on memory fields", async () => {
        // Add a custom field to memory table
        await db.query("DEFINE FIELD IF NOT EXISTS classification ON memory TYPE option<string>");

        await store.createNode("memory", {
            content: "Byzantine military tactics in siege warfare",
            created_at: Date.now(),
            token_count: 7,
            classification: "fact",
        });
        await store.createNode("memory", {
            content: "Byzantine architecture and building techniques",
            created_at: Date.now(),
            token_count: 6,
            classification: "reference",
        });
        await store.createNode("memory", {
            content: "Byzantine trade routes and commerce",
            created_at: Date.now(),
            token_count: 6,
            classification: "fact",
        });

        const result = await search.search({
            text: "Byzantine",
            mode: "fulltext",
            filters: { classification: ["fact"] },
        });

        expect(result.entries.length).toBe(2);
        for (const entry of result.entries) {
            expect(entry.content).not.toContain("architecture");
        }
    });

    test("search without filters returns all matches", async () => {
        await db.query("DEFINE FIELD IF NOT EXISTS classification ON memory TYPE option<string>");

        await store.createNode("memory", {
            content: "Byzantine military tactics",
            created_at: Date.now(),
            token_count: 4,
            classification: "fact",
        });
        await store.createNode("memory", {
            content: "Byzantine architecture overview",
            created_at: Date.now(),
            token_count: 4,
            classification: "reference",
        });

        const result = await search.search({
            text: "Byzantine",
            mode: "fulltext",
        });

        expect(result.entries.length).toBe(2);
    });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/search-engine.test.ts`
Expected: FAIL — filters not implemented.

- [ ] **Step 4: Implement filter clause builder in SearchEngine**

Add private method to `SearchEngine` class in `src/core/search-engine.ts`:

```typescript
private buildFilterClauses(filters: Record<string, unknown>): {
    clauses: string[];
    vars: Record<string, unknown>;
} {
    const clauses: string[] = [];
    const vars: Record<string, unknown> = {};
    let i = 0;
    for (const [field, value] of Object.entries(filters)) {
        if (value !== null && typeof value === "object" && !Array.isArray(value)) {
            const obj = value as Record<string, unknown>;
            if ("containsAny" in obj && Array.isArray(obj.containsAny)) {
                clauses.push(`${field} CONTAINSANY $flt${i}`);
                vars[`flt${i}`] = obj.containsAny;
            }
        } else if (Array.isArray(value)) {
            clauses.push(`${field} IN $flt${i}`);
            vars[`flt${i}`] = value;
        } else {
            clauses.push(`${field} = $flt${i}`);
            vars[`flt${i}`] = value;
        }
        i++;
    }
    return { clauses, vars };
}
```

- [ ] **Step 5: Apply filters in fulltextSearch**

In `fulltextSearch`, modify the BM25 query to include filter clauses:

```typescript
private async fulltextSearch(query: SearchQuery): Promise<Map<string, ScoredMemory>> {
    const candidates = new Map<string, ScoredMemory>();
    if (!query.text) return candidates;

    let filterSql = "";
    let filterVars: Record<string, unknown> = {};
    if (query.filters && Object.keys(query.filters).length > 0) {
        const { clauses, vars } = this.buildFilterClauses(query.filters);
        filterSql = clauses.length > 0 ? ` AND ${clauses.join(" AND ")}` : "";
        filterVars = vars;
    }

    let rows: MemoryRow[] = [];
    try {
        rows = await this.store.query<MemoryRow[]>(
            `SELECT *, search::score(1) AS score FROM memory
             WHERE content @1@ $text${filterSql}
             ORDER BY score DESC
             LIMIT $limit`,
            { text: query.text, limit: query.limit ?? 10, ...filterVars },
        );
    } catch {
        // BM25 index may not be defined; fall back to CONTAINS
    }

    if (!rows || rows.length === 0) {
        rows = await this.containsFallback(query.text, query.limit ?? 10);
    }

    for (const row of rows) {
        const id = String(row.id);
        const tags = await this.getMemoryTags(id);
        candidates.set(id, {
            id,
            content: row.content,
            score: row.score ?? 0.5,
            scores: { fulltext: row.score ?? 0.5 },
            tags,
            domainAttributes: {},
            eventTime: row.event_time ?? null,
            createdAt: row.created_at,
            tokenCount: row.token_count,
        });
    }

    return candidates;
}
```

- [ ] **Step 6: Apply filters in vectorSearch**

In `vectorSearch`, similarly append filter clauses:

```typescript
private async vectorSearch(query: SearchQuery): Promise<Map<string, ScoredMemory>> {
    const candidates = new Map<string, ScoredMemory>();
    if (!this.embeddingAdapter || !query.text) return candidates;

    const queryVec = await this.embeddingAdapter.embed(query.text);

    let filterSql = "";
    let filterVars: Record<string, unknown> = {};
    if (query.filters && Object.keys(query.filters).length > 0) {
        const { clauses, vars } = this.buildFilterClauses(query.filters);
        filterSql = clauses.length > 0 ? ` AND ${clauses.join(" AND ")}` : "";
        filterVars = vars;
    }

    const rows = await this.store.query<(MemoryRow & { score: number })[]>(
        `SELECT *, vector::similarity::cosine(embedding, $queryVec) AS score
         FROM memory
         WHERE embedding IS NOT NONE${filterSql}
         ORDER BY score DESC
         LIMIT $limit`,
        { queryVec, limit: query.limit ?? 10, ...filterVars },
    );

    if (!rows) return candidates;

    for (const row of rows) {
        const id = String(row.id);
        const tags = await this.getMemoryTags(id);
        candidates.set(id, {
            id,
            content: row.content,
            score: row.score,
            scores: { vector: row.score },
            tags,
            domainAttributes: {},
            eventTime: row.event_time ?? null,
            createdAt: row.created_at,
            tokenCount: row.token_count,
        });
    }

    return candidates;
}
```

- [ ] **Step 7: Run tests**

Run: `bun test tests/search-engine.test.ts`
Expected: PASS

- [ ] **Step 8: Run full test suite**

Run: `bun test`
Expected: All existing tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/core/types.ts src/core/search-engine.ts tests/search-engine.test.ts
git commit -m "Add SearchQuery.filters for DB-level field filtering in vector and fulltext search"
```

---

### Task 4: Add QueryIntent type and classifyQueryIntent function

**Files:**
- Modify: `src/domains/kb/types.ts`
- Modify: `src/domains/kb/utils.ts`
- Create: `tests/query-intent.test.ts`

- [ ] **Step 1: Add QueryIntent type**

In `src/domains/kb/types.ts`, add:

```typescript
export interface QueryIntent {
    classifications: KbClassification[];
    keywords: string[];
    topic?: string;
}
```

- [ ] **Step 2: Write failing test for classifyQueryIntent**

Create `tests/query-intent.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { classifyQueryIntent } from "../src/domains/kb/utils.js";
import type { LLMAdapter } from "../src/core/types.js";

function mockLlm(response: string): LLMAdapter {
    return {
        extract: async () => [],
        classify: async () => "fact",
        consolidate: async () => "",
        generate: async () => response,
    };
}

describe("classifyQueryIntent", () => {
    test("parses valid JSON response from LLM", async () => {
        const llm = mockLlm(
            '{"classifications": ["fact", "reference"], "keywords": ["commission", "rate"], "topic": "commissions"}',
        );
        const intent = await classifyQueryIntent("What is the commission rate?", llm);
        expect(intent.classifications).toEqual(["fact", "reference"]);
        expect(intent.keywords).toEqual(["commission", "rate"]);
        expect(intent.topic).toBe("commissions");
    });

    test("filters out invalid classifications", async () => {
        const llm = mockLlm(
            '{"classifications": ["fact", "invalid", "how-to"], "keywords": ["test"]}',
        );
        const intent = await classifyQueryIntent("test query", llm);
        expect(intent.classifications).toEqual(["fact", "how-to"]);
    });

    test("returns all classifications on LLM failure", async () => {
        const llm: LLMAdapter = {
            extract: async () => [],
            classify: async () => "fact",
            consolidate: async () => "",
            generate: async () => {
                throw new Error("LLM unavailable");
            },
        };
        const intent = await classifyQueryIntent("test query", llm);
        expect(intent.classifications).toHaveLength(6);
        expect(intent.keywords.length).toBeGreaterThan(0);
    });

    test("returns all classifications when LLM returns unparseable response", async () => {
        const llm = mockLlm("I don't understand the question");
        const intent = await classifyQueryIntent("test query", llm);
        expect(intent.classifications).toHaveLength(6);
    });

    test("returns all classifications when generate is not available", async () => {
        const llm: LLMAdapter = {
            extract: async () => [],
            classify: async () => "fact",
            consolidate: async () => "",
        };
        const intent = await classifyQueryIntent("test query", llm);
        expect(intent.classifications).toHaveLength(6);
    });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/query-intent.test.ts`
Expected: FAIL — `classifyQueryIntent` doesn't exist yet.

- [ ] **Step 4: Implement classifyQueryIntent**

In `src/domains/kb/utils.ts`, add:

```typescript
import type { QueryIntent, KbClassification } from "./types.js";
import type { LLMAdapter } from "../../core/types.js";

export const ALL_CLASSIFICATIONS: KbClassification[] = [
    "fact", "definition", "how-to", "reference", "concept", "insight",
];

const QUERY_INTENT_PROMPT =
    "Classify what type of knowledge answers this query. " +
    "Types: definition, concept, fact, reference, how-to, insight. " +
    'Return JSON: {"classifications": [...], "keywords": [...], "topic": "..."}\n\n' +
    "Query: ";

export async function classifyQueryIntent(
    text: string,
    llm: LLMAdapter,
): Promise<QueryIntent> {
    const fallback: QueryIntent = {
        classifications: [...ALL_CLASSIFICATIONS],
        keywords: text.toLowerCase().split(/\s+/).filter((w) => w.length > 2),
    };

    if (!llm.generate) return fallback;

    try {
        const response = await llm.generate(QUERY_INTENT_PROMPT + text);
        const match = response.match(/\{[\s\S]*\}/);
        if (!match) return fallback;

        const parsed = JSON.parse(match[0]) as {
            classifications?: string[];
            keywords?: string[];
            topic?: string;
        };

        const validClassifications = (parsed.classifications ?? []).filter(
            (c): c is KbClassification => VALID_CLASSIFICATIONS.has(c),
        );

        if (validClassifications.length === 0) return fallback;

        return {
            classifications: validClassifications,
            keywords: Array.isArray(parsed.keywords) && parsed.keywords.length > 0
                ? parsed.keywords
                : fallback.keywords,
            topic: parsed.topic || undefined,
        };
    } catch {
        return fallback;
    }
}
```

- [ ] **Step 5: Run tests**

Run: `bun test tests/query-intent.test.ts`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `bun test`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/domains/kb/types.ts src/domains/kb/utils.ts tests/query-intent.test.ts
git commit -m "Add query intent classification for KB domain"
```

---

### Task 5: Add classification and topics fields to KB schema and denormalize during ingestion

**Files:**
- Modify: `src/domains/kb/kb-domain.ts` (schema section)
- Modify: `src/domains/kb/inbox.ts`

- [ ] **Step 1: Extend KB domain schema to declare fields on memory**

In `src/domains/kb/kb-domain.ts`, in the `createKbDomain` return object, update `schema`:

```typescript
schema: {
    nodes: [
        {
            name: "memory",
            fields: [
                { name: "classification", type: "option<string>" },
                { name: "topics", type: "option<array<string>>" },
            ],
            indexes: [
                { name: "idx_memory_classification", fields: ["classification"] },
                { name: "idx_memory_topics", fields: ["topics"] },
            ],
        },
    ],
    edges: [
        { name: "supersedes", from: "memory", to: "memory" },
        {
            name: "related_knowledge",
            from: "memory",
            to: "memory",
            fields: [{ name: "relationship", type: "string" }],
        },
    ],
},
```

- [ ] **Step 2: Denormalize classification onto memory during inbox Stage 2 (tag & attribute)**

In `src/domains/kb/inbox.ts`, in the Stage 2 loop inside `processInboxBatch`, after `await context.tagMemory(entry.memory.id, classTagId)`, add:

```typescript
// Denormalize classification onto memory record for DB-level filtering
try {
    await context.graph.query(
        "UPDATE $memId SET classification = $cls",
        {
            memId: new StringRecordId(entry.memory.id),
            cls: classification,
        },
    );
} catch {
    /* best-effort denormalization */
}
```

Add the `StringRecordId` import at the top of `inbox.ts`:

```typescript
import { StringRecordId } from "surrealdb";
```

- [ ] **Step 3: Denormalize topics onto memory during inbox Stage 3 (topic linking)**

In `src/domains/kb/utils.ts`, in `linkToTopicsBatch`, after the topic linking loop completes, add topic denormalization. Replace the function:

```typescript
export async function linkToTopicsBatch(
    context: DomainContext,
    entries: OwnedMemory[],
): Promise<void> {
    const topicsMap = await batchExtractTopics(context, entries);

    for (const entry of entries) {
        const topicNames = topicsMap.get(entry.memory.id) ?? [];
        const validTopics: string[] = [];
        for (const topicName of topicNames) {
            const trimmed = topicName.trim();
            if (!trimmed) continue;
            await linkSingleTopic(context, entry.memory.id, trimmed);
            validTopics.push(trimmed);
        }

        // Denormalize topics onto memory record for DB-level filtering
        if (validTopics.length > 0) {
            try {
                await context.graph.query(
                    "UPDATE $memId SET topics = $topics",
                    {
                        memId: new StringRecordId(entry.memory.id),
                        topics: validTopics,
                    },
                );
            } catch {
                /* best-effort denormalization */
            }
        }
    }
}
```

Add `StringRecordId` import to `utils.ts`:

```typescript
import { StringRecordId } from "surrealdb";
```

- [ ] **Step 4: Run full test suite**

Run: `bun test`
Expected: All tests pass — schema extension is additive (option types), denormalization is fire-and-forget.

- [ ] **Step 5: Commit**

```bash
git add src/domains/kb/kb-domain.ts src/domains/kb/inbox.ts src/domains/kb/utils.ts
git commit -m "Denormalize classification and topics onto memory records for DB filtering"
```

---

### Task 6: Add bootstrap migration for existing KB data

**Files:**
- Modify: `src/domains/kb/kb-domain.ts`

- [ ] **Step 1: Add bootstrap function to KB domain config**

In `src/domains/kb/kb-domain.ts`, add a `bootstrap` method to the `createKbDomain` return object, after the `search` property:

```typescript
async bootstrap(context: DomainContext) {
    // Backfill classification/topics from owned_by attributes for existing entries
    const domainRef = new StringRecordId(`domain:${KB_DOMAIN_ID}`);
    const rows = await context.graph.query<
        Array<{ in: string; attributes: Record<string, unknown> }>
    >(
        `SELECT in, attributes FROM owned_by WHERE out = $domainId AND in.classification IS NONE`,
        { domainId: domainRef },
    );

    if (!rows || rows.length === 0) return;

    for (const row of rows) {
        const cls = row.attributes?.classification as string | undefined;
        if (!cls) continue;

        const updates: Record<string, unknown> = { classification: cls };

        // Try to get topics from about_topic edges
        const topicRows = await context.graph.query<
            Array<{ content: string }>
        >(
            `SELECT (SELECT content FROM ONLY $parent.out).content AS content FROM about_topic WHERE in = $memId`,
            { memId: new StringRecordId(row.in) },
        );
        if (topicRows && topicRows.length > 0) {
            updates.topics = topicRows
                .map((t) => t.content)
                .filter((c) => typeof c === "string" && c.length > 0);
        }

        await context.graph.query(
            "UPDATE $memId SET classification = $cls, topics = $topics",
            {
                memId: new StringRecordId(row.in),
                cls: updates.classification,
                topics: updates.topics ?? [],
            },
        );
    }
},
```

- [ ] **Step 2: Run full test suite**

Run: `bun test`
Expected: All tests pass. Bootstrap only runs for memories where `classification IS NONE`, which is a no-op for tests that don't create pre-existing data.

- [ ] **Step 3: Commit**

```bash
git add src/domains/kb/kb-domain.ts
git commit -m "Add bootstrap migration to backfill classification/topics on existing memories"
```

---

### Task 7: Rewrite KB buildContext to use intent-driven filtered search

**Files:**
- Modify: `src/domains/kb/kb-domain.ts`
- Test: `tests/build-context.test.ts`

- [ ] **Step 1: Write test for intent-filtered buildContext**

Add to `tests/build-context.test.ts`:

```typescript
import { createTopicDomain } from "../src/domains/topic/topic-domain.js";

describe("KB buildContext with intent filtering", () => {
    let kbEngine: MemoryEngine;

    beforeEach(async () => {
        kbEngine = new MemoryEngine();
        await kbEngine.initialize({
            connection: "mem://",
            namespace: "test",
            database: `test_kb_intent_${Date.now()}`,
            llm: new MockLLMAdapter(),
        });
        await kbEngine.registerDomain(createKbDomain());
        await kbEngine.registerDomain(createTopicDomain());
    });

    afterEach(async () => {
        await kbEngine.close();
    });

    test("buildContext returns results when KB has entries", async () => {
        // Ingest entries that will get classified during inbox processing
        await kbEngine.ingest("HTTP 429 means Too Many Requests", { domains: ["kb"] });
        await kbEngine.ingest("To reset a PostgreSQL sequence, use ALTER SEQUENCE", { domains: ["kb"] });
        await kbEngine.processInbox();
        await kbEngine.processInbox();

        const result = await kbEngine.buildContext("HTTP status codes", { domains: ["kb"] });
        expect(result.context.length).toBeGreaterThan(0);
        expect(result.memories.length).toBeGreaterThan(0);
    });

    test("buildContext falls back gracefully when intent classification fails", async () => {
        await kbEngine.ingest("The capital of France is Paris", { domains: ["kb"] });
        await kbEngine.processInbox();
        await kbEngine.processInbox();

        // MockLLMAdapter.generate returns generic response, so classifyQueryIntent will fall back to all classifications
        const result = await kbEngine.buildContext("France", { domains: ["kb"] });
        expect(typeof result.context).toBe("string");
    });
});
```

- [ ] **Step 2: Run tests to see current state**

Run: `bun test tests/build-context.test.ts`
Expected: PASS or FAIL depending on MockLLMAdapter behavior — establishes baseline.

- [ ] **Step 3: Rewrite buildContext**

Replace the `buildContext` method in `src/domains/kb/kb-domain.ts`. Remove the 6-search-call approach and replace with intent-driven single search:

```typescript
async buildContext(
    text: string,
    budgetTokens: number,
    context: DomainContext,
): Promise<ContextResult> {
    const empty: ContextResult = { context: "", memories: [], totalTokens: 0 };
    if (!text) return empty;

    const minScore = context.getTunableParam("minScore") ?? 0.5;
    const defPct = context.getTunableParam("definitionBudgetPct") ?? 0.3;
    const factPct = context.getTunableParam("factBudgetPct") ?? 0.4;
    const howtoPct = Math.max(0.1, 1.0 - defPct - factPct);
    const useEmbeddingRerank = (context.getTunableParam("embeddingRerank") ?? 1) > 0;
    const useLlmRerank = (context.getTunableParam("llmRerank") ?? 0) > 0;
    const useIntent = (context.getTunableParam("useQueryIntent") ?? 1) > 0;

    // Adaptive context: if KB is small enough, return everything
    const useAdaptiveContext = (context.getTunableParam("adaptiveContext") ?? 1) > 0;
    if (useAdaptiveContext) {
        const fullResult = await tryFullContextReturn(budgetTokens, context);
        if (fullResult) return fullResult;
    }

    // Step 1: Classify query intent
    let intent: QueryIntent | null = null;
    if (useIntent) {
        intent = await classifyQueryIntent(text, context.llmAt("low"));
    }

    const now = Date.now();

    // Step 2: Build filters from intent
    const filters: Record<string, unknown> = {};
    if (intent && intent.classifications.length < ALL_CLASSIFICATIONS.length) {
        filters.classification = intent.classifications;
    }

    // Step 3: Search with filters
    const searchText = intent?.keywords?.length ? intent.keywords.join(" ") : text;
    let results = await context.search({
        text: searchText,
        tags: [KB_TAG],
        minScore,
        rerank: useEmbeddingRerank,
        rerankThreshold: minScore,
        filters: Object.keys(filters).length > 0 ? filters : undefined,
        tokenBudget: budgetTokens,
    });

    let entries = results.entries.filter((e) => isEntryValid(getKbAttrs(e.domainAttributes), now));

    // Step 4: Progressive fallback if too few results
    const MIN_RESULTS = 3;
    if (entries.length < MIN_RESULTS && Object.keys(filters).length > 0) {
        // Widen: drop classification filter
        const widerResults = await context.search({
            text,
            tags: [KB_TAG],
            minScore,
            rerank: useEmbeddingRerank,
            rerankThreshold: minScore,
            tokenBudget: budgetTokens,
        });
        entries = widerResults.entries.filter((e) =>
            isEntryValid(getKbAttrs(e.domainAttributes), now),
        );
    }

    if (entries.length === 0) return empty;

    // Step 5: Optional LLM rerank
    if (useLlmRerank && context.llm) {
        entries = await llmRerankMemories(text, entries, context.llm);
    }

    // Step 6: Group by classification for output
    const groups = new Map<string, ScoredMemory[]>();
    for (const entry of entries) {
        const attrs = getKbAttrs(entry.domainAttributes);
        const cls = (attrs?.classification as string) ?? "fact";
        let group = groups.get(cls);
        if (!group) {
            group = [];
            groups.set(cls, group);
        }
        group.push(entry);
    }

    const sections: string[] = [];
    const allMemories: ScoredMemory[] = [];

    // Definitions & Concepts
    const defConcept = [
        ...(groups.get("definition") ?? []),
        ...(groups.get("concept") ?? []),
    ];
    if (defConcept.length > 0) {
        const definitionBudget = Math.floor(budgetTokens * defPct);
        const lines = truncateToTokenBudget(defConcept, definitionBudget);
        if (lines.length > 0) {
            sections.push(`[Definitions & Concepts]\n${lines.join("\n")}`);
            allMemories.push(...defConcept.slice(0, lines.length));
        }
    }

    // Facts & References
    const factRef = [
        ...(groups.get("fact") ?? []),
        ...(groups.get("reference") ?? []),
    ];
    if (factRef.length > 0) {
        const factBudget = Math.floor(budgetTokens * factPct);
        const lines = truncateToTokenBudget(factRef, factBudget);
        if (lines.length > 0) {
            sections.push(`[Facts & References]\n${lines.join("\n")}`);
            allMemories.push(...factRef.slice(0, lines.length));
        }
    }

    // How-Tos & Insights
    const howtoInsight = [
        ...(groups.get("how-to") ?? []),
        ...(groups.get("insight") ?? []),
    ];
    if (howtoInsight.length > 0) {
        const howtoBudget = Math.floor(budgetTokens * howtoPct);
        const lines = truncateToTokenBudget(howtoInsight, howtoBudget);
        if (lines.length > 0) {
            sections.push(`[How-Tos & Insights]\n${lines.join("\n")}`);
            allMemories.push(...howtoInsight.slice(0, lines.length));
        }
    }

    const finalContext = sections.join("\n\n");

    // Record access for importance tracking (fire-and-forget)
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
```

Update imports at top of `kb-domain.ts`:

```typescript
import { classifyQueryIntent } from "./utils.js";
import type { QueryIntent } from "./types.js";
```

Import `ALL_CLASSIFICATIONS` from utils (defined in Task 4):

```typescript
import { classifyQueryIntent, ALL_CLASSIFICATIONS } from "./utils.js";
```

Remove the now-unused functions: `findMatchingTopicMemoryIds`, `getMemoryIdsForTopics`, `applyTopicFilter`, `deduplicateMemories` (if no longer referenced). Check each usage before removing.

- [ ] **Step 4: Add new tunable params**

In the `tunableParams` array of `createKbDomain`, add:

```typescript
{ name: "useQueryIntent", default: 1, min: 0, max: 1, step: 1 },
{ name: "intentFallbackWidth", default: 2, min: 0, max: 6, step: 1 },
```

- [ ] **Step 5: Run tests**

Run: `bun test tests/build-context.test.ts`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `bun test`
Expected: All tests pass.

- [ ] **Step 7: Format and lint**

Run: `bun format && bun run lint && bun run typecheck`
Expected: Clean.

- [ ] **Step 8: Commit**

```bash
git add src/domains/kb/kb-domain.ts src/domains/kb/utils.ts src/domains/kb/types.ts tests/build-context.test.ts
git commit -m "Rewrite KB buildContext to use intent-driven filtered search"
```

---

### Task 8: Add integration test configs and run tests

**Files:**
- Modify: `tests-integration/kb-architecture/types.ts:41-45`
- Modify: `tests-integration/kb-architecture/engine-factory.ts:66-80`
- Modify: `tests-integration/kb-architecture/configs.ts:183` (append before closing bracket)

- [ ] **Step 1: Add useQueryIntent to ArchitectureConfig noiseReduction**

In `tests-integration/kb-architecture/types.ts`, update the `noiseReduction` property of `ArchitectureConfig`:

```typescript
noiseReduction?: {
    tightenFilters?: boolean;
    embeddingRerank?: boolean;
    llmRerank?: boolean;
    useQueryIntent?: boolean;
};
```

- [ ] **Step 2: Add intent-filtered config to engine factory**

In `tests-integration/kb-architecture/engine-factory.ts`, in the block where tunable param overrides are applied (around line 66-80, inside `if (config.noiseReduction)`), add after the `llmRerank` check:

```typescript
if (config.noiseReduction.useQueryIntent !== undefined) {
    overrides.useQueryIntent = config.noiseReduction.useQueryIntent ? 1 : 0;
}
```

- [ ] **Step 3: Add test configs**

In `tests-integration/kb-architecture/configs.ts`, add before the closing `];` on line 183:

```typescript
    {
        name: "intent-filtered",
        pipeline: NO_SUPERSESSION_PIPELINE,
        search: HYBRID_DEFAULT,
        consolidate: false,
        contextBudget: 2000,
        noiseReduction: {
            tightenFilters: true,
            embeddingRerank: true,
            useQueryIntent: true,
        },
    },
    {
        name: "intent-only",
        pipeline: NO_SUPERSESSION_PIPELINE,
        search: HYBRID_DEFAULT,
        consolidate: false,
        contextBudget: 2000,
        noiseReduction: {
            tightenFilters: true,
            useQueryIntent: true,
        },
    },
```

- [ ] **Step 4: Run format, lint, typecheck**

Run: `bun format && bun run lint && bun run typecheck`
Expected: Clean.

- [ ] **Step 5: Commit**

```bash
git add tests-integration/kb-architecture/
git commit -m "Add intent-filtered test configs for architecture testing loop"
```

---

### Task 9: Run integration tests and validate results

- [ ] **Step 1: Run baseline test on Byzantine dataset**

Run the architecture testing loop with the `intent-filtered` config on the Byzantine dataset. Compare against noise-reduce-AC baseline (4.70/5, 63% noise).

- [ ] **Step 2: Run baseline test on TheFloorr dataset**

Run with `intent-filtered` on TheFloorr dataset. Compare against noise-reduce-AC baseline (4.00/5, 63% noise).

- [ ] **Step 3: Run intent-only test**

Run `intent-only` config to isolate the contribution of query intent classification without embedding rerank.

- [ ] **Step 4: Analyze results and log findings**

Log results via `taskflow-cli log info`. Key metrics to compare:
- Quality score (target: >=4.0/5)
- Noise % (target: <30%)
- Relevance %
- Latency (should not regress significantly)

- [ ] **Step 5: Commit checkpoint files**

```bash
git add tests-integration/kb-architecture/checkpoints/
git commit -m "Add intent-filtered test results"
```

---

### Task 10: Final cleanup and format

- [ ] **Step 1: Remove dead code**

Check if any functions in `kb-domain.ts` are now unused after the buildContext rewrite:
- `findMatchingTopicMemoryIds` — check if still used in `search.expand`
- `getMemoryIdsForTopics` — check if still used
- `applyTopicFilter` — likely unused
- `deduplicateMemories` — likely unused

Remove only functions confirmed unused. Keep `search.expand` and `search.rank` if they're still wired.

- [ ] **Step 2: Run full test suite**

Run: `bun test`
Expected: All tests pass.

- [ ] **Step 3: Format**

Run: `bun format`

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "Clean up unused functions after buildContext rewrite"
```

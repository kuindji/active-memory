# Traditional IR Improvements for KB Domain

**Date:** 2026-04-06
**Branch:** task/knowledge-base-architecture-testing-loop
**Status:** Design

## Problem

The KB domain's retrieval pipeline produces 63% context noise at best (with A+C noise reduction). Same-domain entries have similar embeddings and share vocabulary, so neither vector search nor BM25 discriminates well between relevant and irrelevant entries. Traditional information retrieval systems solved this decades ago with faceted search, field-weighted scoring, and query intent classification.

## Goal

Reduce context noise from 63% to <30% while maintaining quality scores >=4.0/5 on both test datasets (Byzantine Empire and TheFloorr Business). No breaking changes to other domains.

## Approach

Apply traditional IR techniques at two levels:

1. **Framework level** — extend schema registry and search engine to support indexed domain fields on `memory`, DB-level query filters, and BM25 parameter tuning
2. **KB domain level** — denormalize classification/topics onto memory records, add query intent classification via LLM, rewrite `buildContext` to use intent-driven filtered search

## Design

### 1. Framework: IndexDef Extension

**File:** `src/core/types.ts`

Add optional fields to `IndexDef`:

```typescript
export interface IndexDef {
    name: string;
    fields: string[];
    type?: "unique" | "search" | "hnsw";
    config?: Record<string, unknown>;  // existing
    condition?: string;  // NEW: WHERE clause for conditional indexes
}
```

The `config` object for `search` type indexes gains optional BM25 parameters:

```typescript
// Current usage:
{ analyzer: "memory_content" }

// Extended usage:
{ analyzer: "memory_content", k1: 1.2, b: 0.75 }
```

These are additive optional fields. No existing code uses them.

### 2. Framework: Schema Registry Changes

**File:** `src/core/schema-registry.ts`

**2a. Index creation on field merge**

In `registerNodes`, when merging fields into an existing node (the `if (existing)` branch), indexes declared on the incoming `NodeDef` are currently ignored. Add processing of `node.indexes` after field merge:

```typescript
// After adding new fields to existing node...
if (node.indexes) {
    for (const idx of node.indexes) {
        await this.defineIndex(node.name, idx);
    }
}
```

**2b. BM25 parameter support in defineIndex**

Update `defineIndex` to emit `BM25(k1, b)` when config provides these values:

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

**2c. Conditional index support**

Append WHERE clause when `condition` is provided:

```typescript
if (idx.condition) {
    query += ` WHERE ${idx.condition}`;
}
```

### 3. Framework: Search Engine Filter Support

**File:** `src/core/types.ts`

Add optional `filters` to `SearchQuery`:

```typescript
export interface SearchQuery extends MemoryFilter {
    // ... existing fields ...
    filters?: Record<string, unknown>;  // NEW: field=value filters for WHERE clauses
}
```

**File:** `src/core/search-engine.ts`

**3a. Filter clause builder**

New private method to build WHERE clause fragments from filters:

```typescript
private buildFilterClauses(
    filters: Record<string, unknown>
): { clauses: string[]; vars: Record<string, unknown> } {
    const clauses: string[] = [];
    const vars: Record<string, unknown> = {};
    let i = 0;
    for (const [field, value] of Object.entries(filters)) {
        if (Array.isArray(value)) {
            // For scalar fields (e.g. classification): use IN to match any of the values
            // For array fields (e.g. topics): use CONTAINSANY
            // Caller specifies which via a convention: arrays always mean "match any"
            // SurrealDB handles both: IN works for "field IN [a,b]", CONTAINSANY for "arrayField CONTAINSANY [a,b]"
            clauses.push(`${field} IN $flt${i}`);
        } else {
            clauses.push(`${field} = $flt${i}`);
        }
        vars[`flt${i}`] = value;
        i++;
    }
    return { clauses, vars };
}
```

**Note on array filter semantics:** When the filter value is an array and the target field is also an array (like `topics`), use `CONTAINSANY` instead of `IN`. The implementation should check the field type from the schema registry or accept an explicit operator hint. The simplest approach: introduce a filter value wrapper to distinguish:

```typescript
// Simple scalar-in-list: classification IN ["fact", "reference"]
filters: { classification: ["fact", "reference"] }

// Array field containsany: topics CONTAINSANY ["military", "economy"]
filters: { topics: { containsAny: ["military", "economy"] } }
```

This avoids ambiguity between "field is one of these values" vs "array field overlaps with these values".

**3b. Apply filters in vectorSearch**

When `query.filters` is provided, append filter clauses:

```typescript
// Current:
WHERE embedding IS NOT NONE

// With filters:
WHERE embedding IS NOT NONE AND classification = $flt0 AND ...
```

**3c. Apply filters in fulltextSearch**

Same pattern — append filter clauses after the BM25 match:

```typescript
// Current:
WHERE content @1@ $text

// With filters:
WHERE content @1@ $text AND classification = $flt0 AND ...
```

Filters are optional. When not provided, queries are unchanged. Non-breaking.

### 4. KB Domain: Schema Extension

**File:** `src/domains/kb/kb-domain.ts` (DomainConfig.schema)

KB declares indexed fields on the memory table:

```typescript
schema: {
    nodes: [{
        name: "memory",
        fields: [
            { name: "classification", type: "option<string>" },
            { name: "topics", type: "option<array<string>>" },
        ],
        indexes: [
            { name: "idx_memory_classification", fields: ["classification"] },
            { name: "idx_memory_topics", fields: ["topics"] },
        ],
    }],
    edges: [
        { name: "supersedes", from: "memory", to: "memory" },
        {
            name: "related_knowledge",
            from: "memory",
            to: "memory",
            fields: [{ name: "relationship", type: "string" }],
        },
    ],
}
```

This adds two new optional fields to the memory table with standard indexes. Other domains are unaffected — these fields are `option` type and remain null for non-KB memories.

### 5. KB Domain: Denormalization During Ingestion

**File:** `src/domains/kb/inbox.ts`

After the classify+tag stage determines an entry's classification and topic assignments, write these values directly to the memory record in addition to the existing `owned_by` attributes:

```typescript
// After classification is determined:
await context.graph.query(
    "UPDATE $memId SET classification = $cls, topics = $topics",
    { memId, cls: classification, topics: topicLabels }
);
```

This denormalizes data that currently lives only on the `owned_by` edge. Both locations are kept in sync — the edge attributes remain the source of truth for domain-specific logic, while the memory fields enable DB-level filtering.

### 6. KB Domain: Bootstrap Migration

**File:** `src/domains/kb/kb-domain.ts` (DomainConfig.bootstrap)

Add a `bootstrap()` function that backfills `classification` and `topics` from existing `owned_by` attributes:

```typescript
async bootstrap(context: DomainContext): Promise<void> {
    // Find KB-owned memories missing classification field
    const rows = await context.graph.query<Array<{ in: string; attributes: Record<string, unknown> }>>(
        `SELECT in, attributes FROM owned_by
         WHERE out = $domainId AND in.classification IS NONE`,
        { domainId: new StringRecordId(`domain:${KB_DOMAIN_ID}`) }
    );

    for (const row of rows) {
        const cls = row.attributes?.classification as string;
        const topics = row.attributes?.topics as string[] ?? [];
        if (cls) {
            await context.graph.query(
                "UPDATE $memId SET classification = $cls, topics = $topics",
                { memId: new StringRecordId(row.in), cls, topics }
            );
        }
    }
}
```

Runs once on engine startup. Idempotent — only processes memories where `classification IS NONE`.

### 7. KB Domain: Query Intent Classification

**File:** `src/domains/kb/utils.ts`

New function:

```typescript
interface QueryIntent {
    classifications: string[];  // subset of: definition, concept, fact, reference, how-to, insight
    keywords: string[];         // extracted key terms for search
    topic?: string;             // inferred topic label if identifiable
}

async function classifyQueryIntent(
    text: string,
    llm: LLMAdapter
): Promise<QueryIntent>
```

**LLM prompt** (compact, targeting <100 input tokens):

```
Classify what type of knowledge answers this query.
Types: definition, concept, fact, reference, how-to, insight
Return JSON: {"classifications": [...], "keywords": [...], "topic": "..."}

Query: {text}
```

**Fallback:** If LLM call fails, returns all classifications and the original text split into keywords. This degrades gracefully to the current unfiltered behavior.

**Caching consideration:** Query intents could be cached by query text hash within a session. Not implemented initially — premature optimization.

### 8. KB Domain: Rewritten buildContext

**File:** `src/domains/kb/kb-domain.ts`

Current flow (6 search calls, 3 sections):
```
for each classification group:
    for each tag in group:
        search(text, tags=[tag]) → filter validity → apply topic boost
    deduplicate → truncate to budget
```

New flow (1 LLM call + 1-2 search calls):
```
1. intent = classifyQueryIntent(text, llm)

2. search({
     text: intent.keywords.join(" "),  // or original text
     filters: {
       classification: intent.classifications,  // DB-level hard filter
     },
     rerank: true,
     minScore,
   })

3. If intent.topic: also add topics filter
   filters.topics = [intent.topic]

4. Filter validity (isEntryValid)

5. If results < minimum threshold (e.g., 3):
   Widen search — drop classification filter, retry with topic-only
   If still sparse — drop all filters, fall back to current behavior

6. Group results by classification for output formatting
   (same section structure: Definitions & Concepts, Facts & References, How-Tos & Insights)

7. Apply token budget, record access
```

**Key behaviors:**
- **Hard classification filter** prevents irrelevant types from entering candidates
- **Progressive fallback** handles classifier errors gracefully
- **Topic filter via DB** replaces the current graph-traversal approach (`findMatchingTopicMemoryIds` + `getMemoryIdsForTopics`). Faster, simpler, same effect.
- **Output format unchanged** — still returns `ContextResult` with grouped sections
- **Adaptive context preserved** — small KBs that fit in budget still bypass search entirely

### 9. Tunable Parameters

New KB tunable params:

| Param | Default | Min | Max | Step | Purpose |
|-------|---------|-----|-----|------|---------|
| `useQueryIntent` | 1 | 0 | 1 | 1 | Toggle intent classification |
| `intentFallbackWidth` | 2 | 0 | 6 | 1 | Extra classifications to try on sparse results |

Existing params remain unchanged: `minScore`, `definitionBudgetPct`, `factBudgetPct`, `topicBoostFactor`, `embeddingRerank`, `llmRerank`, `decayFactor`, `importanceBoost`, `adaptiveContext`.

Note: `definitionBudgetPct` and `factBudgetPct` still apply — they control budget allocation when grouping results for output. The difference is that results are already filtered by classification, so budget waste is reduced.

### 10. Testing Strategy

**Unit tests:**
- Schema registry: verify `defineIndex` emits BM25(k1,b) and WHERE clause
- Schema registry: verify indexes are created when merging fields into existing nodes
- Search engine: verify filter clauses are appended to vector and fulltext queries
- Query intent classifier: mock LLM responses, verify JSON parsing and fallback behavior
- buildContext: mock search results, verify progressive fallback widening

**Integration tests via architecture testing loop:**
- New config: `intent-filtered` — `useQueryIntent=1`, `embeddingRerank=1`, other defaults
- New config: `intent-filtered-no-rerank` — intent only, no embedding rerank (isolate intent contribution)
- Compare against `noise-reduce-AC` baseline on both datasets
- Metrics: quality score, noise %, relevance %, latency

**Backward compatibility:**
- All existing tests (470+) must pass unchanged
- Other domains (chat, code-repo, topic, user) must not be affected by framework changes
- KB memories created before migration get backfilled via bootstrap

### 11. Files Changed

**Framework (core):**
- `src/core/types.ts` — `IndexDef.condition`, `SearchQuery.filters`
- `src/core/schema-registry.ts` — index merge on existing nodes, BM25 params, conditional indexes
- `src/core/search-engine.ts` — filter clause builder, apply in vector/fulltext search

**KB domain:**
- `src/domains/kb/kb-domain.ts` — schema extension, rewritten buildContext, bootstrap, new tunable params
- `src/domains/kb/inbox.ts` — write classification/topics to memory record
- `src/domains/kb/utils.ts` — `classifyQueryIntent()` function
- `src/domains/kb/types.ts` — `QueryIntent` interface

**Tests:**
- `tests/schema-registry.test.ts` — new index features
- `tests/search-engine.test.ts` — filter support
- `tests/build-context.test.ts` — rewritten buildContext
- `tests-integration/kb-architecture/` — new test configs

### 12. What This Does NOT Change

- Memory table structure for non-KB domains (new fields are `option` type, null by default)
- `ask()` function signature or behavior
- `ContextResult` return type
- Existing search modes (vector, fulltext, hybrid, graph)
- Embedding adapter or LLM adapter interfaces
- Any other domain's inbox processing, search, or buildContext
- Edge-based ownership and attributes (still maintained alongside denormalized fields)

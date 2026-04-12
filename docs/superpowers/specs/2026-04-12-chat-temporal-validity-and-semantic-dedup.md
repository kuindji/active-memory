# Chat Domain: Temporal Validity & Semantic Deduplication

## Summary

Two enhancements to the chat domain's consolidation pipeline:

1. **Temporal validity** — episodic and semantic memories gain `validFrom`/`invalidAt` timestamps. During consolidation, the LLM identifies contradictions within clusters; contradicted memories are soft-invalidated (kept but excluded from context building).
2. **Semantic deduplication** — after creating a new semantic memory, check existing semantics for high similarity. If a near-duplicate exists, LLM merges both into a single memory; the old one is invalidated.

Both features are integrated into the existing `consolidateEpisodic` schedule. No new schedules, no additional LLM calls beyond what consolidation already makes.

## Design Decisions

- **Scope**: Chat domain only.
- **Contradiction detection**: During consolidation (not promotion or ingestion). The existing LLM call for cluster summarization is expanded to also identify contradictions.
- **Invalidation model**: Soft invalidation — old memories get `invalidAt` set, a `contradicts` edge created, but are not deleted. Excluded from context building by default.
- **Semantic dedup timing**: Inline within consolidation, immediately after a new semantic memory is created.
- **Semantic merge**: LLM produces a merged summary from both semantics. Old duplicate gets `invalidAt` + `summarizes` edge from merged.

## Type Changes

### `ChatAttributes` (`src/domains/chat/types.ts`)

Add two optional fields:

```typescript
interface ChatAttributes {
    role: ChatRole;
    layer: ChatLayer;
    chatSessionId: string;
    userId: string;
    messageIndex: number;
    weight?: number;
    validFrom?: number;    // ms — when this fact became true (set at creation)
    invalidAt?: number;    // ms — when superseded/contradicted (undefined = still valid)
}
```

- `validFrom` set to `Date.now()` when episodic/semantic memories are created.
- `invalidAt` remains `undefined` until contradiction or dedup merge.
- Working memory does not use these fields (it's ephemeral).

### `ChatDomainOptions.consolidation` (`src/domains/chat/types.ts`)

Add semantic dedup threshold:

```typescript
consolidation?: {
    similarityThreshold?: number;        // existing, default 0.7
    minClusterSize?: number;             // existing, default 3
    semanticDedupThreshold?: number;     // new, default 0.85
};
```

New default constant: `DEFAULT_SEMANTIC_DEDUP_THRESHOLD = 0.85`.

## Schedule Changes

### `promoteWorkingMemory` (`src/domains/chat/schedules.ts`)

Minimal change: set `validFrom: Date.now()` in the attributes when creating episodic memories. No other logic changes.

### `consolidateEpisodic` (`src/domains/chat/schedules.ts`)

Two additions to the existing flow:

#### A. Contradiction Detection (within cluster processing)

After clustering episodic memories, before/during the LLM consolidation call:

1. The LLM prompt is expanded. Instead of just "consolidate these facts into a summary," the prompt becomes: "Analyze these facts. Identify any that contradict or supersede earlier facts (a newer statement about the same topic that changes the answer). Return both a consolidated summary and a list of contradiction pairs (newer fact index, older fact index)."
2. For each identified contradiction pair:
   - Set `invalidAt: Date.now()` on the older episodic memory's attributes via `context.updateAttributes()`
   - Create a `contradicts` edge from the newer episodic memory to the older one
3. Invalidated episodic memories are excluded from the semantic summary (they contributed to detection but shouldn't pollute the consolidated knowledge).

The LLM call uses `extractStructured()` (or equivalent) with a schema that returns both the summary and contradiction pairs. This replaces the existing `consolidate()` call — one LLM call, two outputs.

#### B. Semantic Deduplication (after creating semantic memory)

After writing a new semantic memory:

1. Search existing semantic memories for similarity above `semanticDedupThreshold` (default 0.85), filtering to same userId.
2. If a near-duplicate is found:
   - Pass both the new and existing semantic memory contents to the LLM to produce a merged summary (can reuse the `consolidate()` method with two inputs).
   - Update the new semantic memory's content to the merged result.
   - Set `invalidAt: Date.now()` on the old semantic memory's attributes.
   - Create a `summarizes` edge from the new (merged) memory to the old one.
3. If no near-duplicate, proceed as before.

### `pruneDecayed` (`src/domains/chat/schedules.ts`)

Skip memories that already have `invalidAt` set — they're already out of circulation, no need to decay-check them. This is an optimization, not a behavior change.

## Context Building Changes

### `buildContext` (`src/domains/chat/chat-domain.ts`)

Two filtering points:

1. **Episodic section** (`[Context]`): After fetching episodic search results, filter out entries where `domainAttributes[CHAT_DOMAIN_ID].invalidAt` is set.
2. **Semantic section** (`[Background]`): Same filter — exclude entries with `invalidAt`.

Working memory section (`[Recent]`) is unchanged — working memories don't have temporal validity.

### `getMemories` filtering

The existing `getMemories` call in `buildContext` uses `attributes` filter. We cannot filter "invalidAt is NOT set" via the current attributes filter (it only matches equality). Two options:
- Filter in application code after fetching (simpler, current approach for other filters).
- This is what we'll do: filter the results array in `buildContext` after retrieval, same as the existing `userId` and `layer` filters.

## Search Behavior

No changes to the search engine itself. Invalid memories remain searchable (they're still in the index). Filtering happens at the domain level in `buildContext` and can be done by callers checking `domainAttributes`.

For the CLI/API, an optional `includeInvalid` flag could be added later if history browsing is needed, but is not part of this spec.

## Edge Usage

- `contradicts` (already defined in schema): newer episodic → older episodic. Created during consolidation when LLM identifies contradictions.
- `summarizes` (already defined): merged semantic → old semantic duplicate. Created during semantic dedup.

No new edge types needed.

## LLM Interface

The consolidation LLM call changes from:

```
consolidate(contents: string[]) → string
```

To a structured call that returns:

```typescript
{
    summary: string;
    contradictions: Array<{ newerIndex: number; olderIndex: number }>;
}
```

**Approach:** Use `extractStructured()` (available on all adapters, accepts text + JSON schema string + custom prompt). The schema returns a single-element array wrapping the result object. The custom prompt instructs the LLM to both consolidate and identify contradictions. The existing `consolidate()` call in `consolidateEpisodic` is replaced with this `extractStructured()` call.

For semantic dedup merging (two semantic memories → one merged), reuse the existing `consolidate()` method — it already handles merging multiple texts into one summary, and contradiction detection isn't needed there (we already know they're duplicates).

Fallback: if `extractStructured` is not available on the adapter (it's optional), fall back to the existing `consolidate()` call and skip contradiction detection for that run.

## Files to Modify

1. `src/domains/chat/types.ts` — add `validFrom`, `invalidAt` to `ChatAttributes`; add `semanticDedupThreshold` to options; add default constant
2. `src/domains/chat/schedules.ts` — modify `promoteWorkingMemory` (set validFrom), modify `consolidateEpisodic` (contradiction detection + semantic dedup), modify `pruneDecayed` (skip invalidated)
3. `src/domains/chat/chat-domain.ts` — modify `buildContext` to filter out invalidated memories

No new LLM adapter methods needed. No new edge types needed.

# Chat Domain Design

Built-in conversational memory domain that implements a tiered lifecycle (working → episodic → semantic), ported from the AiMemory reference implementation and adapted to active-memory's graph-backed domain patterns.

## Use Case

The Chat domain serves client applications that fully own the interaction with an LLM. The client feeds both user messages and agent responses into the domain. The agent has no memory of its own — the Chat domain is its memory layer.

## Data Model

### Ownership Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `role` | `'user' \| 'assistant'` | Who produced this message |
| `layer` | `'working' \| 'episodic' \| 'semantic'` | Lifecycle tier |
| `chatSessionId` | `string` | Session scope (meaningful for working layer) |
| `userId` | `string` | Always present; all operations are user-bound |
| `messageIndex` | `number` | Auto-incremented per session on inbox arrival |
| `weight` | `number` (0–1) | Importance/decay score (episodic/semantic layers) |

### Tags

- `chat` — root tag for all chat memories
- `chat/message` — working layer raw messages
- `chat/episodic` — extracted highlights
- `chat/semantic` — consolidated long-term facts

### Edges

- `about_topic` — reuses Topic domain's edge type (chat memory → topic, with `domain: 'chat'`)
- `summarizes` — episodic/semantic memory → source working memories it was derived from (provenance tracking)

### No Custom Node Types

All chat data uses standard memory entries with ownership attributes. No custom graph node types are introduced.

## User and Session Scoping

All domain operations are user-bound. `userId` must be present in request context for every read and write. Operations without `userId` must fail or return empty results.

`chatSessionId` is an attribute on working memory only. It scopes raw message history so that multiple concurrent sessions for the same user do not leak working memory into each other. Once facts are promoted to episodic/semantic layers, they are organized by topics and are no longer session-bound.

Both `userId` and `chatSessionId` are passed via request context, similar to how `userId` is handled in the User domain.

## Inbox Processing

When `processInboxItem` receives a message:

1. **Store as working memory** — Save with attributes: `layer: 'working'`, `role`, `userId`, `chatSessionId`. Auto-increment `messageIndex` based on order of appearance in inbox for the given session. Tag with `chat` and `chat/message`.

2. **Topic extraction** — LLM pass on the message content to identify topics:
   - Search existing topics by vector similarity
   - If match found: increment `mentionCount`, create `about_topic` edge
   - If new topic: create topic via Topic domain's external skill, then link

3. **No promotion or user fact extraction** — Deferred to scheduled processing.

**Validation:** Both `userId` and `chatSessionId` must be present in request context. Inbox processing skips the item if either is missing.

## Scheduled Processing

### 1. `promote-working-memory`

Configurable interval. Per user, finds working memories that exceed capacity or age threshold.

Processing steps:
- LLM extraction pass on the batch of working memories
- Distill key facts/highlights → create episodic memories (`chat/episodic`) with assigned `weight`
- Link episodic memories to source working memories via `summarizes` edges
- Extract user-specific facts → push to User domain via `user-data` external skill
- Extract deeper semantic topics beyond what inbox processing caught
- Release ownership claims on promoted working memories

### 2. `consolidate-episodic`

Configurable interval. Per user, clusters episodic memories by embedding similarity.

Processing steps:
- Find episodic memories for the user
- Cluster by cosine similarity (configurable threshold)
- For clusters above minimum size: LLM summarizes into semantic memory (`chat/semantic`)
- Link semantic → episodic via `summarizes` edges
- Release ownership claims on consolidated episodic memories

### 3. `prune-decayed`

Configurable interval. Finds episodic memories whose decayed weight has fallen below the prune threshold.

Processing steps:
- Calculate decayed weight for each episodic memory
- Release ownership claims on memories below threshold

### Ownership Release

The Chat domain does not delete memories directly. It releases its ownership claim. The engine's existing cleanup mechanism handles orphaned memories that no domain claims.

## Search

### `search.expand`

Enforces user isolation. All queries are bound to the user via `userId` from request context. If no `userId` is present, the search returns nothing. Other users' data must never leak.

### `search.rank`

Applies decay weighting: `score = similarity * decayedWeight(memory)`. Layer-aware boosting: semantic memories get a stability bonus, working memories get a recency bonus.

## Context Building (`buildContext`)

Assembles a token-budgeted context string from three sections, scoped by `userId`:

1. **Recent** (working layer) — Filtered by `chatSessionId`, ordered by `messageIndex`. Raw message history for the current session. Largest budget share by default.

2. **Context** (episodic layer) — Filtered by `userId` only (cross-session). Ranked by relevance to the current query plus recency. Extracted highlights from recent conversations.

3. **Background** (semantic layer) — Filtered by `userId`. Ranked by relevance. Long-term distilled knowledge.

Budget allocation shifts based on a `depth` parameter (ported from AiMemory):
- Low depth (default): favors working memory (recent conversation)
- High depth: favors semantic/episodic (background knowledge)

## Skills

### External

1. **`chat-ingest`** — How to feed messages into the Chat domain. Documents expected request context (`userId`, `chatSessionId`), message format, and `role` field. For client applications integrating with the domain.

2. **`chat-query`** — How to retrieve conversational memory. Documents `buildContext` usage, `depth` parameter, session-scoped vs user-scoped queries. For agents/clients assembling context before LLM calls.

### Internal

3. **`chat-processing`** — Documents the three scheduled tasks (promotion, consolidation, pruning), the LLM prompts used for extraction and summarization, and the decay mechanics.

## Configuration

```typescript
interface ChatDomainOptions {
  workingMemoryCapacity?: number       // max working memories per session before promotion
  workingMemoryMaxAge?: number         // max age in ms before working memory is promoted
  promoteSchedule?: {
    enabled?: boolean
    intervalMs?: number
  }
  consolidateSchedule?: {
    enabled?: boolean
    intervalMs?: number
  }
  pruneSchedule?: {
    enabled?: boolean
    intervalMs?: number
  }
  decay?: {
    episodicLambda?: number            // decay rate for episodic memories
    semanticLambda?: number            // decay rate for semantic memories
    pruneThreshold?: number            // weight below which episodic gets released
  }
  consolidation?: {
    similarityThreshold?: number       // clustering threshold
    minClusterSize?: number            // minimum cluster size to trigger consolidation
  }
}
```

Exports `createChatDomain(options?)` factory function and a `chatDomain` default instance, following the Topic/User domain pattern.

## Dependencies

- **Topic domain** — for topic creation and linking via `about_topic` edges and the `topic-management` external skill
- **User domain** — for pushing extracted user facts via the `user-data` external skill during promotion

Both dependencies are soft — the Chat domain operates gracefully if either is unavailable (skips topic linking or user fact extraction).

## Relationship to AiMemory

This design ports AiMemory's core lifecycle (working → episodic → semantic) into active-memory's domain/graph architecture:

| AiMemory Concept | Chat Domain Equivalent |
|-----------------|----------------------|
| Working layer (FIFO buffer) | Working memory scoped by `chatSessionId` |
| Episodic layer (decay-weighted) | Episodic memories with `weight` + decay |
| Semantic layer (consolidated) | Semantic memories from cluster summarization |
| Core memory (user facts) | User domain (separate domain, not chat) |
| `ingest()` | Inbox processing |
| `recall()` / `query()` | `buildContext` with depth parameter |
| Consolidation (write-triggered) | `consolidate-episodic` schedule |
| Promotion (capacity-triggered) | `promote-working-memory` schedule |
| Pruning (decay threshold) | `prune-decayed` schedule |

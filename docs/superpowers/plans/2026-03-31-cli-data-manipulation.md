# CLI Data Manipulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add generic, domain-agnostic data manipulation commands to the CLI and corresponding MemoryEngine methods, with consistent JSON output envelope across all commands.

**Architecture:** New engine methods delegate to existing DomainContext/GraphStore/Scheduler internals. New CLI commands are thin handlers that parse flags and call engine methods. Existing commands are migrated to the `{ ok, data }` / `{ ok, error }` envelope with JSON-by-default output. `--meta key=value` replaces `--user-id` for extensible request context.

**Tech Stack:** TypeScript, Bun, SurrealDB

---

## File Map

### New files
- `src/cli/utils.ts` — shared CLI utilities (parseMeta)
- `src/cli/commands/write.ts` — write command handler
- `src/cli/commands/memory.ts` — memory CRUD command handler
- `src/cli/commands/graph.ts` — graph command handler
- `src/cli/commands/schedule.ts` — schedule command handler
- `tests/cli/commands/write.test.ts` — write command tests
- `tests/cli/commands/memory.test.ts` — memory command tests
- `tests/cli/commands/graph.test.ts` — graph command tests
- `tests/cli/commands/schedule.test.ts` — schedule command tests
- `tests/engine-api.test.ts` — engine new method tests

### Modified files
- `src/core/types.ts` — add WriteOptions, WriteResult, UpdateOptions, ScheduleInfo, TraversalNode types
- `src/core/engine.ts` — add writeMemory, getMemory, updateMemory, deleteMemory, tagMemory, untagMemory, getMemoryTags, getEdges, relate, unrelate, traverse, listSchedules, triggerSchedule methods
- `src/core/scheduler.ts` — add listSchedules method
- `src/cli/types.ts` — remove GlobalFlags.json, add GlobalFlags.pretty, update flag types
- `src/cli/parse-args.ts` — add --meta and --attr as repeatable flags, add --pretty boolean, remove --json boolean
- `src/cli/format.ts` — rewrite formatOutput to use `{ ok, data }` envelope, default JSON, --pretty for text
- `src/cli/cli.ts` — register new commands, switch from json to pretty flag, wrap errors in envelope
- `src/cli/commands/ingest.ts` — replace --user-id with --meta, adapt to new output format
- `src/cli/commands/search.ts` — replace --user-id with --meta, adapt to new output format
- `src/cli/commands/ask.ts` — replace --user-id with --meta, adapt to new output format
- `src/cli/commands/build-context.ts` — replace --user-id with --meta, adapt to new output format
- `src/cli/commands/help.ts` — update help text with new commands and flags
- `src/index.ts` — export new types
- All existing CLI tests — update for new envelope format and flag changes

---

## Task 1: Add new types to core/types.ts

**Files:**
- Modify: `src/core/types.ts:348-349` (end of file)

- [ ] **Step 1: Write the test**

Create `tests/engine-api.test.ts` with a type-level test that exercises the new types:

```typescript
import { describe, it, expect } from 'bun:test'
import type {
  WriteOptions,
  WriteResult,
  UpdateOptions,
  ScheduleInfo,
  TraversalNode,
} from '../src/core/types.ts'

describe('new engine API types', () => {
  it('WriteOptions has required fields', () => {
    const opts: WriteOptions = {
      domain: 'test',
      tags: ['t1'],
      attributes: { key: 'val' },
      context: { userId: 'u1' },
    }
    expect(opts.domain).toBe('test')
  })

  it('WriteResult has id', () => {
    const result: WriteResult = { id: 'memory:abc' }
    expect(result.id).toBe('memory:abc')
  })

  it('UpdateOptions accepts attributes and text', () => {
    const opts: UpdateOptions = {
      attributes: { status: 'active' },
      text: 'updated content',
    }
    expect(opts.text).toBe('updated content')
  })

  it('ScheduleInfo has required fields', () => {
    const info: ScheduleInfo = {
      id: 'promote',
      domain: 'chat',
      name: 'Promote working memory',
      interval: 60000,
      lastRun: 1000,
    }
    expect(info.domain).toBe('chat')
  })

  it('TraversalNode has required fields', () => {
    const node: TraversalNode = {
      id: 'memory:abc',
      depth: 1,
      edge: 'about_topic',
      direction: 'out',
    }
    expect(node.depth).toBe(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/engine-api.test.ts`
Expected: FAIL — types don't exist yet.

- [ ] **Step 3: Add the types**

In `src/core/types.ts`, add before the closing of the file (after line 349):

```typescript
// --- Engine API types ---

export interface WriteOptions {
  domain: string
  tags?: string[]
  attributes?: Record<string, unknown>
  context?: RequestContext
}

export interface WriteResult {
  id: string
}

export interface UpdateOptions {
  attributes?: Record<string, unknown>
  text?: string
}

export interface ScheduleInfo {
  id: string
  domain: string
  name: string
  interval: number
  lastRun?: number
}

export interface TraversalNode {
  id: string
  depth: number
  edge: string
  direction: 'in' | 'out'
  memory?: ScoredMemory
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/engine-api.test.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts tests/engine-api.test.ts
git commit -m "feat: add WriteOptions, WriteResult, UpdateOptions, ScheduleInfo, TraversalNode types"
```

---

## Task 2: Add MemoryEngine.writeMemory method

**Files:**
- Modify: `src/core/engine.ts:126` (after registerDomain, before ingest)
- Test: `tests/engine-api.test.ts`

- [ ] **Step 1: Write the test**

Add to `tests/engine-api.test.ts`:

```typescript
import { MemoryEngine } from '../src/core/engine.ts'
import { MockLLMAdapter } from './helpers.ts'
import { StringRecordId } from 'surrealdb'

describe('MemoryEngine.writeMemory', () => {
  let engine: MemoryEngine

  beforeEach(async () => {
    engine = new MemoryEngine()
    await engine.initialize({
      connection: 'mem://',
      namespace: 'test',
      database: `test_write_${Date.now()}`,
      llm: new MockLLMAdapter(),
    })
  })

  afterEach(async () => {
    await engine.close()
  })

  it('creates a memory with domain ownership', async () => {
    const result = await engine.writeMemory('Test content', { domain: 'log' })
    expect(result.id).toBeTruthy()
    expect(result.id).toContain('memory:')

    const node = await engine.getGraph().getNode(result.id)
    expect(node).not.toBeNull()
    expect(node!.content).toBe('Test content')
  })

  it('assigns tags when provided', async () => {
    const result = await engine.writeMemory('Tagged content', {
      domain: 'log',
      tags: ['topic', 'active'],
    })

    const tags = await engine.getGraph().query<string[]>(
      'SELECT VALUE out.label FROM tagged WHERE in = $id',
      { id: new StringRecordId(result.id) }
    )
    expect(tags).toContain('topic')
    expect(tags).toContain('active')
  })

  it('sets domain attributes when provided', async () => {
    const result = await engine.writeMemory('With attrs', {
      domain: 'log',
      attributes: { status: 'active', count: 1 },
    })

    const owners = await engine.getGraph().query<{ attributes: Record<string, unknown> }[]>(
      'SELECT attributes FROM owned_by WHERE in = $id',
      { id: new StringRecordId(result.id) }
    )
    expect(owners).toHaveLength(1)
    expect(owners![0].attributes).toEqual({ status: 'active', count: 1 })
  })

  it('does not tag with inbox', async () => {
    const result = await engine.writeMemory('No inbox', { domain: 'log' })

    const tags = await engine.getGraph().query<string[]>(
      'SELECT VALUE out.label FROM tagged WHERE in = $id',
      { id: new StringRecordId(result.id) }
    )
    expect(tags).not.toContain('inbox')
  })
})
```

Add required imports at the top: `beforeEach, afterEach` from `bun:test`, `MemoryEngine`, `MockLLMAdapter`, `StringRecordId`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/engine-api.test.ts`
Expected: FAIL — `engine.writeMemory is not a function`

- [ ] **Step 3: Implement writeMemory**

In `src/core/engine.ts`, add after the `registerDomain` method (after line 125):

```typescript
async writeMemory(text: string, options: WriteOptions): Promise<WriteResult> {
  const ctx = this.createDomainContext(options.domain, options.context)
  const id = await ctx.writeMemory({
    content: text,
    tags: options.tags,
    ownership: {
      domain: options.domain,
      attributes: options.attributes,
    },
  })
  // Remove inbox tag — writeMemory is direct, not inbox-processed
  await this.graph.unrelate(id, 'tagged', 'tag:inbox')
  return { id }
}
```

Add import for `WriteOptions` and `WriteResult` in the engine's import block.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/engine-api.test.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/core/engine.ts tests/engine-api.test.ts
git commit -m "feat: add MemoryEngine.writeMemory for direct memory creation"
```

---

## Task 3: Add MemoryEngine memory CRUD methods (getMemory, updateMemory, deleteMemory)

**Files:**
- Modify: `src/core/engine.ts`
- Test: `tests/engine-api.test.ts`

- [ ] **Step 1: Write the tests**

Add to `tests/engine-api.test.ts`:

```typescript
describe('MemoryEngine.getMemory', () => {
  let engine: MemoryEngine

  beforeEach(async () => {
    engine = new MemoryEngine()
    await engine.initialize({
      connection: 'mem://',
      namespace: 'test',
      database: `test_getmem_${Date.now()}`,
      llm: new MockLLMAdapter(),
    })
  })

  afterEach(async () => {
    await engine.close()
  })

  it('returns a memory by id', async () => {
    const { id } = await engine.writeMemory('Readable content', { domain: 'log' })
    const mem = await engine.getMemory(id)
    expect(mem).not.toBeNull()
    expect(mem!.id).toBe(id)
    expect(mem!.content).toBe('Readable content')
    expect(mem!.createdAt).toBeGreaterThan(0)
    expect(mem!.tokenCount).toBeGreaterThan(0)
  })

  it('returns null for non-existent id', async () => {
    const mem = await engine.getMemory('memory:nonexistent')
    expect(mem).toBeNull()
  })
})

describe('MemoryEngine.updateMemory', () => {
  let engine: MemoryEngine

  beforeEach(async () => {
    engine = new MemoryEngine()
    await engine.initialize({
      connection: 'mem://',
      namespace: 'test',
      database: `test_updmem_${Date.now()}`,
      llm: new MockLLMAdapter(),
    })
  })

  afterEach(async () => {
    await engine.close()
  })

  it('updates memory content', async () => {
    const { id } = await engine.writeMemory('Original', { domain: 'log' })
    await engine.updateMemory(id, { text: 'Updated content' })

    const node = await engine.getGraph().getNode(id)
    expect(node!.content).toBe('Updated content')
  })

  it('updates memory text and recalculates token count', async () => {
    const { id } = await engine.writeMemory('Short', { domain: 'log' })
    await engine.updateMemory(id, { text: 'A much longer piece of content for testing' })

    const node = await engine.getGraph().getNode(id)
    expect(node!.content).toBe('A much longer piece of content for testing')
    expect(node!.token_count).toBeGreaterThan(1)
  })

  it('throws for non-existent memory', async () => {
    await expect(
      engine.updateMemory('memory:nonexistent', { text: 'nope' })
    ).rejects.toThrow()
  })
})

describe('MemoryEngine.deleteMemory', () => {
  let engine: MemoryEngine

  beforeEach(async () => {
    engine = new MemoryEngine()
    await engine.initialize({
      connection: 'mem://',
      namespace: 'test',
      database: `test_delmem_${Date.now()}`,
      llm: new MockLLMAdapter(),
    })
  })

  afterEach(async () => {
    await engine.close()
  })

  it('deletes a memory and its edges', async () => {
    const { id } = await engine.writeMemory('To delete', { domain: 'log' })
    await engine.deleteMemory(id)

    const node = await engine.getGraph().getNode(id)
    expect(node).toBeNull()
  })

  it('throws for non-existent memory', async () => {
    await expect(
      engine.deleteMemory('memory:nonexistent')
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/engine-api.test.ts`
Expected: FAIL — methods not defined

- [ ] **Step 3: Implement the methods**

In `src/core/engine.ts`, add after `writeMemory`:

```typescript
async getMemory(id: string): Promise<MemoryEntry | null> {
  const node = await this.graph.getNode(id)
  if (!node) return null
  return {
    id: node.id,
    content: node.content as string,
    eventTime: (node.event_time as number | null) ?? null,
    createdAt: node.created_at as number,
    tokenCount: node.token_count as number,
  }
}

async updateMemory(id: string, options: UpdateOptions): Promise<void> {
  const existing = await this.graph.getNode(id)
  if (!existing) throw new Error(`Memory ${id} not found`)

  const updates: Record<string, unknown> = {}
  if (options.text !== undefined) {
    updates.content = options.text
    updates.token_count = countTokens(options.text)
    if (this.embedding) {
      updates.embedding = await this.embedding.embed(options.text)
    }
  }
  if (options.attributes !== undefined) {
    // Update attributes on all owned_by edges for this memory
    const owners = await this.graph.query<{ id: string; out: string }[]>(
      'SELECT id, out FROM owned_by WHERE in = $memId',
      { memId: new StringRecordId(id) }
    )
    if (owners) {
      for (const owner of owners) {
        await this.graph.query(
          'UPDATE owned_by SET attributes = object::merge(attributes, $attrs) WHERE id = $edgeId',
          { edgeId: new StringRecordId(owner.id), attrs: options.attributes }
        )
      }
    }
  }
  if (Object.keys(updates).length > 0) {
    await this.graph.updateNode(id, updates)
  }
}

async deleteMemory(id: string): Promise<void> {
  const existing = await this.graph.getNode(id)
  if (!existing) throw new Error(`Memory ${id} not found`)

  // Remove all ownership edges first (this handles cascade cleanup)
  const owners = await this.graph.query<{ out: string }[]>(
    'SELECT out FROM owned_by WHERE in = $memId',
    { memId: new StringRecordId(id) }
  )
  if (owners) {
    for (const owner of owners) {
      const domainId = String(owner.out).replace(/^domain:/, '')
      await this.releaseOwnership(id, domainId)
    }
  }
  // If releaseOwnership didn't delete it (shouldn't happen, but safety)
  const stillExists = await this.graph.getNode(id)
  if (stillExists) {
    await this.graph.deleteNode(id)
  }
}
```

Add `UpdateOptions` to the import block.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/engine-api.test.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/core/engine.ts tests/engine-api.test.ts
git commit -m "feat: add MemoryEngine getMemory, updateMemory, deleteMemory"
```

---

## Task 4: Add MemoryEngine tagging methods

**Files:**
- Modify: `src/core/engine.ts`
- Test: `tests/engine-api.test.ts`

- [ ] **Step 1: Write the tests**

Add to `tests/engine-api.test.ts`:

```typescript
describe('MemoryEngine tagging', () => {
  let engine: MemoryEngine

  beforeEach(async () => {
    engine = new MemoryEngine()
    await engine.initialize({
      connection: 'mem://',
      namespace: 'test',
      database: `test_tag_${Date.now()}`,
      llm: new MockLLMAdapter(),
    })
  })

  afterEach(async () => {
    await engine.close()
  })

  it('tagMemory adds a tag', async () => {
    const { id } = await engine.writeMemory('Tag me', { domain: 'log' })
    await engine.tagMemory(id, 'important')

    const tags = await engine.getMemoryTags(id)
    expect(tags).toContain('important')
  })

  it('untagMemory removes a tag', async () => {
    const { id } = await engine.writeMemory('Untag me', {
      domain: 'log',
      tags: ['removable'],
    })
    await engine.untagMemory(id, 'removable')

    const tags = await engine.getMemoryTags(id)
    expect(tags).not.toContain('removable')
  })

  it('getMemoryTags returns all tags', async () => {
    const { id } = await engine.writeMemory('Multi tag', {
      domain: 'log',
      tags: ['a', 'b'],
    })
    await engine.tagMemory(id, 'c')

    const tags = await engine.getMemoryTags(id)
    expect(tags).toContain('a')
    expect(tags).toContain('b')
    expect(tags).toContain('c')
  })

  it('getMemoryTags returns empty for non-existent memory', async () => {
    const tags = await engine.getMemoryTags('memory:nonexistent')
    expect(tags).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/engine-api.test.ts`
Expected: FAIL — methods not defined

- [ ] **Step 3: Implement the methods**

In `src/core/engine.ts`, add after `deleteMemory`:

```typescript
async tagMemory(id: string, tag: string): Promise<void> {
  const fullTagId = tag.startsWith('tag:') ? tag : `tag:${tag}`
  try {
    await this.graph.createNodeWithId(fullTagId, {
      label: tag.startsWith('tag:') ? tag.slice(4) : tag,
      created_at: Date.now(),
    })
  } catch {
    // Already exists
  }
  await this.graph.relate(id, 'tagged', fullTagId)
}

async untagMemory(id: string, tag: string): Promise<void> {
  const fullTagId = tag.startsWith('tag:') ? tag : `tag:${tag}`
  await this.graph.unrelate(id, 'tagged', fullTagId)
}

async getMemoryTags(id: string): Promise<string[]> {
  const rows = await this.graph.query<string[]>(
    'SELECT VALUE out.label FROM tagged WHERE in = $memId',
    { memId: new StringRecordId(id) }
  )
  return (rows ?? []).filter((label): label is string => typeof label === 'string')
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/engine-api.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/engine.ts tests/engine-api.test.ts
git commit -m "feat: add MemoryEngine tagMemory, untagMemory, getMemoryTags"
```

---

## Task 5: Add MemoryEngine graph methods (getEdges, relate, unrelate, traverse)

**Files:**
- Modify: `src/core/engine.ts`
- Test: `tests/engine-api.test.ts`

- [ ] **Step 1: Write the tests**

Add to `tests/engine-api.test.ts`:

```typescript
describe('MemoryEngine graph operations', () => {
  let engine: MemoryEngine

  beforeEach(async () => {
    engine = new MemoryEngine()
    await engine.initialize({
      connection: 'mem://',
      namespace: 'test',
      database: `test_graph_${Date.now()}`,
      llm: new MockLLMAdapter(),
    })
  })

  afterEach(async () => {
    await engine.close()
  })

  it('relate creates an edge between nodes', async () => {
    const { id: id1 } = await engine.writeMemory('Node A', { domain: 'log' })
    const { id: id2 } = await engine.writeMemory('Node B', { domain: 'log' })

    const edgeId = await engine.relate(id1, id2, 'reinforces', 'log')
    expect(edgeId).toBeTruthy()
  })

  it('relate creates an edge with attributes', async () => {
    const { id: id1 } = await engine.writeMemory('Node A', { domain: 'log' })
    const { id: id2 } = await engine.writeMemory('Node B', { domain: 'log' })

    const edgeId = await engine.relate(id1, id2, 'reinforces', 'log', { strength: 0.9 })
    expect(edgeId).toBeTruthy()
  })

  it('getEdges returns edges for a node', async () => {
    const { id: id1 } = await engine.writeMemory('Node A', { domain: 'log' })
    const { id: id2 } = await engine.writeMemory('Node B', { domain: 'log' })

    await engine.relate(id1, id2, 'reinforces', 'log')

    const edges = await engine.getEdges(id1)
    // Should include the reinforces edge plus owned_by and tagged edges
    const reinforcesEdges = edges.filter(e => String(e.id).startsWith('reinforces:'))
    expect(reinforcesEdges.length).toBeGreaterThanOrEqual(1)
  })

  it('getEdges respects direction filter', async () => {
    const { id: id1 } = await engine.writeMemory('Node A', { domain: 'log' })
    const { id: id2 } = await engine.writeMemory('Node B', { domain: 'log' })

    await engine.relate(id1, id2, 'reinforces', 'log')

    const outEdges = await engine.getEdges(id1, 'out')
    const inEdges = await engine.getEdges(id1, 'in')

    // id1 is source of reinforces edge → shows in 'out' edges
    const outReinforces = outEdges.filter(e => String(e.id).startsWith('reinforces:'))
    expect(outReinforces.length).toBe(1)

    // id1 is NOT target → no reinforces in 'in' edges
    const inReinforces = inEdges.filter(e => String(e.id).startsWith('reinforces:'))
    expect(inReinforces.length).toBe(0)
  })

  it('unrelate removes an edge', async () => {
    const { id: id1 } = await engine.writeMemory('Node A', { domain: 'log' })
    const { id: id2 } = await engine.writeMemory('Node B', { domain: 'log' })

    await engine.relate(id1, id2, 'reinforces', 'log')
    await engine.unrelate(id1, id2, 'reinforces')

    const edges = await engine.getEdges(id1)
    const reinforcesEdges = edges.filter(e => String(e.id).startsWith('reinforces:'))
    expect(reinforcesEdges.length).toBe(0)
  })

  it('traverse follows edge patterns', async () => {
    const { id: id1 } = await engine.writeMemory('Source', { domain: 'log' })
    const { id: id2 } = await engine.writeMemory('Target', { domain: 'log' })

    await engine.relate(id1, id2, 'reinforces', 'log')

    const nodes = await engine.traverse(id1, ['reinforces'])
    expect(nodes.length).toBeGreaterThanOrEqual(1)
    expect(nodes[0].id).toBe(id2)
    expect(nodes[0].depth).toBe(1)
    expect(nodes[0].edge).toBe('reinforces')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/engine-api.test.ts`
Expected: FAIL — methods not defined

- [ ] **Step 3: Implement the methods**

In `src/core/engine.ts`, add after the tagging methods. Add `TraversalNode` to the import block.

```typescript
async getEdges(
  nodeId: string,
  direction?: 'in' | 'out' | 'both',
  domainId?: string
): Promise<Edge[]> {
  // Reuse the DomainContext.getNodeEdges logic but without domain visibility filtering
  // when no domainId is provided. When domainId is provided, use domain visibility.
  if (domainId) {
    const ctx = this.createDomainContext(domainId)
    return ctx.getNodeEdges(nodeId, direction)
  }

  const dir = direction ?? 'both'
  const conditions: string[] = []
  if (dir === 'out' || dir === 'both') conditions.push('in = $nodeId')
  if (dir === 'in' || dir === 'both') conditions.push('out = $nodeId')
  const where = conditions.join(' OR ')

  const edgeNames = this.schema.getRegisteredEdgeNames()
  const coreEdges = ['tagged', 'owned_by', 'reinforces', 'contradicts', 'summarizes', 'refines', 'child_of', 'has_rule']
  const allEdges = [...new Set([...coreEdges, ...edgeNames])]

  const results: Edge[] = []
  const nodeRef = new StringRecordId(nodeId)
  for (const edgeName of allEdges) {
    const rows = await this.graph.query<Edge[]>(
      `SELECT * FROM ${edgeName} WHERE ${where}`,
      { nodeId: nodeRef }
    )
    if (rows) results.push(...rows)
  }
  return results
}

async relate(
  from: string,
  to: string,
  edgeType: string,
  domainId: string,
  attrs?: Record<string, unknown>
): Promise<string> {
  return this.graph.relate(from, edgeType, to, attrs)
}

async unrelate(from: string, to: string, edgeType: string): Promise<void> {
  await this.graph.unrelate(from, edgeType, to)
}

async traverse(
  startId: string,
  edgeTypes: string[],
  depth?: number,
  domainId?: string
): Promise<TraversalNode[]> {
  const maxDepth = depth ?? 1
  const results: TraversalNode[] = []
  const visited = new Set<string>([startId])

  let frontier = [startId]

  for (let d = 1; d <= maxDepth && frontier.length > 0; d++) {
    const nextFrontier: string[] = []
    for (const nodeId of frontier) {
      for (const edgeType of edgeTypes) {
        // Follow outgoing edges
        const outRows = await this.graph.query<{ out: string }[]>(
          `SELECT out FROM ${edgeType} WHERE in = $nodeId`,
          { nodeId: new StringRecordId(nodeId) }
        )
        if (outRows) {
          for (const row of outRows) {
            const targetId = String(row.out)
            if (!visited.has(targetId)) {
              visited.add(targetId)
              results.push({ id: targetId, depth: d, edge: edgeType, direction: 'out' })
              nextFrontier.push(targetId)
            }
          }
        }
      }
    }
    frontier = nextFrontier
  }

  return results
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/engine-api.test.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/core/engine.ts tests/engine-api.test.ts
git commit -m "feat: add MemoryEngine getEdges, relate, unrelate, traverse"
```

---

## Task 6: Add Scheduler.listSchedules and MemoryEngine schedule methods

**Files:**
- Modify: `src/core/scheduler.ts`
- Modify: `src/core/engine.ts`
- Test: `tests/engine-api.test.ts`

- [ ] **Step 1: Write the tests**

Add to `tests/engine-api.test.ts`:

```typescript
import { createTopicDomain } from '../src/domains/topic/index.ts'

describe('MemoryEngine schedule operations', () => {
  let engine: MemoryEngine

  beforeEach(async () => {
    engine = new MemoryEngine()
    await engine.initialize({
      connection: 'mem://',
      namespace: 'test',
      database: `test_sched_${Date.now()}`,
      llm: new MockLLMAdapter(),
    })
    await engine.registerDomain(createTopicDomain())
  })

  afterEach(async () => {
    await engine.close()
  })

  it('listSchedules returns all schedules', async () => {
    const schedules = await engine.listSchedules()
    expect(schedules.length).toBeGreaterThan(0)
    expect(schedules[0].id).toBeTruthy()
    expect(schedules[0].domain).toBeTruthy()
    expect(schedules[0].name).toBeTruthy()
    expect(schedules[0].interval).toBeGreaterThan(0)
  })

  it('listSchedules filters by domain', async () => {
    const schedules = await engine.listSchedules('topic')
    expect(schedules.length).toBeGreaterThan(0)
    for (const s of schedules) {
      expect(s.domain).toBe('topic')
    }
  })

  it('listSchedules returns empty for unknown domain', async () => {
    const schedules = await engine.listSchedules('nonexistent')
    expect(schedules).toEqual([])
  })

  it('triggerSchedule runs a specific schedule', async () => {
    const schedules = await engine.listSchedules('topic')
    // Should not throw
    await engine.triggerSchedule('topic', schedules[0].id)
  })

  it('triggerSchedule throws for unknown schedule', async () => {
    await expect(
      engine.triggerSchedule('topic', 'nonexistent')
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/engine-api.test.ts`
Expected: FAIL — methods not defined

- [ ] **Step 3: Add listSchedules to Scheduler**

In `src/core/scheduler.ts`, add after the `runNow` method (before closing brace):

```typescript
listSchedules(domainId?: string): ScheduleInfo[] {
  const result: ScheduleInfo[] = []
  for (const entry of this.entries.values()) {
    if (domainId && entry.domain !== domainId) continue
    result.push({
      id: entry.schedule.id,
      domain: entry.domain,
      name: entry.schedule.name,
      interval: entry.schedule.intervalMs,
      lastRun: entry.lastRunAt > 0 ? entry.lastRunAt : undefined,
    })
  }
  return result
}
```

Add the import for `ScheduleInfo` from `./types.ts`.

- [ ] **Step 4: Add engine methods**

In `src/core/engine.ts`, add after the `traverse` method. Add `ScheduleInfo` to the import block.

```typescript
listSchedules(domainId?: string): ScheduleInfo[] {
  return this.scheduler.listSchedules(domainId)
}

async triggerSchedule(domainId: string, scheduleId: string): Promise<void> {
  const schedules = this.scheduler.listSchedules(domainId)
  const match = schedules.find(s => s.id === scheduleId)
  if (!match) {
    throw new Error(`Schedule "${scheduleId}" not found in domain "${domainId}"`)
  }
  await this.scheduler.runNow(domainId, scheduleId)
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test tests/engine-api.test.ts`
Expected: PASS

- [ ] **Step 6: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/core/scheduler.ts src/core/engine.ts tests/engine-api.test.ts
git commit -m "feat: add listSchedules and triggerSchedule to Scheduler and MemoryEngine"
```

---

## Task 7: Export new types from index.ts

**Files:**
- Modify: `src/index.ts:15-53` (type exports block)

- [ ] **Step 1: Add exports**

In `src/index.ts`, add `WriteOptions`, `WriteResult`, `UpdateOptions`, `ScheduleInfo`, `TraversalNode` to the type export block:

```typescript
export type {
  // ... existing exports ...
  WriteOptions,
  WriteResult,
  UpdateOptions,
  ScheduleInfo,
  TraversalNode,
} from './core/types.ts'
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: export new engine API types from index"
```

---

## Task 8: Update parse-args for --meta, --attr, --pretty

**Files:**
- Modify: `src/cli/parse-args.ts`
- Modify: `src/cli/types.ts`
- Test: `tests/cli/parse-args.test.ts`

- [ ] **Step 1: Write the tests**

Add to `tests/cli/parse-args.test.ts`:

```typescript
describe('parseArgs - repeatable flags', () => {
  it('parses single --meta key=value', () => {
    const result = parseArgs(['search', 'query', '--meta', 'user-id=abc'])
    expect(result.flags['meta']).toEqual({ 'user-id': 'abc' })
  })

  it('parses multiple --meta flags', () => {
    const result = parseArgs(['search', 'query', '--meta', 'user-id=abc', '--meta', 'session-id=xyz'])
    expect(result.flags['meta']).toEqual({ 'user-id': 'abc', 'session-id': 'xyz' })
  })

  it('parses --meta with = syntax', () => {
    const result = parseArgs(['search', 'query', '--meta=user-id=abc'])
    expect(result.flags['meta']).toEqual({ 'user-id': 'abc' })
  })

  it('parses single --attr key=value', () => {
    const result = parseArgs(['write', '--attr', 'status=active'])
    expect(result.flags['attr']).toEqual({ 'status': 'active' })
  })

  it('parses multiple --attr flags', () => {
    const result = parseArgs(['write', '--attr', 'status=active', '--attr', 'count=3'])
    expect(result.flags['attr']).toEqual({ 'status': 'active', 'count': '3' })
  })

  it('parses --pretty boolean flag', () => {
    const result = parseArgs(['search', 'query', '--pretty'])
    expect(result.flags['pretty']).toBe(true)
  })

  it('meta defaults to empty object when not provided', () => {
    const result = parseArgs(['search', 'query'])
    expect(result.flags['meta']).toBeUndefined()
  })
})
```

Also update existing tests that check `json: false` default — change to verify `pretty` defaults:

Replace the test `'json flag defaults to false'`:

```typescript
it('pretty flag defaults to false', () => {
  const result = parseArgs(['search'])
  expect(result.flags['pretty']).toBeFalsy()
})
```

Remove the test for `--json` boolean flag, and add:

```typescript
it('does not treat --json as boolean (removed)', () => {
  const result = parseArgs(['search', 'query', '--json'])
  // json is no longer a special boolean flag
  expect(result.flags['json']).toBe(true)
})
```

Actually, we should keep `--json` working as a no-op / ignored flag for now. Keep it in BOOLEAN_FLAGS for backwards compat but we won't use it. The real change is adding `--pretty`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/cli/parse-args.test.ts`
Expected: FAIL — repeatable flags not supported

- [ ] **Step 3: Update types**

In `src/cli/types.ts`, update:

```typescript
import type { MemoryEngine } from '../core/engine.ts'

interface GlobalFlags {
  config?: string
  pretty?: boolean
  cwd?: string
}

interface ParsedCommand {
  command: string
  args: string[]
  flags: GlobalFlags & Record<string, string | boolean | Record<string, string>>
}

interface CommandResult {
  output: unknown
  exitCode: number
  formatCommand?: string
}

type CommandHandler = (
  engine: MemoryEngine,
  parsed: ParsedCommand,
) => Promise<CommandResult>

export type { GlobalFlags, ParsedCommand, CommandResult, CommandHandler }
```

- [ ] **Step 4: Update parse-args**

Replace `src/cli/parse-args.ts`:

```typescript
import type { ParsedCommand } from './types.ts'

const BOOLEAN_FLAGS = new Set(['json', 'skip-dedup', 'help', 'pretty'])
const REPEATABLE_KV_FLAGS = new Set(['meta', 'attr'])

function parseArgs(argv: string[]): ParsedCommand {
  if (argv.length === 0) {
    return { command: 'help', args: [], flags: {} }
  }

  const args: string[] = []
  const flags: ParsedCommand['flags'] = {}
  let command = ''

  let i = 0
  while (i < argv.length) {
    const token = argv[i]

    if (token.startsWith('--')) {
      const raw = token.slice(2)
      const eqIdx = raw.indexOf('=')

      let key: string
      let value: string | undefined

      if (eqIdx !== -1) {
        key = raw.slice(0, eqIdx)
        value = raw.slice(eqIdx + 1)
      } else {
        key = raw
        if (BOOLEAN_FLAGS.has(key)) {
          flags[key] = true
          i++
          continue
        }
        const next = argv[i + 1]
        if (next !== undefined && !next.startsWith('--')) {
          value = next
          i++
        } else {
          flags[key] = true
          i++
          continue
        }
      }

      if (REPEATABLE_KV_FLAGS.has(key) && value !== undefined) {
        const kvEqIdx = value.indexOf('=')
        if (kvEqIdx !== -1) {
          const kvKey = value.slice(0, kvEqIdx)
          const kvVal = value.slice(kvEqIdx + 1)
          const existing = flags[key]
          if (typeof existing === 'object' && existing !== null && !Array.isArray(existing)) {
            (existing as Record<string, string>)[kvKey] = kvVal
          } else {
            flags[key] = { [kvKey]: kvVal }
          }
        } else {
          flags[key] = value
        }
      } else {
        flags[key] = value ?? true
      }
    } else if (command === '') {
      command = token
    } else {
      args.push(token)
    }

    i++
  }

  if (flags['help'] === true) {
    return { command: 'help', args, flags }
  }

  if (command === '') {
    return { command: 'help', args, flags }
  }

  return { command, args, flags }
}

export { parseArgs }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test tests/cli/parse-args.test.ts`
Expected: PASS

- [ ] **Step 6: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/cli/parse-args.ts src/cli/types.ts tests/cli/parse-args.test.ts
git commit -m "feat: add --meta, --attr repeatable flags and --pretty to CLI parser"
```

---

## Task 9: Rewrite format.ts for { ok, data } envelope with JSON default

**Files:**
- Modify: `src/cli/format.ts`
- Test: `tests/cli/format.test.ts`

- [ ] **Step 1: Rewrite the test file**

The entire format test needs to be rewritten. The key changes:
- Default output is now JSON with `{ ok: true, data }` envelope
- `--pretty` triggers human-readable text
- Error output is `{ ok: false, error: { code, message } }`

Replace `tests/cli/format.test.ts` entirely:

```typescript
import { describe, it, expect } from 'bun:test'
import { formatOutput, formatError } from '../../src/cli/format.ts'
import type {
  DomainSummary,
  IngestResult,
  SearchResult,
  AskResult,
  ContextResult,
  ScoredMemory,
} from '../../src/core/types.ts'

const makeScoredMemory = (overrides: Partial<ScoredMemory> = {}): ScoredMemory => ({
  id: 'mem1',
  content: 'Sample memory content',
  score: 0.85,
  scores: { vector: 0.85 },
  tags: ['tag1', 'tag2'],
  domainAttributes: {},
  eventTime: null,
  createdAt: 1000000,
  ...overrides,
})

describe('formatOutput - JSON mode (default)', () => {
  it('wraps data in ok envelope', () => {
    const data: IngestResult = { action: 'stored', id: 'abc123' }
    const result = formatOutput('ingest', data, false)
    const parsed = JSON.parse(result)
    expect(parsed).toEqual({ ok: true, data })
  })

  it('wraps any command data in ok envelope', () => {
    const data: DomainSummary[] = [
      { id: 'dom1', name: 'Domain One', hasStructure: true, skillCount: 3 },
    ]
    const result = formatOutput('domains', data, false)
    const parsed = JSON.parse(result)
    expect(parsed).toEqual({ ok: true, data })
  })
})

describe('formatError', () => {
  it('returns error envelope', () => {
    const result = formatError('NOT_FOUND', 'Memory not found')
    const parsed = JSON.parse(result)
    expect(parsed).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Memory not found' },
    })
  })
})

describe('formatOutput - pretty mode', () => {
  it('formats domains as table', () => {
    const data: DomainSummary[] = [
      { id: 'dom1', name: 'Domain One', description: 'Desc', hasStructure: true, skillCount: 3 },
    ]
    const result = formatOutput('domains', data, true)
    expect(result).toContain('dom1')
    expect(result).toContain('Domain One')
    expect(result).toContain('Desc')
  })

  it('formats ingest stored result', () => {
    const data: IngestResult = { action: 'stored', id: 'abc123' }
    const result = formatOutput('ingest', data, true)
    expect(result).toContain('Stored memory abc123')
  })

  it('formats search results', () => {
    const data: SearchResult = {
      entries: [makeScoredMemory()],
      totalTokens: 100,
      mode: 'hybrid',
    }
    const result = formatOutput('search', data, true)
    expect(result).toContain('[0.85]')
    expect(result).toContain('Sample memory content')
  })

  it('formats ask result', () => {
    const data: AskResult = {
      answer: 'The answer',
      memories: [makeScoredMemory()],
      rounds: 2,
    }
    const result = formatOutput('ask', data, true)
    expect(result).toContain('The answer')
  })

  it('formats build-context result', () => {
    const data: ContextResult = {
      context: 'The context text',
      memories: [makeScoredMemory()],
      totalTokens: 512,
    }
    const result = formatOutput('build-context', data, true)
    expect(result).toContain('The context text')
  })

  it('formats domain-structure', () => {
    const data = { domainId: 'dom1', structure: 'Structure text' }
    const result = formatOutput('domain-structure', data, true)
    expect(result).toBe('Structure text')
  })

  it('formats domain-skill', () => {
    const data = { content: 'Skill content here' }
    const result = formatOutput('domain-skill', data, true)
    expect(result).toBe('Skill content here')
  })

  it('formats unknown command as JSON envelope', () => {
    const result = formatOutput('unknown', { foo: 'bar' }, true)
    const parsed = JSON.parse(result)
    expect(parsed).toEqual({ ok: true, data: { foo: 'bar' } })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/cli/format.test.ts`
Expected: FAIL — old format function signature/behavior

- [ ] **Step 3: Rewrite format.ts**

Replace `src/cli/format.ts`:

```typescript
import type {
  DomainSummary,
  DomainSkill,
  IngestResult,
  SearchResult,
  AskResult,
  ContextResult,
  ScoredMemory,
} from '../core/types.ts'

function padRight(str: string, length: number): string {
  return str + ' '.repeat(Math.max(0, length - str.length))
}

// --- Pretty formatters (human-readable) ---

function prettyDomains(data: DomainSummary[]): string {
  if (data.length === 0) return ''
  const maxIdLen = Math.max(...data.map(d => d.id.length))
  const maxNameLen = Math.max(...data.map(d => d.name.length))
  return data
    .map(d => {
      const id = padRight(d.id, maxIdLen)
      const name = padRight(d.name, maxNameLen)
      const desc = d.description ?? 'No description'
      const parts: string[] = []
      if (d.skillCount > 0) parts.push(`${d.skillCount} skill${d.skillCount === 1 ? '' : 's'}`)
      if (d.hasStructure) parts.push('has structure')
      const paren = parts.length > 0 ? `  (${parts.join(', ')})` : ''
      return `${id}   ${name}   ${desc}${paren}`
    })
    .join('\n')
}

function prettyDomainSkills(data: { domainId: string; skills: DomainSkill[] }): string {
  const { skills } = data
  if (skills.length === 0) return ''
  const maxIdLen = Math.max(...skills.map(s => s.id.length))
  const maxNameLen = Math.max(...skills.map(s => s.name.length))
  return skills
    .map(s => {
      const id = padRight(s.id, maxIdLen)
      const name = padRight(s.name, maxNameLen)
      return `${id}   ${name}   ${s.description}`
    })
    .join('\n')
}

function prettyIngest(data: IngestResult): string {
  if (data.action === 'stored') return `Stored memory ${data.id ?? ''}`
  if (data.action === 'reinforced') return `Reinforced memory ${data.id ?? ''} (existing: ${data.existingId ?? ''})`
  return `Skipped (duplicate of ${data.existingId ?? ''})`
}

function prettyScoredMemory(entry: ScoredMemory): string {
  const score = entry.score.toFixed(2)
  const preview = entry.content.length > 200 ? entry.content.slice(0, 200) + '...' : entry.content
  const tagLine = entry.tags.length > 0 ? `\nTags: ${entry.tags.join(', ')}` : ''
  return `[${score}] memory:${entry.id}\n${preview}${tagLine}`
}

function prettySearch(data: SearchResult): string {
  const entries = data.entries.map(prettyScoredMemory).join('\n\n')
  const summary = `Found ${data.entries.length} result${data.entries.length === 1 ? '' : 's'} (${data.totalTokens} tokens, mode: ${data.mode})`
  return entries.length > 0 ? `${entries}\n\n${summary}` : summary
}

function prettyAsk(data: AskResult): string {
  return `${data.answer}\n\n--- ${data.memories.length} memories, ${data.rounds} rounds ---`
}

function prettyBuildContext(data: ContextResult): string {
  return `${data.context}\n\n--- ${data.memories.length} memories, ${data.totalTokens} tokens ---`
}

// --- Main formatters ---

function jsonEnvelope(data: unknown): string {
  return JSON.stringify({ ok: true, data }, null, 2)
}

function formatError(code: string, message: string): string {
  return JSON.stringify({ ok: false, error: { code, message } }, null, 2)
}

function formatOutput(command: string, data: unknown, pretty: boolean): string {
  if (!pretty) {
    return jsonEnvelope(data)
  }

  switch (command) {
    case 'domains':
      return prettyDomains(data as DomainSummary[])
    case 'domain-structure':
      return (data as { structure: string }).structure
    case 'domain-skills':
      return prettyDomainSkills(data as { domainId: string; skills: DomainSkill[] })
    case 'domain-skill':
      return (data as { content: string }).content
    case 'ingest':
      return prettyIngest(data as IngestResult)
    case 'search':
      return prettySearch(data as SearchResult)
    case 'ask':
      return prettyAsk(data as AskResult)
    case 'build-context':
      return prettyBuildContext(data as ContextResult)
    default:
      return jsonEnvelope(data)
  }
}

export { formatOutput, formatError }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/cli/format.test.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/cli/format.ts tests/cli/format.test.ts
git commit -m "feat: rewrite CLI output with JSON envelope default and --pretty flag"
```

---

## Task 10: Update cli.ts and existing commands for new format

**Files:**
- Modify: `src/cli/cli.ts`
- Modify: `src/cli/commands/ingest.ts`
- Modify: `src/cli/commands/search.ts`
- Modify: `src/cli/commands/ask.ts`
- Modify: `src/cli/commands/build-context.ts`

- [ ] **Step 1: Create parseMeta utility**

Create `src/cli/utils.ts` to avoid circular imports (cli.ts runs main() on import):

```typescript
function parseMeta(flags: Record<string, unknown>): Record<string, unknown> | undefined {
  const meta = flags['meta']
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    return meta as Record<string, unknown>
  }
  return undefined
}

export { parseMeta }
```

- [ ] **Step 2: Update cli.ts**

Replace `src/cli/cli.ts`:

```typescript
import { parseArgs } from './parse-args.ts'
import { formatOutput, formatError } from './format.ts'
import { getHelpText, getCommandHelp } from './commands/help.ts'
import { domainsCommand, domainCommand } from './commands/domains.ts'
import { ingestCommand } from './commands/ingest.ts'
import { searchCommand } from './commands/search.ts'
import { askCommand } from './commands/ask.ts'
import { buildContextCommand } from './commands/build-context.ts'
import { writeCommand } from './commands/write.ts'
import { memoryCommand } from './commands/memory.ts'
import { graphCommand } from './commands/graph.ts'
import { scheduleCommand } from './commands/schedule.ts'
import { loadConfig } from '../config-loader.ts'
import type { CommandHandler, CommandResult } from './types.ts'

const COMMANDS: Record<string, CommandHandler> = {
  ingest: ingestCommand,
  search: searchCommand,
  ask: askCommand,
  'build-context': buildContextCommand,
  domains: domainsCommand,
  domain: domainCommand,
  write: writeCommand,
  memory: memoryCommand,
  graph: graphCommand,
  schedule: scheduleCommand,
}

async function main(): Promise<void> {
  const parsed = parseArgs(Bun.argv.slice(2))
  const pretty = parsed.flags['pretty'] === true

  // Handle help early (no engine needed)
  if (parsed.command === 'help') {
    const specificHelp = parsed.args[0] ? getCommandHelp(parsed.args[0]) : null
    console.log(specificHelp ?? getHelpText())
    process.exit(0)
  }

  const handler = COMMANDS[parsed.command]
  if (!handler) {
    console.error(formatError('UNKNOWN_COMMAND', `Unknown command: ${parsed.command}`))
    process.exit(1)
  }

  // Load engine from config
  let engine
  try {
    const cwd = typeof parsed.flags['cwd'] === 'string' ? parsed.flags['cwd'] : undefined
    const config = typeof parsed.flags['config'] === 'string' ? parsed.flags['config'] : undefined
    engine = await loadConfig(cwd, config)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(formatError('CONFIG_ERROR', message))
    process.exit(1)
  }

  try {
    const result: CommandResult = await handler(engine, parsed)
    const formatCommand = result.formatCommand ?? parsed.command
    const output = formatOutput(formatCommand, result.output, pretty)

    if (output) {
      console.log(output)
    }

    process.exit(result.exitCode)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(formatError('COMMAND_ERROR', message))
    process.exit(1)
  } finally {
    await engine.close()
  }
}

void main()
```

- [ ] **Step 2: Update existing commands to use --meta instead of --user-id**

In `src/cli/commands/ingest.ts`, replace:

```typescript
import type { IngestOptions } from '../../core/types.ts'
import type { CommandHandler } from '../types.ts'
import { parseMeta } from '../utils.ts'

const ingestCommand: CommandHandler = async (engine, parsed) => {
  let text = parsed.flags['text'] as string | undefined

  if (!text && !process.stdin.isTTY) {
    text = await Bun.stdin.text()
    text = text.trim()
  }

  if (!text) {
    return { output: { error: 'No input text. Use --text or pipe from stdin.' }, exitCode: 1 }
  }

  const options: IngestOptions = {}

  if (parsed.flags['domains']) {
    options.domains = (parsed.flags['domains'] as string).split(',')
  }
  if (parsed.flags['tags']) {
    options.tags = (parsed.flags['tags'] as string).split(',')
  }
  if (parsed.flags['event-time']) {
    options.eventTime = Number(parsed.flags['event-time'])
  }
  if (parsed.flags['skip-dedup'] === true) {
    options.skipDedup = true
  }

  const meta = parseMeta(parsed.flags)
  if (meta) {
    options.context = meta
  }

  const result = await engine.ingest(text, options)
  return { output: result, exitCode: 0 }
}

export { ingestCommand }
```

In `src/cli/commands/search.ts`, replace:

```typescript
import type { CommandHandler } from '../types.ts'
import type { SearchQuery } from '../../core/types.ts'
import { parseMeta } from '../utils.ts'

const searchCommand: CommandHandler = async (engine, parsed) => {
  const text = parsed.args[0]

  if (!text) {
    return { output: { error: 'Search query is required.' }, exitCode: 1 }
  }

  const query: SearchQuery = { text }

  if (parsed.flags['mode']) {
    query.mode = parsed.flags['mode'] as SearchQuery['mode']
  }
  if (parsed.flags['domains']) {
    query.domains = (parsed.flags['domains'] as string).split(',')
  }
  if (parsed.flags['tags']) {
    query.tags = (parsed.flags['tags'] as string).split(',')
  }
  if (parsed.flags['limit']) {
    query.limit = Number(parsed.flags['limit'])
  }
  if (parsed.flags['budget']) {
    query.tokenBudget = Number(parsed.flags['budget'])
  }
  if (parsed.flags['min-score']) {
    query.minScore = Number(parsed.flags['min-score'])
  }

  const meta = parseMeta(parsed.flags)
  if (meta) {
    query.context = meta
  }

  const result = await engine.search(query)
  return { output: result, exitCode: 0 }
}

export { searchCommand }
```

In `src/cli/commands/ask.ts`, replace:

```typescript
import type { CommandHandler } from '../types.ts'
import type { AskOptions } from '../../core/types.ts'
import { parseMeta } from '../utils.ts'

const askCommand: CommandHandler = async (engine, parsed) => {
  const question = parsed.args[0]

  if (!question) {
    return { output: { error: 'Question is required.' }, exitCode: 1 }
  }

  const options: AskOptions = {}

  if (parsed.flags['domains']) {
    options.domains = (parsed.flags['domains'] as string).split(',')
  }
  if (parsed.flags['tags']) {
    options.tags = (parsed.flags['tags'] as string).split(',')
  }
  if (parsed.flags['budget']) {
    options.budgetTokens = Number(parsed.flags['budget'])
  }
  if (parsed.flags['limit']) {
    options.limit = Number(parsed.flags['limit'])
  }

  const meta = parseMeta(parsed.flags)
  if (meta) {
    options.context = meta
  }

  const result = await engine.ask(question, options)
  return { output: result, exitCode: 0 }
}

export { askCommand }
```

In `src/cli/commands/build-context.ts`, replace:

```typescript
import type { CommandHandler } from '../types.ts'
import type { ContextOptions } from '../../core/types.ts'
import { parseMeta } from '../utils.ts'

const buildContextCommand: CommandHandler = async (engine, parsed) => {
  const text = parsed.args[0]

  if (!text) {
    return { output: { error: 'Text is required.' }, exitCode: 1 }
  }

  const options: ContextOptions = {}

  if (parsed.flags['domains']) {
    options.domains = (parsed.flags['domains'] as string).split(',')
  }
  if (parsed.flags['budget']) {
    options.budgetTokens = Number(parsed.flags['budget'])
  }
  if (parsed.flags['max-memories']) {
    options.maxMemories = Number(parsed.flags['max-memories'])
  }

  const meta = parseMeta(parsed.flags)
  if (meta) {
    options.context = meta
  }

  const result = await engine.buildContext(text, options)
  return { output: result, exitCode: 0 }
}

export { buildContextCommand }
```

- [ ] **Step 3: Run existing CLI tests (they will fail — fix in next step)**

Run: `bun test tests/cli/`
Expected: FAIL — tests reference old `json` flag, old format expectations

- [ ] **Step 4: Update existing CLI command tests**

In `tests/cli/commands/ingest.test.ts`, update `makeParsed` to remove `json: false`:

```typescript
function makeParsed(flags: Record<string, string | boolean> = {}): ParsedCommand {
  return {
    command: 'ingest',
    args: [],
    flags: { ...flags },
  }
}
```

Similarly update `tests/cli/commands/search.test.ts`, `tests/cli/commands/ask.test.ts`, `tests/cli/commands/build-context.test.ts` — remove `json: false` from `makeParsed` helpers. The test assertions on `result.output` should remain the same since command handlers still return raw data (formatting is done by cli.ts, not commands).

In `tests/cli/commands/domains.test.ts`, same fix if present.

- [ ] **Step 5: Run all CLI tests**

Run: `bun test tests/cli/`
Expected: PASS

- [ ] **Step 6: Run all tests**

Run: `bun test`
Expected: PASS

- [ ] **Step 7: Run typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add src/cli/ tests/cli/
git commit -m "feat: migrate CLI to JSON envelope default, --pretty flag, --meta replacing --user-id"
```

> **Note:** Task 10 creates `src/cli/utils.ts` — ensure it's included in the commit.

---

## Task 11: Add write command

**Files:**
- Create: `src/cli/commands/write.ts`
- Test: `tests/cli/commands/write.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/cli/commands/write.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { StringRecordId } from 'surrealdb'
import { MemoryEngine } from '../../../src/core/engine.ts'
import { MockLLMAdapter } from '../../helpers.ts'
import { writeCommand } from '../../../src/cli/commands/write.ts'
import type { ParsedCommand } from '../../../src/cli/types.ts'

function makeParsed(flags: Record<string, string | boolean | Record<string, string>> = {}): ParsedCommand {
  return {
    command: 'write',
    args: [],
    flags: { ...flags },
  }
}

describe('writeCommand', () => {
  let engine: MemoryEngine

  beforeEach(async () => {
    engine = new MemoryEngine()
    await engine.initialize({
      connection: 'mem://',
      namespace: 'test',
      database: `test_write_cmd_${Date.now()}`,
      llm: new MockLLMAdapter(),
    })
  })

  afterEach(async () => {
    await engine.close()
  })

  it('creates a memory with required flags', async () => {
    const parsed = makeParsed({ domain: 'log', text: 'Test write content' })
    const result = await writeCommand(engine, parsed)

    expect(result.exitCode).toBe(0)
    const output = result.output as { id: string }
    expect(output.id).toContain('memory:')
  })

  it('returns error when --domain is missing', async () => {
    const parsed = makeParsed({ text: 'No domain' })
    const result = await writeCommand(engine, parsed)
    expect(result.exitCode).toBe(1)
  })

  it('returns error when --text is missing', async () => {
    const parsed = makeParsed({ domain: 'log' })
    const result = await writeCommand(engine, parsed)
    expect(result.exitCode).toBe(1)
  })

  it('passes tags to engine', async () => {
    const parsed = makeParsed({ domain: 'log', text: 'Tagged', tags: 'topic,active' })
    const result = await writeCommand(engine, parsed)

    const output = result.output as { id: string }
    const tags = await engine.getGraph().query<string[]>(
      'SELECT VALUE out.label FROM tagged WHERE in = $id',
      { id: new StringRecordId(output.id) }
    )
    expect(tags).toContain('topic')
    expect(tags).toContain('active')
  })

  it('passes attributes to engine', async () => {
    const parsed = makeParsed({
      domain: 'log',
      text: 'With attrs',
      attr: { status: 'active', count: '3' },
    })
    const result = await writeCommand(engine, parsed)

    const output = result.output as { id: string }
    const owners = await engine.getGraph().query<{ attributes: Record<string, unknown> }[]>(
      'SELECT attributes FROM owned_by WHERE in = $id',
      { id: new StringRecordId(output.id) }
    )
    expect(owners![0].attributes).toEqual({ status: 'active', count: '3' })
  })

  it('passes meta as context', async () => {
    const parsed = makeParsed({
      domain: 'log',
      text: 'With meta',
      meta: { 'user-id': 'abc' },
    })
    const result = await writeCommand(engine, parsed)
    expect(result.exitCode).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/cli/commands/write.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement write command**

Create `src/cli/commands/write.ts`:

```typescript
import type { CommandHandler } from '../types.ts'
import type { WriteOptions } from '../../core/types.ts'
import { parseMeta } from '../utils.ts'

const writeCommand: CommandHandler = async (engine, parsed) => {
  const text = parsed.flags['text'] as string | undefined
  const domain = parsed.flags['domain'] as string | undefined

  if (!domain) {
    return { output: { error: '--domain is required' }, exitCode: 1 }
  }

  if (!text) {
    return { output: { error: '--text is required' }, exitCode: 1 }
  }

  const options: WriteOptions = { domain }

  if (parsed.flags['tags']) {
    options.tags = (parsed.flags['tags'] as string).split(',')
  }

  const attr = parsed.flags['attr']
  if (attr && typeof attr === 'object') {
    options.attributes = attr as Record<string, unknown>
  }

  const meta = parseMeta(parsed.flags)
  if (meta) {
    options.context = meta
  }

  const result = await engine.writeMemory(text, options)
  return { output: result, exitCode: 0 }
}

export { writeCommand }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/cli/commands/write.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/write.ts tests/cli/commands/write.test.ts
git commit -m "feat: add CLI write command for direct memory creation"
```

---

## Task 12: Add memory command

**Files:**
- Create: `src/cli/commands/memory.ts`
- Test: `tests/cli/commands/memory.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/cli/commands/memory.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { MemoryEngine } from '../../../src/core/engine.ts'
import { MockLLMAdapter } from '../../helpers.ts'
import { memoryCommand } from '../../../src/cli/commands/memory.ts'
import type { ParsedCommand } from '../../../src/cli/types.ts'

function makeParsed(args: string[], flags: Record<string, string | boolean | Record<string, string>> = {}): ParsedCommand {
  return { command: 'memory', args, flags: { ...flags } }
}

describe('memoryCommand', () => {
  let engine: MemoryEngine
  let memId: string

  beforeEach(async () => {
    engine = new MemoryEngine()
    await engine.initialize({
      connection: 'mem://',
      namespace: 'test',
      database: `test_memcmd_${Date.now()}`,
      llm: new MockLLMAdapter(),
    })
    const result = await engine.writeMemory('Test content', { domain: 'log', tags: ['test'] })
    memId = result.id
  })

  afterEach(async () => {
    await engine.close()
  })

  it('reads a memory by id', async () => {
    const result = await memoryCommand(engine, makeParsed([memId]))
    expect(result.exitCode).toBe(0)
    const output = result.output as { id: string; content: string }
    expect(output.content).toBe('Test content')
  })

  it('returns error for missing id', async () => {
    const result = await memoryCommand(engine, makeParsed([]))
    expect(result.exitCode).toBe(1)
  })

  it('returns error for non-existent memory', async () => {
    const result = await memoryCommand(engine, makeParsed(['memory:nonexistent']))
    expect(result.exitCode).toBe(1)
  })

  it('updates memory text', async () => {
    const result = await memoryCommand(engine, makeParsed([memId, 'update'], { text: 'Updated' }))
    expect(result.exitCode).toBe(0)

    const read = await memoryCommand(engine, makeParsed([memId]))
    expect((read.output as { content: string }).content).toBe('Updated')
  })

  it('updates memory attributes', async () => {
    const result = await memoryCommand(engine, makeParsed([memId, 'update'], { attr: { status: 'done' } }))
    expect(result.exitCode).toBe(0)
  })

  it('lists tags', async () => {
    const result = await memoryCommand(engine, makeParsed([memId, 'tags']))
    expect(result.exitCode).toBe(0)
    const output = result.output as { tags: string[] }
    expect(output.tags).toContain('test')
  })

  it('adds a tag', async () => {
    const result = await memoryCommand(engine, makeParsed([memId, 'tag', 'newtag']))
    expect(result.exitCode).toBe(0)
    const output = result.output as { tags: string[] }
    expect(output.tags).toContain('newtag')
  })

  it('removes a tag', async () => {
    const result = await memoryCommand(engine, makeParsed([memId, 'untag', 'test']))
    expect(result.exitCode).toBe(0)
    const output = result.output as { tags: string[] }
    expect(output.tags).not.toContain('test')
  })

  it('releases ownership', async () => {
    const result = await memoryCommand(engine, makeParsed([memId, 'release'], { domain: 'log' }))
    expect(result.exitCode).toBe(0)
  })

  it('deletes a memory', async () => {
    const result = await memoryCommand(engine, makeParsed([memId, 'delete']))
    expect(result.exitCode).toBe(0)

    const read = await memoryCommand(engine, makeParsed([memId]))
    expect(read.exitCode).toBe(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/cli/commands/memory.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement memory command**

Create `src/cli/commands/memory.ts`:

```typescript
import type { CommandHandler } from '../types.ts'

const memoryCommand: CommandHandler = async (engine, parsed) => {
  const memId = parsed.args[0]
  if (!memId) {
    return { output: { error: 'Memory ID is required' }, exitCode: 1 }
  }

  const subcommand = parsed.args[1]

  // Default: read memory
  if (!subcommand) {
    const mem = await engine.getMemory(memId)
    if (!mem) {
      return { output: { error: `Memory "${memId}" not found` }, exitCode: 1 }
    }
    const tags = await engine.getMemoryTags(memId)
    return { output: { ...mem, tags }, exitCode: 0 }
  }

  if (subcommand === 'update') {
    const text = parsed.flags['text'] as string | undefined
    const attr = parsed.flags['attr']
    const attributes = (attr && typeof attr === 'object') ? attr as Record<string, unknown> : undefined

    if (!text && !attributes) {
      return { output: { error: 'Provide --text and/or --attr key=value to update' }, exitCode: 1 }
    }

    await engine.updateMemory(memId, { text, attributes })
    return { output: { id: memId }, exitCode: 0 }
  }

  if (subcommand === 'tags') {
    const tags = await engine.getMemoryTags(memId)
    return { output: { tags }, exitCode: 0 }
  }

  if (subcommand === 'tag') {
    const tag = parsed.args[2]
    if (!tag) {
      return { output: { error: 'Tag name is required' }, exitCode: 1 }
    }
    await engine.tagMemory(memId, tag)
    const tags = await engine.getMemoryTags(memId)
    return { output: { tags }, exitCode: 0 }
  }

  if (subcommand === 'untag') {
    const tag = parsed.args[2]
    if (!tag) {
      return { output: { error: 'Tag name is required' }, exitCode: 1 }
    }
    await engine.untagMemory(memId, tag)
    const tags = await engine.getMemoryTags(memId)
    return { output: { tags }, exitCode: 0 }
  }

  if (subcommand === 'release') {
    const domain = parsed.flags['domain'] as string | undefined
    if (!domain) {
      return { output: { error: '--domain is required for release' }, exitCode: 1 }
    }
    await engine.releaseOwnership(memId, domain)
    return { output: { id: memId }, exitCode: 0 }
  }

  if (subcommand === 'delete') {
    await engine.deleteMemory(memId)
    return { output: { id: memId }, exitCode: 0 }
  }

  return { output: { error: `Unknown subcommand "${subcommand}"` }, exitCode: 1 }
}

export { memoryCommand }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/cli/commands/memory.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/memory.ts tests/cli/commands/memory.test.ts
git commit -m "feat: add CLI memory command for CRUD and tagging"
```

---

## Task 13: Add graph command

**Files:**
- Create: `src/cli/commands/graph.ts`
- Test: `tests/cli/commands/graph.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/cli/commands/graph.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { MemoryEngine } from '../../../src/core/engine.ts'
import { MockLLMAdapter } from '../../helpers.ts'
import { graphCommand } from '../../../src/cli/commands/graph.ts'
import type { ParsedCommand } from '../../../src/cli/types.ts'

function makeParsed(args: string[], flags: Record<string, string | boolean | Record<string, string>> = {}): ParsedCommand {
  return { command: 'graph', args, flags: { ...flags } }
}

describe('graphCommand', () => {
  let engine: MemoryEngine
  let memId1: string
  let memId2: string

  beforeEach(async () => {
    engine = new MemoryEngine()
    await engine.initialize({
      connection: 'mem://',
      namespace: 'test',
      database: `test_graphcmd_${Date.now()}`,
      llm: new MockLLMAdapter(),
    })
    const r1 = await engine.writeMemory('Node A', { domain: 'log' })
    const r2 = await engine.writeMemory('Node B', { domain: 'log' })
    memId1 = r1.id
    memId2 = r2.id
  })

  afterEach(async () => {
    await engine.close()
  })

  it('returns error for missing subcommand', async () => {
    const result = await graphCommand(engine, makeParsed([]))
    expect(result.exitCode).toBe(1)
  })

  it('relate creates an edge', async () => {
    const result = await graphCommand(engine, makeParsed(
      ['relate', memId1, memId2, 'reinforces'],
      { domain: 'log' }
    ))
    expect(result.exitCode).toBe(0)
    const output = result.output as { id: string }
    expect(output.id).toBeTruthy()
  })

  it('relate requires --domain', async () => {
    const result = await graphCommand(engine, makeParsed(
      ['relate', memId1, memId2, 'reinforces']
    ))
    expect(result.exitCode).toBe(1)
  })

  it('relate with attributes', async () => {
    const result = await graphCommand(engine, makeParsed(
      ['relate', memId1, memId2, 'reinforces'],
      { domain: 'log', attr: { strength: '0.9' } }
    ))
    expect(result.exitCode).toBe(0)
  })

  it('edges lists edges for a node', async () => {
    await engine.relate(memId1, memId2, 'reinforces', 'log')

    const result = await graphCommand(engine, makeParsed(['edges', memId1]))
    expect(result.exitCode).toBe(0)
    const output = result.output as { edges: unknown[] }
    expect(output.edges.length).toBeGreaterThan(0)
  })

  it('edges with direction filter', async () => {
    await engine.relate(memId1, memId2, 'reinforces', 'log')

    const result = await graphCommand(engine, makeParsed(['edges', memId1], { direction: 'out' }))
    expect(result.exitCode).toBe(0)
  })

  it('unrelate removes an edge', async () => {
    await engine.relate(memId1, memId2, 'reinforces', 'log')

    const result = await graphCommand(engine, makeParsed(['unrelate', memId1, memId2, 'reinforces']))
    expect(result.exitCode).toBe(0)
    const output = result.output as { removed: boolean }
    expect(output.removed).toBe(true)
  })

  it('traverse follows edges', async () => {
    await engine.relate(memId1, memId2, 'reinforces', 'log')

    const result = await graphCommand(engine, makeParsed(
      ['traverse', memId1],
      { edges: 'reinforces' }
    ))
    expect(result.exitCode).toBe(0)
    const output = result.output as { nodes: { id: string }[] }
    expect(output.nodes.length).toBeGreaterThanOrEqual(1)
    expect(output.nodes[0].id).toBe(memId2)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/cli/commands/graph.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement graph command**

Create `src/cli/commands/graph.ts`:

```typescript
import type { CommandHandler } from '../types.ts'

const graphCommand: CommandHandler = async (engine, parsed) => {
  const subcommand = parsed.args[0]

  if (!subcommand) {
    return { output: { error: 'Subcommand required: edges, relate, unrelate, traverse' }, exitCode: 1 }
  }

  if (subcommand === 'edges') {
    const nodeId = parsed.args[1]
    if (!nodeId) {
      return { output: { error: 'Node ID is required' }, exitCode: 1 }
    }
    const direction = parsed.flags['direction'] as 'in' | 'out' | 'both' | undefined
    const domain = parsed.flags['domain'] as string | undefined
    const edges = await engine.getEdges(nodeId, direction, domain)
    return { output: { edges }, exitCode: 0 }
  }

  if (subcommand === 'relate') {
    const from = parsed.args[1]
    const to = parsed.args[2]
    const edgeType = parsed.args[3]
    const domain = parsed.flags['domain'] as string | undefined

    if (!from || !to || !edgeType) {
      return { output: { error: 'Usage: graph relate <from> <to> <edge-type> --domain <id>' }, exitCode: 1 }
    }
    if (!domain) {
      return { output: { error: '--domain is required for relate' }, exitCode: 1 }
    }

    const attr = parsed.flags['attr']
    const attrs = (attr && typeof attr === 'object') ? attr as Record<string, unknown> : undefined
    const id = await engine.relate(from, to, edgeType, domain, attrs)
    return { output: { id }, exitCode: 0 }
  }

  if (subcommand === 'unrelate') {
    const from = parsed.args[1]
    const to = parsed.args[2]
    const edgeType = parsed.args[3]

    if (!from || !to || !edgeType) {
      return { output: { error: 'Usage: graph unrelate <from> <to> <edge-type>' }, exitCode: 1 }
    }

    await engine.unrelate(from, to, edgeType)
    return { output: { removed: true }, exitCode: 0 }
  }

  if (subcommand === 'traverse') {
    const startId = parsed.args[1]
    if (!startId) {
      return { output: { error: 'Start node ID is required' }, exitCode: 1 }
    }

    const edgesFlag = parsed.flags['edges'] as string | undefined
    if (!edgesFlag) {
      return { output: { error: '--edges is required (comma-separated edge types)' }, exitCode: 1 }
    }

    const edgeTypes = edgesFlag.split(',')
    const depth = parsed.flags['depth'] ? Number(parsed.flags['depth']) : undefined
    const domain = parsed.flags['domain'] as string | undefined

    const nodes = await engine.traverse(startId, edgeTypes, depth, domain)
    return { output: { nodes }, exitCode: 0 }
  }

  return { output: { error: `Unknown subcommand "${subcommand}"` }, exitCode: 1 }
}

export { graphCommand }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/cli/commands/graph.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/graph.ts tests/cli/commands/graph.test.ts
git commit -m "feat: add CLI graph command for edge operations and traversal"
```

---

## Task 14: Add schedule command

**Files:**
- Create: `src/cli/commands/schedule.ts`
- Test: `tests/cli/commands/schedule.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/cli/commands/schedule.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { MemoryEngine } from '../../../src/core/engine.ts'
import { MockLLMAdapter } from '../../helpers.ts'
import { createTopicDomain } from '../../../src/domains/topic/index.ts'
import { scheduleCommand } from '../../../src/cli/commands/schedule.ts'
import type { ParsedCommand } from '../../../src/cli/types.ts'

function makeParsed(args: string[], flags: Record<string, string | boolean> = {}): ParsedCommand {
  return { command: 'schedule', args, flags: { ...flags } }
}

describe('scheduleCommand', () => {
  let engine: MemoryEngine

  beforeEach(async () => {
    engine = new MemoryEngine()
    await engine.initialize({
      connection: 'mem://',
      namespace: 'test',
      database: `test_schedcmd_${Date.now()}`,
      llm: new MockLLMAdapter(),
    })
    await engine.registerDomain(createTopicDomain())
  })

  afterEach(async () => {
    await engine.close()
  })

  it('list returns all schedules', async () => {
    const result = await scheduleCommand(engine, makeParsed(['list']))
    expect(result.exitCode).toBe(0)
    const output = result.output as { schedules: unknown[] }
    expect(output.schedules.length).toBeGreaterThan(0)
  })

  it('list filters by domain', async () => {
    const result = await scheduleCommand(engine, makeParsed(['list'], { domain: 'topic' }))
    expect(result.exitCode).toBe(0)
    const output = result.output as { schedules: { domain: string }[] }
    for (const s of output.schedules) {
      expect(s.domain).toBe('topic')
    }
  })

  it('trigger runs a schedule', async () => {
    const listResult = await scheduleCommand(engine, makeParsed(['list'], { domain: 'topic' }))
    const schedules = (listResult.output as { schedules: { id: string }[] }).schedules
    const scheduleId = schedules[0].id

    const result = await scheduleCommand(engine, makeParsed(['trigger', 'topic', scheduleId]))
    expect(result.exitCode).toBe(0)
    const output = result.output as { triggered: boolean }
    expect(output.triggered).toBe(true)
  })

  it('trigger returns error for unknown schedule', async () => {
    const result = await scheduleCommand(engine, makeParsed(['trigger', 'topic', 'nonexistent']))
    expect(result.exitCode).toBe(1)
  })

  it('returns error for missing subcommand', async () => {
    const result = await scheduleCommand(engine, makeParsed([]))
    expect(result.exitCode).toBe(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/cli/commands/schedule.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement schedule command**

Create `src/cli/commands/schedule.ts`:

```typescript
import type { CommandHandler } from '../types.ts'

const scheduleCommand: CommandHandler = async (engine, parsed) => {
  const subcommand = parsed.args[0]

  if (!subcommand) {
    return { output: { error: 'Subcommand required: list, trigger' }, exitCode: 1 }
  }

  if (subcommand === 'list') {
    const domain = parsed.flags['domain'] as string | undefined
    const schedules = engine.listSchedules(domain)
    return { output: { schedules }, exitCode: 0 }
  }

  if (subcommand === 'trigger') {
    const domainId = parsed.args[1]
    const scheduleId = parsed.args[2]

    if (!domainId || !scheduleId) {
      return { output: { error: 'Usage: schedule trigger <domain-id> <schedule-id>' }, exitCode: 1 }
    }

    try {
      await engine.triggerSchedule(domainId, scheduleId)
      return { output: { triggered: true, domain: domainId, schedule: scheduleId }, exitCode: 0 }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { output: { error: message }, exitCode: 1 }
    }
  }

  return { output: { error: `Unknown subcommand "${subcommand}"` }, exitCode: 1 }
}

export { scheduleCommand }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/cli/commands/schedule.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/schedule.ts tests/cli/commands/schedule.test.ts
git commit -m "feat: add CLI schedule command for listing and triggering schedules"
```

---

## Task 15: Update help text

**Files:**
- Modify: `src/cli/commands/help.ts`

- [ ] **Step 1: Update help.ts**

Replace `src/cli/commands/help.ts` with updated content that includes all new commands and new global flags:

```typescript
const USAGE = `
Usage: active-memory <command> [options]

Commands:
  ingest          Store new memory from text or stdin
  search          Search memories by query
  ask             Ask a question against stored memories
  build-context   Build a context block from relevant memories
  write           Create a memory with direct domain ownership
  memory          Read, update, tag, or delete a memory
  graph           Manage graph edges and traversals
  schedule        List or trigger domain schedules
  domains         List all available domains
  domain          Inspect a specific domain
  help            Show this help text

Global Flags:
  --config <path>       Path to config file
  --cwd <path>          Working directory
  --pretty              Output as human-readable text (default: JSON)
  --meta key=value      Set request context metadata (repeatable)

Run "active-memory help <command>" for detailed help on a specific command.
`.trim()

const COMMAND_HELP: Record<string, string> = {
  ingest: `
Usage: active-memory ingest [--text "..."] [--domains d1,d2] [--tags t1,t2] [--event-time <ms>] [--skip-dedup] [--meta key=value]

Store a new memory. Reads from stdin if piped, otherwise requires --text.

Options:
  --text <string>      Text content to ingest
  --domains <list>     Comma-separated list of domains to assign
  --tags <list>        Comma-separated list of tags to assign
  --event-time <ms>    Event timestamp in milliseconds (defaults to now)
  --skip-dedup         Skip deduplication check
  --meta key=value     Request context metadata (repeatable)

Examples:
  echo "Meeting notes..." | active-memory ingest --domains work
  active-memory ingest --text "Buy milk" --tags shopping --meta user-id=abc
`.trim(),

  search: `
Usage: active-memory search <query> [--mode vector|fulltext|graph|hybrid] [--domains d1,d2] [--tags t1,t2] [--limit N] [--budget N] [--min-score N] [--meta key=value]

Search stored memories by query string.

Arguments:
  <query>              The search query

Options:
  --mode <mode>        Search mode: vector, fulltext, graph, or hybrid (default: hybrid)
  --domains <list>     Comma-separated list of domains to search within
  --tags <list>        Comma-separated list of tags to filter by
  --limit <N>          Maximum number of results to return
  --budget <N>         Token budget for results
  --min-score <N>      Minimum relevance score threshold
  --meta key=value     Request context metadata (repeatable)

Examples:
  active-memory search "project deadlines" --mode vector --limit 5
  active-memory search "shopping list" --domains personal --meta user-id=abc
`.trim(),

  ask: `
Usage: active-memory ask <question> [--domains d1,d2] [--tags t1,t2] [--budget N] [--limit N] [--meta key=value]

Ask a natural language question and retrieve relevant memories as an answer.

Arguments:
  <question>           The question to ask

Options:
  --domains <list>     Comma-separated list of domains to search within
  --tags <list>        Comma-separated list of tags to filter by
  --budget <N>         Token budget for context
  --limit <N>          Maximum number of memories to consider
  --meta key=value     Request context metadata (repeatable)

Examples:
  active-memory ask "What did I decide about the API design?"
  active-memory ask "What are my tasks?" --domains work --meta user-id=abc
`.trim(),

  'build-context': `
Usage: active-memory build-context <text> [--domains d1,d2] [--budget N] [--max-memories N] [--meta key=value]

Build a context block from memories relevant to the provided text.

Arguments:
  <text>               Text to build context around

Options:
  --domains <list>     Comma-separated list of domains to search within
  --budget <N>         Token budget for the context block
  --max-memories <N>   Maximum number of memories to include
  --meta key=value     Request context metadata (repeatable)

Examples:
  active-memory build-context "Summarize the project status" --budget 2000
  active-memory build-context "Auth flow" --domains codebase --meta session-id=xyz
`.trim(),

  write: `
Usage: active-memory write --domain <id> --text <text> [--tags t1,t2] [--attr key=value] [--meta key=value]

Create a memory with direct domain ownership. No deduplication or inbox processing.

Options:
  --domain <id>        Domain that owns this memory (required)
  --text <string>      Memory content (required)
  --tags <list>        Comma-separated list of tags to assign
  --attr key=value     Domain attributes (repeatable)
  --meta key=value     Request context metadata (repeatable)

Examples:
  active-memory write --domain topic --text "Machine Learning" --tags topic --attr status=active
  active-memory write --domain user --text "Prefers dark mode" --tags preference --meta user-id=abc
`.trim(),

  memory: `
Usage: active-memory memory <id> [subcommand] [options]

Read, update, tag, or delete a specific memory.

Subcommands:
  (none)               Read memory details
  update               Update text or attributes
  tags                 List tags on this memory
  tag <tag>            Add a tag
  untag <tag>          Remove a tag
  release              Release domain ownership
  delete               Delete the memory

Options:
  --text <string>      New text content (for update)
  --attr key=value     Attributes to update (repeatable, for update)
  --domain <id>        Domain to release (for release)

Examples:
  active-memory memory memory:abc123
  active-memory memory memory:abc123 update --text "New content"
  active-memory memory memory:abc123 tag important
  active-memory memory memory:abc123 release --domain topic
  active-memory memory memory:abc123 delete
`.trim(),

  graph: `
Usage: active-memory graph <subcommand> [options]

Manage graph edges and run traversals.

Subcommands:
  edges <node-id>      List edges for a node
  relate <from> <to> <edge-type>    Create an edge
  unrelate <from> <to> <edge-type>  Remove an edge
  traverse <start-id>               Walk edges from a starting node

Options:
  --domain <id>        Domain for ownership (required for relate)
  --direction <dir>    Edge direction: in, out, both (for edges, default: both)
  --attr key=value     Edge attributes (repeatable, for relate)
  --edges <list>       Comma-separated edge types (for traverse)
  --depth <N>          Traversal depth (for traverse, default: 1)

Examples:
  active-memory graph edges memory:abc123 --direction out
  active-memory graph relate memory:abc topic:ml about_topic --domain topic
  active-memory graph unrelate memory:abc topic:ml about_topic
  active-memory graph traverse topic:ml --edges subtopic_of,related_to --depth 2
`.trim(),

  schedule: `
Usage: active-memory schedule <subcommand> [options]

List or manually trigger domain schedules.

Subcommands:
  list                 List all registered schedules
  trigger <domain-id> <schedule-id>  Run a schedule now

Options:
  --domain <id>        Filter schedules by domain (for list)

Examples:
  active-memory schedule list
  active-memory schedule list --domain topic
  active-memory schedule trigger topic merge-similar-topics
`.trim(),

  domains: `
Usage: active-memory domains

List all available domains and their descriptions.

Examples:
  active-memory domains
  active-memory domains --pretty
`.trim(),

  domain: `
Usage: active-memory domain <id> <subcommand>

Inspect a specific domain by its ID.

Arguments:
  <id>                 Domain ID

Subcommands:
  structure            Show the domain's data structure
  skills               List all skills registered in the domain
  skill <skill-id>     Show details for a specific skill

Examples:
  active-memory domain topic structure
  active-memory domain topic skills
  active-memory domain topic skill topic-management
`.trim(),

  help: `
Usage: active-memory help [<command>]

Show help text. Pass a command name to see detailed help for that command.

Examples:
  active-memory help
  active-memory help write
  active-memory --help
`.trim(),
}

function getHelpText(): string {
  return USAGE
}

function getCommandHelp(command: string): string | null {
  return COMMAND_HELP[command] ?? null
}

export { getHelpText, getCommandHelp }
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/help.ts
git commit -m "docs: update CLI help text with new commands and flags"
```

---

## Task 16: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `bun test`
Expected: All tests pass

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

- [ ] **Step 3: Run lint**

Run: `bun run lint`
Expected: No errors (or only pre-existing warnings)

- [ ] **Step 4: Verify circular import safety**

The new CLI commands import `parseMeta` from `cli.ts`. Verify no circular import issues by checking that `cli.ts` exports `parseMeta` and the command files import it without issues.

Run: `bun test tests/cli/`
Expected: All CLI tests pass

- [ ] **Step 5: Commit any final fixes**

If any issues found, fix and commit.

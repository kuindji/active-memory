import { Surreal, StringRecordId } from 'surrealdb'
import { createNodeEngines } from '@surrealdb/node'
import { GraphStore } from './graph-store.ts'
import { SchemaRegistry } from './schema-registry.ts'
import { SearchEngine } from './search-engine.ts'
import { InboxProcessor } from './inbox-processor.ts'
import { FlowRegistry } from './flow-registry.ts'
import { Scheduler } from './scheduler.ts'
import { EventEmitter } from './events.ts'
import { logFlow } from '../flows/log-flow.ts'
import { countTokens, applyTokenBudget } from './scoring.ts'
import type {
  EngineConfig,
  FlowConfig,
  FlowContext,
  IngestOptions,
  IngestResult,
  SearchQuery,
  SearchResult,
  MemoryEntry,
  LLMAdapter,
  ContextOptions,
  ContextResult,
  AskOptions,
  AskResult,
  ScoredMemory,
} from './types.ts'

class MemoryEngine {
  private db: Surreal | null = null
  private graph!: GraphStore
  private schema!: SchemaRegistry
  private searchEngine!: SearchEngine
  private inboxProcessor!: InboxProcessor
  private flowRegistry = new FlowRegistry()
  private scheduler!: Scheduler
  private events = new EventEmitter()
  private llm!: LLMAdapter

  async initialize(config: EngineConfig): Promise<void> {
    const db = new Surreal({ engines: createNodeEngines() })
    await db.connect(config.connection)
    await db.use({
      namespace: config.namespace ?? 'default',
      database: config.database ?? 'memory',
    })

    this.db = db
    this.llm = config.llm

    // Set up schema
    this.schema = new SchemaRegistry(db)
    await this.schema.registerCore()

    // Register shared schemas
    if (config.sharedSchemas) {
      for (const shared of config.sharedSchemas) {
        await this.schema.registerShared(shared)
      }
    }

    // Create inbox tag
    this.graph = new GraphStore(db)
    try {
      await this.graph.createNodeWithId('tag:inbox', {
        label: 'inbox',
        created_at: Date.now(),
      })
    } catch {
      // Already exists — that's fine
    }

    // Initialize subsystems
    this.searchEngine = new SearchEngine(this.graph)
    this.scheduler = new Scheduler(
      (flowId: string) => this.createFlowContext(flowId),
      this.events
    )
    this.inboxProcessor = new InboxProcessor(
      this.graph,
      this.flowRegistry,
      this.events,
      (flowId: string) => this.createFlowContext(flowId)
    )

    // Register built-in log flow
    await this.registerFlow(logFlow)
  }

  async registerFlow(flow: FlowConfig): Promise<void> {
    // Register schema if provided
    if (flow.schema) {
      await this.schema.registerFlow(flow.id, flow.schema)
    }

    // Create flow node in SurrealDB
    try {
      await this.graph.createNodeWithId(`flow:${flow.id}`, {
        name: flow.name,
      })
    } catch {
      // Already exists — that's fine
    }

    // Register in FlowRegistry
    this.flowRegistry.register(flow)

    // Register schedules
    if (flow.schedules) {
      for (const schedule of flow.schedules) {
        this.scheduler.registerSchedule(flow.id, schedule)
      }
    }
  }

  async ingest(text: string, options?: IngestOptions): Promise<IngestResult> {
    const now = Date.now()
    const tokens = countTokens(text)

    // Create memory node
    const memData: Record<string, unknown> = {
      content: text,
      created_at: now,
      token_count: tokens,
    }
    if (options?.eventTime !== undefined) {
      memData.event_time = options.eventTime
    }
    const memId = await this.graph.createNode('memory', memData)

    // Tag with inbox
    await this.graph.relate(memId, 'tagged', 'tag:inbox')

    // Add extra tags
    if (options?.tags) {
      for (const tag of options.tags) {
        const tagId = tag.startsWith('tag:') ? tag : `tag:${tag}`
        try {
          await this.graph.createNodeWithId(tagId, {
            label: tag.startsWith('tag:') ? tag.slice(4) : tag,
            created_at: now,
          })
        } catch {
          // Already exists
        }
        await this.graph.relate(memId, 'tagged', tagId)
      }
    }

    // Determine target flows — log flow always gets ownership
    const targetFlowIds = options?.flowIds
      ? [...new Set([...options.flowIds, 'log'])]
      : this.flowRegistry.getAllFlowIds()

    // Assign ownership
    for (const flowId of targetFlowIds) {
      const fullFlowId = flowId.startsWith('flow:') ? flowId : `flow:${flowId}`
      await this.graph.relate(memId, 'owned_by', fullFlowId, {
        attributes: options?.metadata ?? {},
        owned_at: now,
      })
    }

    // Emit event
    this.events.emit('ingested', { id: memId, content: text, tokenCount: tokens })

    return { action: 'stored', id: memId }
  }

  async search(query: SearchQuery): Promise<SearchResult> {
    // Let flows expand/rank the query
    let expandedQuery = query
    const targetFlows = query.flowIds ?? this.flowRegistry.getAllFlowIds()

    for (const flowId of targetFlows) {
      const flow = this.flowRegistry.get(flowId)
      if (flow?.search?.expand) {
        const ctx = this.createFlowContext(flowId)
        expandedQuery = await flow.search.expand(expandedQuery, ctx)
      }
    }

    let result = await this.searchEngine.search(expandedQuery)

    // Let flows rank results
    for (const flowId of targetFlows) {
      const flow = this.flowRegistry.get(flowId)
      if (flow?.search?.rank) {
        result = {
          ...result,
          entries: flow.search.rank(expandedQuery, result.entries),
        }
      }
    }

    return result
  }

  async releaseOwnership(memoryId: string, flowId: string): Promise<void> {
    const fullFlowId = flowId.startsWith('flow:') ? flowId : `flow:${flowId}`

    // Remove owned_by edge
    await this.graph.unrelate(memoryId, 'owned_by', fullFlowId)

    this.events.emit('ownershipRemoved', { memoryId, flowId })

    // Count remaining owners
    const remaining = await this.graph.query<{ count: number }[]>(
      'SELECT count() AS count FROM owned_by WHERE in = $memId GROUP ALL',
      { memId: new StringRecordId(memoryId) }
    )

    const count = (remaining && remaining.length > 0) ? remaining[0].count : 0

    // Delete memory if no owners remain
    if (count === 0) {
      // Remove all edges first
      await this.graph.query(
        'DELETE tagged WHERE in = $memId',
        { memId: new StringRecordId(memoryId) }
      )
      await this.graph.query(
        'DELETE reinforces WHERE in = $memId OR out = $memId',
        { memId: new StringRecordId(memoryId) }
      )
      await this.graph.query(
        'DELETE contradicts WHERE in = $memId OR out = $memId',
        { memId: new StringRecordId(memoryId) }
      )
      await this.graph.query(
        'DELETE summarizes WHERE in = $memId OR out = $memId',
        { memId: new StringRecordId(memoryId) }
      )
      await this.graph.query(
        'DELETE refines WHERE in = $memId OR out = $memId',
        { memId: new StringRecordId(memoryId) }
      )

      await this.graph.deleteNode(memoryId)

      this.events.emit('deleted', { memoryId })
    }
  }

  createFlowContext(flowId: string): FlowContext {
    const engine = this
    const graph = this.graph
    const llm = this.llm

    return {
      flowId,
      graph,
      llm,

      async getMemory(id: string): Promise<MemoryEntry | null> {
        const node = await graph.getNode(id)
        if (!node) return null
        return {
          id: node.id,
          content: node.content as string,
          eventTime: (node.event_time as number | null) ?? null,
          createdAt: node.created_at as number,
          tokenCount: node.token_count as number,
        }
      },

      async getMemories(ids: string[]): Promise<MemoryEntry[]> {
        const results: MemoryEntry[] = []
        for (const id of ids) {
          const entry = await this.getMemory(id)
          if (entry) results.push(entry)
        }
        return results
      },

      async getMemoriesByFlow(targetFlowId: string): Promise<string[]> {
        const fullId = targetFlowId.startsWith('flow:') ? targetFlowId : `flow:${targetFlowId}`
        const rows = await graph.query<{ in: unknown }[]>(
          'SELECT in FROM owned_by WHERE out = $flowId',
          { flowId: new StringRecordId(fullId) }
        )
        if (!rows) return []
        return rows.map(r => String(r.in))
      },

      async getMemoriesSince(targetFlowId: string, since: number): Promise<string[]> {
        const fullId = targetFlowId.startsWith('flow:') ? targetFlowId : `flow:${targetFlowId}`
        const rows = await graph.query<{ in: unknown }[]>(
          'SELECT in FROM owned_by WHERE out = $flowId AND owned_at >= $since',
          { flowId: new StringRecordId(fullId), since }
        )
        if (!rows) return []
        return rows.map(r => String(r.in))
      },

      async addTag(path: string): Promise<void> {
        const parts = path.split('/')
        let parentId: string | null = null
        for (const part of parts) {
          const tagId = `tag:${part}`
          try {
            await graph.createNodeWithId(tagId, {
              label: part,
              created_at: Date.now(),
            })
          } catch {
            // Already exists
          }
          if (parentId) {
            await graph.relate(tagId, 'child_of', parentId)
          }
          parentId = tagId
        }
      },

      async tagMemory(memoryId: string, tagId: string): Promise<void> {
        const fullTagId = tagId.startsWith('tag:') ? tagId : `tag:${tagId}`
        await graph.relate(memoryId, 'tagged', fullTagId)
        engine.events.emit('tagAssigned', { memoryId, tagId: fullTagId })
      },

      async untagMemory(memoryId: string, tagId: string): Promise<void> {
        const fullTagId = tagId.startsWith('tag:') ? tagId : `tag:${tagId}`
        await graph.unrelate(memoryId, 'tagged', fullTagId)
        engine.events.emit('tagRemoved', { memoryId, tagId: fullTagId })
      },

      async getTagDescendants(tagPath: string): Promise<string[]> {
        const tagId = tagPath.startsWith('tag:') ? tagPath : `tag:${tagPath}`
        const descendants = await graph.query<string[]>(
          'SELECT VALUE id FROM tag WHERE ->child_of->tag CONTAINS $tagId',
          { tagId: new StringRecordId(tagId) }
        )
        if (!descendants) return []
        return descendants.map(d => String(d))
      },

      async addOwnership(
        memoryId: string,
        targetFlowId: string,
        attributes?: Record<string, unknown>
      ): Promise<void> {
        const fullFlowId = targetFlowId.startsWith('flow:') ? targetFlowId : `flow:${targetFlowId}`
        await graph.relate(memoryId, 'owned_by', fullFlowId, {
          attributes: attributes ?? {},
          owned_at: Date.now(),
        })
        engine.events.emit('ownershipAdded', { memoryId, flowId: targetFlowId })
      },

      async releaseOwnership(memoryId: string, targetFlowId: string): Promise<void> {
        await engine.releaseOwnership(memoryId, targetFlowId)
      },

      async updateAttributes(memoryId: string, attributes: Record<string, unknown>): Promise<void> {
        const fullFlowId = flowId.startsWith('flow:') ? flowId : `flow:${flowId}`
        await graph.query(
          'UPDATE owned_by SET attributes = $attrs WHERE in = $memId AND out = $flowId',
          {
            memId: new StringRecordId(memoryId),
            flowId: new StringRecordId(fullFlowId),
            attrs: attributes,
          }
        )
      },

      async search(query: Omit<SearchQuery, 'flowIds'>): Promise<SearchResult> {
        return engine.search({ ...query, flowIds: [flowId] })
      },

      async getMeta(key: string): Promise<string | null> {
        const metaId = `meta:${flowId}_${key}`
        const node = await graph.getNode(metaId)
        if (!node) return null
        return (node.value as string) ?? null
      },

      async setMeta(key: string, value: string): Promise<void> {
        const metaId = `meta:${flowId}_${key}`
        try {
          await graph.createNodeWithId(metaId, { value })
        } catch {
          await graph.updateNode(metaId, { value })
        }
      },
    }
  }

  async buildContext(text: string, options?: ContextOptions): Promise<ContextResult> {
    const budgetTokens = options?.budgetTokens ?? 4000
    const limit = options?.maxMemories ?? 50

    // Check if a target flow has custom buildContext
    if (options?.flowIds?.length === 1) {
      const flow = this.flowRegistry.get(options.flowIds[0]!)
      if (flow?.buildContext) {
        const ctx = this.createFlowContext(options.flowIds[0]!)
        return flow.buildContext(text, budgetTokens, ctx)
      }
    }

    // Search with hybrid mode (no vector for now)
    const result = await this.search({
      mode: 'hybrid',
      text,
      limit,
      flowIds: options?.flowIds,
      weights: { vector: 0.0, fulltext: 0.7, graph: 0.3 },
    })

    // Apply token budget
    const fitted = applyTokenBudget(
      result.entries.map(e => ({ ...e, tokenCount: countTokens(e.content) })),
      budgetTokens
    )

    // Format as numbered plain text
    const context = fitted
      .map((m, i) => `[${i + 1}] ${m.content}`)
      .join('\n\n')

    const totalTokens = countTokens(context)

    return { context, memories: fitted, totalTokens }
  }

  async ask(question: string, options?: AskOptions): Promise<AskResult> {
    const budgetTokens = options?.budgetTokens ?? 8000
    const limit = options?.limit ?? 30
    const maxRounds = 3

    const allMemories = new Map<string, ScoredMemory>()
    let rounds = 0

    // Get available top-level tags for the system prompt
    const topTags = await this.graph.query<{ label: string }[]>(
      'SELECT label FROM tag WHERE ->child_of->tag IS NONE OR array::len(->child_of->tag) = 0'
    )
    const tagList = topTags
      ? topTags
          .map(t => t.label)
          .filter(l => l !== 'inbox')
          .join(', ')
      : ''

    const systemPrompt = `You are a search assistant. Given a question, decide how to search a memory database.

Available search capabilities:
- "text": fulltext search terms (keywords or phrases)
- "tags": filter by tag categories (available: ${tagList})

Respond with JSON only. Either:
1. A query plan: { "text": "search terms", "tags": ["tag1"], "reasoning": "why" }
2. A final answer: { "answer": "your analytical response" }

If you have enough information from previous search results, respond with an answer.
Otherwise, respond with a query plan to find more relevant information.`

    const history: string[] = [`Question: ${question}`]

    for (let round = 0; round < maxRounds; round++) {
      rounds = round + 1

      const prompt = `${systemPrompt}\n\n${history.join('\n\n')}`
      if (!this.llm.generate) {
        throw new Error('LLM adapter must implement generate() to use ask()')
      }
      const response = await this.llm.generate(prompt)

      // Parse LLM response
      let parsed: Record<string, unknown>
      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/)
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) as Record<string, unknown> : {}
      } catch {
        // If parsing fails, treat as final answer
        parsed = { answer: response }
      }

      // Check if LLM gave a final answer
      if (typeof parsed.answer === 'string') {
        break
      }

      // Execute query plan
      const searchQuery: SearchQuery = {
        mode: 'hybrid',
        text: typeof parsed.text === 'string' ? parsed.text : question,
        tags: Array.isArray(parsed.tags) ? parsed.tags as string[] : options?.tags,
        limit,
        weights: { vector: 0.0, fulltext: 0.7, graph: 0.3 },
        flowIds: options?.flowIds,
      }

      const result = await this.search(searchQuery)

      // Accumulate memories (dedup by ID)
      for (const entry of result.entries) {
        if (!allMemories.has(entry.id)) {
          allMemories.set(entry.id, entry)
        }
      }

      // Add results summary to history for next round
      const resultSummary = result.entries
        .slice(0, 10)
        .map((e, i) => `  [${i + 1}] (score: ${e.score.toFixed(3)}) ${e.content.slice(0, 200)}`)
        .join('\n')
      history.push(`Round ${rounds} results (${result.entries.length} found):\n${resultSummary}`)
    }

    // Apply token budget to accumulated memories
    const sortedMemories = [...allMemories.values()]
      .sort((a, b) => b.score - a.score)

    const fitted = applyTokenBudget(
      sortedMemories.map(e => ({ ...e, tokenCount: countTokens(e.content) })),
      budgetTokens
    )

    // Final synthesis
    if (!this.llm.synthesize) {
      throw new Error('LLM adapter must implement synthesize() to use ask()')
    }
    const answer = await this.llm.synthesize(question, fitted)

    return { answer, memories: fitted, rounds }
  }

  getGraph(): GraphStore {
    return this.graph
  }

  getFlowRegistry(): FlowRegistry {
    return this.flowRegistry
  }

  getEvents(): EventEmitter {
    return this.events
  }

  startProcessing(intervalMs?: number): void {
    this.inboxProcessor.start(intervalMs)
    this.scheduler.start()
  }

  stopProcessing(): void {
    this.inboxProcessor.stop()
    this.scheduler.stop()
  }

  async processInbox(): Promise<boolean> {
    return this.inboxProcessor.processNext()
  }

  async close(): Promise<void> {
    this.stopProcessing()
    if (this.db) {
      await this.db.close()
      this.db = null
    }
  }
}

export { MemoryEngine }

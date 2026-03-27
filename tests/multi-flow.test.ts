import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { MemoryEngine } from '../src/core/engine.ts'
import { MockLLMAdapter } from './helpers.ts'
import type { FlowConfig, OwnedMemory, FlowContext, SharedSchema } from '../src/core/types.ts'

const testSharedSchema: SharedSchema = {
  nodes: [
    {
      name: 'person',
      fields: [
        { name: 'name', type: 'string' },
        { name: 'roles', type: 'array<string>', required: false },
        { name: 'first_seen', type: 'int', required: false },
      ],
    },
    {
      name: 'region',
      fields: [
        { name: 'name', type: 'string' },
        { name: 'type', type: 'string', required: false },
      ],
      indexes: [{ name: 'idx_region_name', fields: ['name'], type: 'unique' }],
    },
    {
      name: 'topic',
      fields: [
        { name: 'name', type: 'string' },
        { name: 'status', type: 'string', required: false, default: 'active' },
      ],
    },
  ],
  edges: [
    { name: 'located_in', from: ['person'], to: 'region' },
  ],
}

describe('Multi-flow integration', () => {
  let engine: MemoryEngine

  const conflictFlow: FlowConfig = {
    id: 'conflict',
    name: 'Conflict Analysis',
    schema: {
      nodes: [],
      edges: [
        { name: 'about', from: 'memory', to: 'topic', fields: [{ name: 'relevance', type: 'float' }] },
        { name: 'mentions', from: 'memory', to: 'person', fields: [{ name: 'role_in_context', type: 'string' }] },
      ],
    },
    async processInboxItem(entry: OwnedMemory, ctx: FlowContext) {
      if (entry.memory.content.includes('Iran')) {
        const topicId = await ctx.graph.createNodeWithId('topic:iran_sanctions', {
          name: 'Iran Sanctions',
          status: 'active',
        }).catch(() => 'topic:iran_sanctions')
        await ctx.graph.relate(entry.memory.id, 'about', topicId, { relevance: 0.9 })
      }
    },
  }

  const financialFlow: FlowConfig = {
    id: 'financial',
    name: 'Financial Analysis',
    schema: {
      nodes: [
        { name: 'market', fields: [{ name: 'name', type: 'string' }, { name: 'type', type: 'string' }] },
      ],
      edges: [
        { name: 'affects', from: 'memory', to: 'market', fields: [{ name: 'direction', type: 'string' }] },
      ],
    },
    async processInboxItem(entry: OwnedMemory, ctx: FlowContext) {
      if (entry.memory.content.includes('oil')) {
        const marketId = await ctx.graph.createNodeWithId('market:oil', {
          name: 'Oil',
          type: 'commodity',
        }).catch(() => 'market:oil')
        await ctx.graph.relate(entry.memory.id, 'affects', marketId, { direction: 'down' })
      }
    },
  }

  beforeEach(async () => {
    engine = new MemoryEngine()
    await engine.initialize({
      connection: 'mem://',
      namespace: 'test',
      database: `test_${Date.now()}`,
      llm: new MockLLMAdapter(),
      sharedSchemas: [testSharedSchema],
    })
    await engine.registerFlow(conflictFlow)
    await engine.registerFlow(financialFlow)
  })

  afterEach(async () => {
    await engine.close()
  })

  test('shared schema allows creating shared node types', async () => {
    const graph = engine.getGraph()
    const regionId = await graph.createNodeWithId('region:iran', { name: 'Iran', type: 'country' })
    expect(regionId).toBe('region:iran')

    const region = await graph.getNode('region:iran')
    expect(region!.name).toBe('Iran')
  })

  test('multiple flows process the same memory', async () => {
    const result = await engine.ingest('Iran sanctions impact on oil markets', {
      flowIds: ['conflict', 'financial'],
    })

    // Process inbox — processNext handles one memory through all its owning flows
    await engine.processInbox()

    const graph = engine.getGraph()

    // Conflict flow should have created topic and linked it
    const topics = await graph.traverse(result.id!, '->about->topic')
    expect(topics.length).toBe(1)

    // Financial flow should have created market and linked it
    const markets = await graph.traverse(result.id!, '->affects->market')
    expect(markets.length).toBe(1)
  })

  test('shared person node is accessible to both flows', async () => {
    const graph = engine.getGraph()

    await graph.createNodeWithId('person:khamenei', {
      name: 'Ali Khamenei',
      roles: ['Supreme Leader'],
      first_seen: Date.now(),
    })

    const person = await graph.getNode('person:khamenei')
    expect(person!.name).toBe('Ali Khamenei')

    await graph.createNodeWithId('region:iran', { name: 'Iran', type: 'country' })
    await graph.relate('person:khamenei', 'located_in', 'region:iran')

    const regionIds = await graph.traverse<string>('person:khamenei', '->located_in->region')
    expect(regionIds.length).toBe(1)

    const linkedRegion = await graph.getNode(String(regionIds[0]))
    expect(linkedRegion!.name).toBe('Iran')
  })

  test('flow schema extension does not conflict', async () => {
    expect(engine.getFlowRegistry().has('conflict')).toBe(true)
    expect(engine.getFlowRegistry().has('financial')).toBe(true)
  })

  test('search across flows', async () => {
    await engine.ingest('Iran nuclear deal progress', { flowIds: ['conflict'] })
    await engine.ingest('Oil price forecast Q2 2026', { flowIds: ['financial'] })

    const result = await engine.search({
      mode: 'graph',
      flowIds: ['conflict', 'financial'],
      limit: 10,
    })
    expect(result.entries.length).toBe(2)

    const conflictOnly = await engine.search({
      mode: 'graph',
      flowIds: ['conflict'],
      limit: 10,
    })
    expect(conflictOnly.entries.length).toBe(1)
    expect(conflictOnly.entries[0].content).toContain('Iran')
  })
})

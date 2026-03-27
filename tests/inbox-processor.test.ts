import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { InboxProcessor } from '../src/core/inbox-processor.ts'
import { GraphStore } from '../src/core/graph-store.ts'
import { SchemaRegistry } from '../src/core/schema-registry.ts'
import { FlowRegistry } from '../src/core/flow-registry.ts'
import { EventEmitter } from '../src/core/events.ts'
import { createTestDb, MockLLMAdapter } from './helpers.ts'
import type { Surreal } from 'surrealdb'
import type { FlowConfig, OwnedMemory, FlowContext } from '../src/core/types.ts'

describe('InboxProcessor', () => {
  let db: Surreal
  let store: GraphStore
  let flowRegistry: FlowRegistry
  let events: EventEmitter
  let processor: InboxProcessor
  const processedItems: OwnedMemory[] = []

  const testFlow: FlowConfig = {
    id: 'test',
    name: 'Test Flow',
    async processInboxItem(entry: OwnedMemory, _ctx: FlowContext) {
      processedItems.push(entry)
    },
  }

  beforeEach(async () => {
    processedItems.length = 0
    db = await createTestDb()
    const schema = new SchemaRegistry(db)
    await schema.registerCore()
    store = new GraphStore(db)
    flowRegistry = new FlowRegistry()
    flowRegistry.register(testFlow)
    events = new EventEmitter()
    processor = new InboxProcessor(store, flowRegistry, events, (flowId: string) => ({
      flowId,
      graph: store,
      llm: new MockLLMAdapter(),
    } as unknown as FlowContext))
  })

  afterEach(async () => {
    await db.close()
  })

  test('processNext picks up inbox-tagged memory', async () => {
    const memId = await store.createNode('memory', {
      content: 'test content',
      created_at: Date.now(),
      token_count: 5,
    })
    await store.createNodeWithId('tag:inbox', { label: 'inbox', created_at: Date.now() })
    await store.relate(memId, 'tagged', 'tag:inbox')
    await store.createNodeWithId('flow:test', { name: 'Test Flow' })
    await store.relate(memId, 'owned_by', 'flow:test', { attributes: {}, owned_at: Date.now() })

    const processed = await processor.processNext()
    expect(processed).toBe(true)
    expect(processedItems.length).toBe(1)
    expect(processedItems[0].memory.content).toBe('test content')
  })

  test('processNext returns false when no inbox items', async () => {
    const processed = await processor.processNext()
    expect(processed).toBe(false)
  })

  test('processNext removes inbox tag after processing', async () => {
    const memId = await store.createNode('memory', {
      content: 'test content',
      created_at: Date.now(),
      token_count: 5,
    })
    await store.createNodeWithId('tag:inbox', { label: 'inbox', created_at: Date.now() })
    await store.relate(memId, 'tagged', 'tag:inbox')
    await store.createNodeWithId('flow:test', { name: 'Test Flow' })
    await store.relate(memId, 'owned_by', 'flow:test', { attributes: {}, owned_at: Date.now() })

    await processor.processNext()

    // Verify inbox tag is removed
    const tags = await store.traverse<{ id: string }>(memId, '->tagged->tag')
    const inboxTags = tags.filter(t => String(t.id) === 'tag:inbox')
    expect(inboxTags.length).toBe(0)
  })

  test('emits inboxProcessed event', async () => {
    const emittedEvents: unknown[] = []
    events.on('inboxProcessed', (...args: unknown[]) => {
      emittedEvents.push(args[0])
    })

    const memId = await store.createNode('memory', {
      content: 'event test',
      created_at: Date.now(),
      token_count: 5,
    })
    await store.createNodeWithId('tag:inbox', { label: 'inbox', created_at: Date.now() })
    await store.relate(memId, 'tagged', 'tag:inbox')
    await store.createNodeWithId('flow:test', { name: 'Test Flow' })
    await store.relate(memId, 'owned_by', 'flow:test', { attributes: {}, owned_at: Date.now() })

    await processor.processNext()

    expect(emittedEvents.length).toBe(1)
    expect((emittedEvents[0] as { memoryId: string }).memoryId).toBe(memId)
  })

  test('processes memory with multiple owning flows', async () => {
    const secondProcessed: OwnedMemory[] = []
    const secondFlow: FlowConfig = {
      id: 'second',
      name: 'Second Flow',
      async processInboxItem(entry: OwnedMemory, _ctx: FlowContext) {
        secondProcessed.push(entry)
      },
    }
    flowRegistry.register(secondFlow)

    const memId = await store.createNode('memory', {
      content: 'multi-flow content',
      created_at: Date.now(),
      token_count: 5,
    })
    await store.createNodeWithId('tag:inbox', { label: 'inbox', created_at: Date.now() })
    await store.relate(memId, 'tagged', 'tag:inbox')
    await store.createNodeWithId('flow:test', { name: 'Test Flow' })
    await store.createNodeWithId('flow:second', { name: 'Second Flow' })
    await store.relate(memId, 'owned_by', 'flow:test', { attributes: {}, owned_at: Date.now() })
    await store.relate(memId, 'owned_by', 'flow:second', { attributes: {}, owned_at: Date.now() })

    await processor.processNext()

    expect(processedItems.length).toBe(1)
    expect(secondProcessed.length).toBe(1)
    expect(processedItems[0].memory.content).toBe('multi-flow content')
    expect(secondProcessed[0].memory.content).toBe('multi-flow content')
  })
})

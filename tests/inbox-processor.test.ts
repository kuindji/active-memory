import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { InboxProcessor } from '../src/core/inbox-processor.ts'
import { GraphStore } from '../src/core/graph-store.ts'
import { SchemaRegistry } from '../src/core/schema-registry.ts'
import { DomainRegistry } from '../src/core/domain-registry.ts'
import { EventEmitter } from '../src/core/events.ts'
import { createTestDb, MockLLMAdapter } from './helpers.ts'
import type { Surreal } from 'surrealdb'
import type { DomainConfig, OwnedMemory, DomainContext } from '../src/core/types.ts'

describe('InboxProcessor', () => {
  let db: Surreal
  let store: GraphStore
  let domainRegistry: DomainRegistry
  let events: EventEmitter
  let processor: InboxProcessor
  const processedItems: OwnedMemory[] = []
  const claimCalls: string[] = []

  beforeEach(async () => {
    processedItems.length = 0
    claimCalls.length = 0
    db = await createTestDb()
    const schema = new SchemaRegistry(db)
    await schema.registerCore()
    store = new GraphStore(db)
    domainRegistry = new DomainRegistry()
    events = new EventEmitter()
    processor = new InboxProcessor(store, domainRegistry, events, (domainId: string) => ({
      domain: domainId,
      graph: store,
      llm: new MockLLMAdapter(),
    } as unknown as DomainContext))
  })

  afterEach(async () => {
    await db.close()
  })

  // Helper to create a memory with inbox tag
  async function createInboxMemory(content: string): Promise<string> {
    const memId = await store.createNode('memory', {
      content,
      created_at: Date.now(),
      token_count: content.split(' ').length,
    })
    try {
      await store.createNodeWithId('tag:inbox', { label: 'inbox', created_at: Date.now() })
    } catch { /* already exists */ }
    await store.relate(memId, 'tagged', 'tag:inbox')
    return memId
  }

  // Helper to add an inbox:domain processing tag
  async function addInboxDomainTag(memId: string, domainId: string): Promise<void> {
    const tagId = `tag:\`inbox:${domainId}\``
    try {
      await store.createNodeWithId(tagId, { label: `inbox:${domainId}`, created_at: Date.now() })
    } catch { /* already exists */ }
    await store.relate(memId, 'tagged', tagId)
  }

  // Helper to add an assert-claim tag
  async function addAssertClaimTag(memId: string, domainId: string): Promise<void> {
    const tagId = `tag:\`inbox:assert-claim:${domainId}\``
    try {
      await store.createNodeWithId(tagId, {
        label: `inbox:assert-claim:${domainId}`,
        created_at: Date.now(),
      })
    } catch { /* already exists */ }
    await store.relate(memId, 'tagged', tagId)
  }

  // Helper to create domain node
  async function createDomainNode(domainId: string): Promise<void> {
    try {
      await store.createNodeWithId(`domain:${domainId}`, { name: domainId })
    } catch { /* already exists */ }
  }

  describe('Phase 1: Claim Assertion', () => {
    test('assertInboxClaim is called for domains with assert-claim tags', async () => {
      const domain: DomainConfig = {
        id: 'claimer',
        name: 'Claimer',
        async processInboxItem() {},
        assertInboxClaim(entry) {
          claimCalls.push(entry.memory.content)
          return Promise.resolve(true)
        },
      }
      domainRegistry.register(domain)

      const memId = await createInboxMemory('claim me')
      await addAssertClaimTag(memId, 'claimer')

      await processor.tick()

      expect(claimCalls).toEqual(['claim me'])
    })

    test('domain claiming creates owned_by edge and triggers processing', async () => {
      const domain: DomainConfig = {
        id: 'claimer',
        name: 'Claimer',
        processInboxItem(entry: OwnedMemory): Promise<void> {
          processedItems.push(entry)
          return Promise.resolve()
        },
        assertInboxClaim() { return Promise.resolve(true) },
      }
      domainRegistry.register(domain)
      await createDomainNode('claimer')

      const memId = await createInboxMemory('claim me')
      await addAssertClaimTag(memId, 'claimer')

      await processor.tick()

      // Check owned_by edge exists
      const owners = await store.query<{ out: unknown }[]>(
        'SELECT out FROM owned_by WHERE in = $memId',
        { memId: new (await import('surrealdb')).StringRecordId(memId) }
      )
      expect(owners?.length).toBe(1)

      // Phase 2 should have processed it in the same tick
      expect(processedItems.length).toBe(1)
      expect(processedItems[0].memory.content).toBe('claim me')
    })

    test('domain declining removes assert-claim tag only', async () => {
      const domain: DomainConfig = {
        id: 'decliner',
        name: 'Decliner',
        async processInboxItem() {},
        assertInboxClaim() { return Promise.resolve(false) },
      }
      domainRegistry.register(domain)

      // Also register an autoOwn domain so memory isn't orphaned
      const autoOwn: DomainConfig = {
        id: 'auto',
        name: 'Auto',
        settings: { autoOwn: true },
        async processInboxItem() {},
      }
      domainRegistry.register(autoOwn)
      await createDomainNode('auto')

      const memId = await createInboxMemory('not for decliner')
      await addAssertClaimTag(memId, 'decliner')
      // Give auto domain ownership
      await store.relate(memId, 'owned_by', 'domain:auto', { attributes: {}, owned_at: Date.now() })
      await addInboxDomainTag(memId, 'auto')

      await processor.tick()

      // Assert-claim tag should be removed
      const assertTags = await store.query<string[]>(
        `SELECT VALUE out.label FROM tagged WHERE in = $memId AND string::starts_with(out.label, 'inbox:assert-claim:')`,
        { memId: new (await import('surrealdb')).StringRecordId(memId) }
      )
      expect(assertTags?.length ?? 0).toBe(0)

      // No owned_by edge for decliner
      const owners = await store.query<{ out: unknown }[]>(
        `SELECT out FROM owned_by WHERE in = $memId AND out = domain:decliner`,
        { memId: new (await import('surrealdb')).StringRecordId(memId) }
      )
      expect(owners?.length ?? 0).toBe(0)
    })

    test('unclaimed memory with no owners gets deleted', async () => {
      const domain: DomainConfig = {
        id: 'decliner',
        name: 'Decliner',
        async processInboxItem() {},
        assertInboxClaim() { return Promise.resolve(false) },
      }
      domainRegistry.register(domain)

      const memId = await createInboxMemory('nobody wants me')
      await addAssertClaimTag(memId, 'decliner')

      await processor.tick()

      const memory = await store.getNode(memId)
      expect(memory).toBeNull()
    })

    test('multiple domains assert in parallel', async () => {
      const calls: string[] = []
      const domainA: DomainConfig = {
        id: 'a',
        name: 'A',
        async processInboxItem() {},
        assertInboxClaim() { calls.push('a'); return Promise.resolve(true) },
      }
      const domainB: DomainConfig = {
        id: 'b',
        name: 'B',
        async processInboxItem() {},
        assertInboxClaim() { calls.push('b'); return Promise.resolve(false) },
      }
      domainRegistry.register(domainA)
      domainRegistry.register(domainB)
      await createDomainNode('a')

      const memId = await createInboxMemory('shared content')
      await addAssertClaimTag(memId, 'a')
      await addAssertClaimTag(memId, 'b')

      await processor.tick()

      expect(calls).toContain('a')
      expect(calls).toContain('b')
    })

    test('assertInboxClaim error does not block other domains', async () => {
      const errorEvents: unknown[] = []
      events.on('error', (...args: unknown[]) => { errorEvents.push(args[0]) })

      const domainA: DomainConfig = {
        id: 'thrower',
        name: 'Thrower',
        async processInboxItem() {},
        assertInboxClaim() { throw new Error('boom') },
      }
      const domainB: DomainConfig = {
        id: 'claimer',
        name: 'Claimer',
        async processInboxItem() {},
        assertInboxClaim() { return Promise.resolve(true) },
      }
      domainRegistry.register(domainA)
      domainRegistry.register(domainB)
      await createDomainNode('claimer')

      const memId = await createInboxMemory('test content')
      await addAssertClaimTag(memId, 'thrower')
      await addAssertClaimTag(memId, 'claimer')

      await processor.tick()

      // Claimer should still have claimed
      const owners = await store.query<{ out: unknown }[]>(
        'SELECT out FROM owned_by WHERE in = $memId',
        { memId: new (await import('surrealdb')).StringRecordId(memId) }
      )
      expect(owners?.length).toBe(1)
      expect(errorEvents.length).toBe(1)
    })
  })

  describe('Phase 2: Inbox Processing', () => {
    test('processInboxItem called for domain with inbox:domain tag', async () => {
      const domain: DomainConfig = {
        id: 'test',
        name: 'Test',
        processInboxItem(entry: OwnedMemory): Promise<void> {
          processedItems.push(entry)
          return Promise.resolve()
        },
      }
      domainRegistry.register(domain)
      await createDomainNode('test')

      const memId = await createInboxMemory('process me')
      await store.relate(memId, 'owned_by', 'domain:test', { attributes: {}, owned_at: Date.now() })
      await addInboxDomainTag(memId, 'test')

      await processor.tick()

      expect(processedItems.length).toBe(1)
      expect(processedItems[0].memory.content).toBe('process me')
    })

    test('inbox tag removed when all domain tags cleared', async () => {
      const domainA: DomainConfig = {
        id: 'a',
        name: 'A',
        async processInboxItem() {},
      }
      const domainB: DomainConfig = {
        id: 'b',
        name: 'B',
        async processInboxItem() {},
      }
      domainRegistry.register(domainA)
      domainRegistry.register(domainB)
      await createDomainNode('a')
      await createDomainNode('b')

      const memId = await createInboxMemory('multi-domain')
      await store.relate(memId, 'owned_by', 'domain:a', { attributes: {}, owned_at: Date.now() })
      await store.relate(memId, 'owned_by', 'domain:b', { attributes: {}, owned_at: Date.now() })
      await addInboxDomainTag(memId, 'a')
      await addInboxDomainTag(memId, 'b')

      await processor.tick()

      // inbox tag should be removed
      const tags = await store.query<string[]>(
        `SELECT VALUE out.label FROM tagged WHERE in = $memId`,
        { memId: new (await import('surrealdb')).StringRecordId(memId) }
      )
      const inboxTags = (tags ?? []).filter(l => typeof l === 'string' && l.startsWith('inbox'))
      expect(inboxTags.length).toBe(0)
    })

    test('error in one domain does not block others', async () => {
      const errorEvents: unknown[] = []
      events.on('error', (...args: unknown[]) => { errorEvents.push(args[0]) })

      const domainA: DomainConfig = {
        id: 'thrower',
        name: 'Thrower',
        processInboxItem(): Promise<void> { throw new Error('boom') },
      }
      const domainB: DomainConfig = {
        id: 'worker',
        name: 'Worker',
        processInboxItem(entry: OwnedMemory): Promise<void> {
          processedItems.push(entry)
          return Promise.resolve()
        },
      }
      domainRegistry.register(domainA)
      domainRegistry.register(domainB)
      await createDomainNode('thrower')
      await createDomainNode('worker')

      const memId = await createInboxMemory('mixed results')
      await store.relate(memId, 'owned_by', 'domain:thrower', { attributes: {}, owned_at: Date.now() })
      await store.relate(memId, 'owned_by', 'domain:worker', { attributes: {}, owned_at: Date.now() })
      await addInboxDomainTag(memId, 'thrower')
      await addInboxDomainTag(memId, 'worker')

      await processor.tick()

      expect(processedItems.length).toBe(1)
      expect(errorEvents.length).toBe(1)

      // Both inbox tags should be removed
      const tags = await store.query<string[]>(
        `SELECT VALUE out.label FROM tagged WHERE in = $memId AND string::starts_with(out.label, 'inbox:')`,
        { memId: new (await import('surrealdb')).StringRecordId(memId) }
      )
      expect(tags?.length ?? 0).toBe(0)
    })
  })

  describe('Lock', () => {
    test('stale lock is overridden', async () => {
      await store.createNodeWithId('meta:_inbox_lock', {
        value: JSON.stringify({ lockedAt: Date.now() - 3_600_000 }),
      })

      const domain: DomainConfig = {
        id: 'test',
        name: 'Test',
        processInboxItem(entry: OwnedMemory): Promise<void> {
          processedItems.push(entry)
          return Promise.resolve()
        },
      }
      domainRegistry.register(domain)
      await createDomainNode('test')

      const memId = await createInboxMemory('stale lock test')
      await store.relate(memId, 'owned_by', 'domain:test', { attributes: {}, owned_at: Date.now() })
      await addInboxDomainTag(memId, 'test')

      await processor.tick()

      expect(processedItems.length).toBe(1)
      const lock = await store.getNode('meta:_inbox_lock')
      expect(lock).toBeNull()
    })

    test('fresh lock prevents processing', async () => {
      await store.createNodeWithId('meta:_inbox_lock', {
        value: JSON.stringify({ lockedAt: Date.now() }),
      })

      const domain: DomainConfig = {
        id: 'test',
        name: 'Test',
        processInboxItem(entry: OwnedMemory): Promise<void> {
          processedItems.push(entry)
          return Promise.resolve()
        },
      }
      domainRegistry.register(domain)
      await createDomainNode('test')

      const memId = await createInboxMemory('locked test')
      await store.relate(memId, 'owned_by', 'domain:test', { attributes: {}, owned_at: Date.now() })
      await addInboxDomainTag(memId, 'test')

      await processor.tick()

      expect(processedItems.length).toBe(0)
    })

    test('lock is released after processing', async () => {
      const domain: DomainConfig = {
        id: 'test',
        name: 'Test',
        processInboxItem(entry: OwnedMemory): Promise<void> {
          processedItems.push(entry)
          return Promise.resolve()
        },
      }
      domainRegistry.register(domain)
      await createDomainNode('test')

      const memId = await createInboxMemory('lock release test')
      await store.relate(memId, 'owned_by', 'domain:test', { attributes: {}, owned_at: Date.now() })
      await addInboxDomainTag(memId, 'test')

      await processor.tick()

      const lock = await store.getNode('meta:_inbox_lock')
      expect(lock).toBeNull()
      expect(processedItems.length).toBe(1)
    })
  })
})

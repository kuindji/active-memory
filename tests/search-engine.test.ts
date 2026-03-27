import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { SearchEngine } from '../src/core/search-engine.ts'
import { GraphStore } from '../src/core/graph-store.ts'
import { SchemaRegistry } from '../src/core/schema-registry.ts'
import { createTestDb } from './helpers.ts'
import type { Surreal } from 'surrealdb'

describe('SearchEngine', () => {
  let db: Surreal
  let store: GraphStore
  let search: SearchEngine

  beforeEach(async () => {
    db = await createTestDb()
    const schema = new SchemaRegistry(db)
    await schema.registerCore()
    store = new GraphStore(db)
    search = new SearchEngine(store)
  })

  afterEach(async () => {
    await db.close()
  })

  describe('graph search', () => {
    test('finds memories connected via edges', async () => {
      await store.createNodeWithId('tag:test_topic', { label: 'test_topic', created_at: Date.now() })
      const m1 = await store.createNode('memory', {
        content: 'first memory about topic',
        created_at: Date.now(),
        token_count: 5,
      })
      const m2 = await store.createNode('memory', {
        content: 'second memory about topic',
        created_at: Date.now(),
        token_count: 5,
      })
      await store.relate(m1, 'tagged', 'tag:test_topic')
      await store.relate(m2, 'tagged', 'tag:test_topic')

      await store.createNode('memory', {
        content: 'unrelated memory',
        created_at: Date.now(),
        token_count: 5,
      })

      const result = await search.search({
        mode: 'graph',
        tags: ['test_topic'],
        limit: 10,
      })

      expect(result.entries.length).toBe(2)
      expect(result.mode).toBe('graph')
    })
  })

  describe('fulltext search', () => {
    test('finds memories by keyword', async () => {
      await store.createNode('memory', {
        content: 'Iran sanctions impact on oil markets',
        created_at: Date.now(),
        token_count: 7,
      })
      await store.createNode('memory', {
        content: 'Weather forecast for tomorrow',
        created_at: Date.now(),
        token_count: 5,
      })

      const result = await search.search({
        text: 'Iran sanctions',
        mode: 'fulltext',
        limit: 10,
      })

      expect(result.entries.length).toBeGreaterThanOrEqual(1)
      expect(result.entries[0].content).toContain('Iran')
    })
  })

  describe('token budget', () => {
    test('limits results by token budget', async () => {
      for (let i = 0; i < 10; i++) {
        await store.createNode('memory', {
          content: `Memory number ${i} with some content`,
          created_at: Date.now(),
          token_count: 100,
        })
      }

      const result = await search.search({
        mode: 'graph',
        limit: 10,
        tokenBudget: 350,
      })

      expect(result.entries.length).toBeLessThanOrEqual(3)
      expect(result.totalTokens).toBeLessThanOrEqual(350)
    })
  })

  describe('flow ownership filter', () => {
    test('filters by flow ownership', async () => {
      await store.createNodeWithId('flow:conflict', { name: 'Conflict' })
      await store.createNodeWithId('flow:financial', { name: 'Financial' })

      const m1 = await store.createNode('memory', {
        content: 'conflict memory',
        created_at: Date.now(),
        token_count: 3,
      })
      const m2 = await store.createNode('memory', {
        content: 'financial memory',
        created_at: Date.now(),
        token_count: 3,
      })

      await store.relate(m1, 'owned_by', 'flow:conflict', { attributes: {}, owned_at: Date.now() })
      await store.relate(m2, 'owned_by', 'flow:financial', { attributes: {}, owned_at: Date.now() })

      const result = await search.search({
        mode: 'graph',
        flowIds: ['conflict'],
        limit: 10,
      })

      expect(result.entries.length).toBe(1)
      expect(result.entries[0].content).toBe('conflict memory')
    })
  })
})

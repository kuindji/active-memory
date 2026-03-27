import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { SchemaRegistry } from '../src/core/schema-registry.ts'
import { createTestDb } from './helpers.ts'
import type { Surreal } from 'surrealdb'
import type { SharedSchema, FlowSchema } from '../src/core/types.ts'

describe('SchemaRegistry', () => {
  let db: Surreal
  let registry: SchemaRegistry

  beforeEach(async () => {
    db = await createTestDb()
    registry = new SchemaRegistry(db)
  })

  afterEach(async () => {
    await db.close()
  })

  describe('core schema', () => {
    test('registerCore creates memory, tag, flow, meta tables', async () => {
      await registry.registerCore()
      const ts = Date.now()
      await db.query('CREATE memory SET content = "test", created_at = $ts, token_count = 0', { ts })
      await db.query('CREATE tag SET label = "test", created_at = $ts', { ts })
      const [memories] = await db.query<[{ count: number }[]]>('SELECT count() FROM memory GROUP ALL')
      expect(memories[0].count).toBe(1)
    })

    test('registerCore is idempotent', async () => {
      await registry.registerCore()
      await registry.registerCore()
      // Should not throw
    })

    test('registerCore creates core edge tables', async () => {
      await registry.registerCore()
      const ts = Date.now()
      await db.query('CREATE memory:a SET content = "a", created_at = $ts, token_count = 0', { ts })
      await db.query('CREATE memory:b SET content = "b", created_at = $ts, token_count = 0', { ts })
      await db.query('RELATE memory:a->reinforces->memory:b SET strength = 0.9')
      const [edges] = await db.query<[{ count: number }[]]>('SELECT count() FROM reinforces GROUP ALL')
      expect(edges[0].count).toBe(1)
    })
  })

  describe('shared schema', () => {
    test('registerShared creates node and edge tables', async () => {
      await registry.registerCore()
      const schema: SharedSchema = {
        nodes: [
          { name: 'person', fields: [{ name: 'name', type: 'string' }] }
        ],
        edges: [
          { name: 'knows', from: 'person', to: 'person', fields: [] }
        ]
      }
      await registry.registerShared(schema)
      await db.query('CREATE person SET name = "Alice"')
      const [persons] = await db.query<[{ count: number }[]]>('SELECT count() FROM person GROUP ALL')
      expect(persons[0].count).toBe(1)
    })

    test('registerShared creates edge with fields', async () => {
      await registry.registerCore()
      const schema: SharedSchema = {
        nodes: [
          { name: 'person', fields: [{ name: 'name', type: 'string' }] }
        ],
        edges: [
          { name: 'knows', from: 'person', to: 'person', fields: [{ name: 'since', type: 'int' }] }
        ]
      }
      await registry.registerShared(schema)
      await db.query('CREATE person:a SET name = "Alice"')
      await db.query('CREATE person:b SET name = "Bob"')
      await db.query('RELATE person:a->knows->person:b SET since = 2025')
      const [edges] = await db.query<[{ since: number }[]]>('SELECT since FROM knows')
      expect(edges[0].since).toBe(2025)
    })
  })

  describe('flow schema', () => {
    test('registerFlow creates flow-specific tables', async () => {
      await registry.registerCore()
      const schema: FlowSchema = {
        nodes: [
          { name: 'market', fields: [{ name: 'name', type: 'string' }, { name: 'type', type: 'string' }] }
        ],
        edges: [
          { name: 'affects', from: 'memory', to: 'market', fields: [{ name: 'magnitude', type: 'float' }] }
        ]
      }
      await registry.registerFlow('financial', schema)
      await db.query('CREATE market SET name = "oil", type = "commodity"')
      const [markets] = await db.query<[{ count: number }[]]>('SELECT count() FROM market GROUP ALL')
      expect(markets[0].count).toBe(1)
    })

    test('registerFlow extends existing node with new fields', async () => {
      await registry.registerCore()
      const shared: SharedSchema = {
        nodes: [{ name: 'person', fields: [{ name: 'name', type: 'string' }] }],
        edges: []
      }
      await registry.registerShared(shared)
      const flowSchema: FlowSchema = {
        nodes: [{ name: 'person', fields: [
          { name: 'name', type: 'string' },
          { name: 'bio', type: 'string', required: false }
        ] }],
        edges: []
      }
      await registry.registerFlow('persona', flowSchema)
      await db.query('CREATE person SET name = "Alice", bio = "A person"')
      const [persons] = await db.query<[{ name: string; bio: string }[]]>('SELECT name, bio FROM person')
      expect(persons[0].bio).toBe('A person')
    })

    test('registerFlow throws on field type conflict', async () => {
      await registry.registerCore()
      const shared: SharedSchema = {
        nodes: [{ name: 'person', fields: [{ name: 'name', type: 'string' }] }],
        edges: []
      }
      await registry.registerShared(shared)
      const flowSchema: FlowSchema = {
        nodes: [{ name: 'person', fields: [{ name: 'name', type: 'int' }] }],
        edges: []
      }
      expect(registry.registerFlow('bad_flow', flowSchema)).rejects.toThrow()
    })

    test('getRegisteredNode returns tracked node info', async () => {
      await registry.registerCore()
      const node = registry.getRegisteredNode('memory')
      expect(node).toBeDefined()
      expect(node!.name).toBe('memory')
      expect(node!.contributors).toEqual(['core'])
      expect(node!.fields.some(f => f.name === 'content')).toBe(true)
    })

    test('getRegisteredNode returns undefined for unknown', () => {
      expect(registry.getRegisteredNode('unknown')).toBeUndefined()
    })
  })
})

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { MemoryEngine } from '../src/core/engine.ts'
import { MockLLMAdapter } from './helpers.ts'
import type { DomainConfig, OwnedMemory, DomainContext } from '../src/core/types.ts'

describe('Domain visibility', () => {
  let engine: MemoryEngine

  const domainA: DomainConfig = {
    id: 'domaina',
    name: 'Domain A',
    settings: { includeDomains: ['domainb'] },
    async processInboxItem(_entry: OwnedMemory, _ctx: DomainContext) {},
  }

  const domainB: DomainConfig = {
    id: 'domainb',
    name: 'Domain B',
    async processInboxItem(_entry: OwnedMemory, _ctx: DomainContext) {},
  }

  const domainC: DomainConfig = {
    id: 'domainc',
    name: 'Domain C',
    settings: { excludeDomains: ['domaina'] },
    async processInboxItem(_entry: OwnedMemory, _ctx: DomainContext) {},
  }

  const domainD: DomainConfig = {
    id: 'domaind',
    name: 'Domain D',
    async processInboxItem(_entry: OwnedMemory, _ctx: DomainContext) {},
  }

  beforeEach(async () => {
    engine = new MemoryEngine()
    await engine.initialize({
      connection: 'mem://',
      namespace: 'test',
      database: `test_${Date.now()}`,
      llm: new MockLLMAdapter(),
    })
    await engine.registerDomain(domainA)
    await engine.registerDomain(domainB)
    await engine.registerDomain(domainC)
    await engine.registerDomain(domainD)

    // Ingest data owned by each domain
    await engine.ingest('content from A', { domains: ['domaina'] })
    await engine.ingest('content from B', { domains: ['domainb'] })
    await engine.ingest('content from C', { domains: ['domainc'] })
    await engine.ingest('content from D', { domains: ['domaind'] })
  })

  afterEach(async () => {
    await engine.close()
  })

  test('getVisibleDomains with includeDomains returns only listed domains plus self', () => {
    const ctx = engine.createDomainContext('domaina')
    const visible = ctx.getVisibleDomains()
    expect(visible.sort()).toEqual(['domaina', 'domainb'])
  })

  test('getVisibleDomains with excludeDomains returns all except excluded plus self', () => {
    const ctx = engine.createDomainContext('domainc')
    const visible = ctx.getVisibleDomains()
    expect(visible).toContain('domainc')
    expect(visible).toContain('domainb')
    expect(visible).toContain('domaind')
    expect(visible).not.toContain('domaina')
  })

  test('getVisibleDomains with no settings returns all domains', () => {
    const ctx = engine.createDomainContext('domainb')
    const visible = ctx.getVisibleDomains()
    expect(visible).toContain('domaina')
    expect(visible).toContain('domainb')
    expect(visible).toContain('domainc')
    expect(visible).toContain('domaind')
  })

  test('search from domain with includeDomains only finds visible data', async () => {
    // domaina can only see domainb (and itself)
    const ctx = engine.createDomainContext('domaina')
    const result = await ctx.search({ mode: 'fulltext', text: 'content' })
    const contents = result.entries.map(e => e.content)
    expect(contents).toContain('content from A')
    expect(contents).toContain('content from B')
    expect(contents).not.toContain('content from C')
    expect(contents).not.toContain('content from D')
  })

  test('search from domain with excludeDomains hides excluded data', async () => {
    // domainc excludes domaina
    const ctx = engine.createDomainContext('domainc')
    const result = await ctx.search({ mode: 'fulltext', text: 'content' })
    const contents = result.entries.map(e => e.content)
    expect(contents).toContain('content from C')
    expect(contents).toContain('content from B')
    expect(contents).toContain('content from D')
    expect(contents).not.toContain('content from A')
  })

  test('search from domain with no settings sees all data', async () => {
    const ctx = engine.createDomainContext('domaind')
    const result = await ctx.search({ mode: 'fulltext', text: 'content' })
    expect(result.entries.length).toBeGreaterThanOrEqual(4)
  })

  test('getMemories from domain with includeDomains respects visibility', async () => {
    const ctx = engine.createDomainContext('domaina')
    const memories = await ctx.getMemories()
    const contents = memories.map(m => m.content)
    expect(contents).toContain('content from A')
    expect(contents).toContain('content from B')
    expect(contents).not.toContain('content from C')
    expect(contents).not.toContain('content from D')
  })

  test('domain settings stored in DB node', async () => {
    const graph = engine.getGraph()
    const node = await graph.getNode('domain:domaina')
    expect(node).toBeDefined()
    const settings = node!.settings as Record<string, unknown>
    expect(settings).toBeDefined()
    expect(settings.includeDomains).toEqual(['domainb'])
  })
})

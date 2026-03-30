import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { MemoryEngine } from '../src/core/engine.ts'
import { MockLLMAdapter } from './helpers.ts'
import type { DomainConfig, OwnedMemory, DomainContext } from '../src/core/types.ts'

describe('Domain skills and structure', () => {
  let engine: MemoryEngine

  const testDomain: DomainConfig = {
    id: 'test-domain',
    name: 'Test Domain',
    structure: `# Test Domain Structure

## Tags
- \`test/category\` - Categorization tag
- \`test/priority\` - Priority level

## Attributes
- \`kind\`: string - The type of test entry (unit, integration, e2e)
- \`severity\`: string - How critical (low, medium, high)
`,
    skills: [
      {
        id: 'consumption',
        name: 'How to use Test Domain data',
        description: 'Tells external agents how to query and interpret test domain data',
        scope: 'external',
        content: 'When querying the test domain, use tags test/category to filter by type.',
      },
      {
        id: 'ingestion',
        name: 'How to create Test Domain data',
        description: 'Tells external agents how to create data for this domain',
        scope: 'external',
        content: 'Create entries with kind attribute set to unit, integration, or e2e.',
      },
      {
        id: 'analyze',
        name: 'Internal analysis',
        description: 'Used by domain agent to analyze test results',
        scope: 'internal',
        content: 'Analyze test results by grouping by kind and severity.',
      },
      {
        id: 'summarize',
        name: 'Summarize test results',
        description: 'Can be used internally or by other agents',
        scope: 'both',
        content: 'Summarize test results across all categories.',
      },
    ],
    async processInboxItem(_entry: OwnedMemory, _context: DomainContext) {
      // no-op
    },
  }

  const minimalDomain: DomainConfig = {
    id: 'minimal',
    name: 'Minimal Domain',
    async processInboxItem(_entry: OwnedMemory, _context: DomainContext) {
      // no-op
    },
  }

  beforeEach(async () => {
    engine = new MemoryEngine()
    await engine.initialize({
      connection: 'mem://',
      namespace: 'test',
      database: `test_${Date.now()}`,
      llm: new MockLLMAdapter(),
    })
    await engine.registerDomain(testDomain)
    await engine.registerDomain(minimalDomain)
  })

  afterEach(async () => {
    await engine.close()
  })

  test('getDomainRegistry exposes domain structure', () => {
    const registry = engine.getDomainRegistry()
    const domain = registry.get('test-domain')
    expect(domain?.structure).toContain('## Tags')
    expect(domain?.structure).toContain('test/category')
  })

  test('domain without structure returns undefined', () => {
    const registry = engine.getDomainRegistry()
    const domain = registry.get('minimal')
    expect(domain?.structure).toBeUndefined()
  })

  test('getExternalSkills returns only external and both-scoped skills', () => {
    const registry = engine.getDomainRegistry()
    const skills = registry.getExternalSkills('test-domain')
    expect(skills.length).toBe(3)
    expect(skills.map(s => s.id).sort()).toEqual(['consumption', 'ingestion', 'summarize'])
  })

  test('getInternalSkills returns only internal and both-scoped skills', () => {
    const registry = engine.getDomainRegistry()
    const skills = registry.getInternalSkills('test-domain')
    expect(skills.length).toBe(2)
    expect(skills.map(s => s.id).sort()).toEqual(['analyze', 'summarize'])
  })

  test('getSkill returns specific skill by id', () => {
    const registry = engine.getDomainRegistry()
    const skill = registry.getSkill('test-domain', 'consumption')
    expect(skill).toBeDefined()
    expect(skill!.name).toBe('How to use Test Domain data')
    expect(skill!.scope).toBe('external')
  })

  test('getSkill returns undefined for nonexistent skill', () => {
    const registry = engine.getDomainRegistry()
    const skill = registry.getSkill('test-domain', 'nonexistent')
    expect(skill).toBeUndefined()
  })

  test('domain without skills returns empty arrays', () => {
    const registry = engine.getDomainRegistry()
    expect(registry.getExternalSkills('minimal')).toEqual([])
    expect(registry.getInternalSkills('minimal')).toEqual([])
  })

  test('listDomainSummaries returns id, name, and description for all domains', () => {
    const registry = engine.getDomainRegistry()
    const summaries = registry.listSummaries()
    const testSummary = summaries.find(s => s.id === 'test-domain')
    expect(testSummary).toBeDefined()
    expect(testSummary!.name).toBe('Test Domain')
    expect(testSummary!.hasStructure).toBe(true)
    expect(testSummary!.skillCount).toBe(4)

    const minimalSummary = summaries.find(s => s.id === 'minimal')
    expect(minimalSummary).toBeDefined()
    expect(minimalSummary!.hasStructure).toBe(false)
    expect(minimalSummary!.skillCount).toBe(0)
  })
})

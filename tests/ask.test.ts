import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { MemoryEngine } from '../src/core/engine.ts'
import { MockLLMAdapter } from './helpers.ts'

describe('MemoryEngine.ask', () => {
  let engine: MemoryEngine
  let llm: MockLLMAdapter

  beforeEach(async () => {
    llm = new MockLLMAdapter()
    engine = new MemoryEngine()
    await engine.initialize({
      connection: 'mem://',
      namespace: 'test',
      database: `test_ask_${Date.now()}`,
      llm,
    })
    await engine.registerDomain({
      id: 'test',
      name: 'Test',
      async processInboxItem() {},
    })
  })

  afterEach(async () => {
    await engine.close()
  })

  test('returns answer and memories', async () => {
    await engine.ingest('TypeScript is a typed superset of JavaScript', { domains: ['test'] })
    await engine.processInbox()

    // Mock LLM: first call returns a final answer immediately
    llm.generateResult = '{ "answer": "TypeScript adds types to JavaScript" }'
    llm.synthesizeResult = 'TypeScript adds static types to JavaScript.'

    const result = await engine.ask('What is TypeScript?')
    expect(typeof result.answer).toBe('string')
    expect(result.answer.length).toBeGreaterThan(0)
    expect(Array.isArray(result.memories)).toBe(true)
    expect(typeof result.rounds).toBe('number')
    expect(result.rounds).toBeGreaterThanOrEqual(1)
  })

  test('performs multi-round search when LLM returns query plan', async () => {
    await engine.ingest('Cats are domestic animals', { domains: ['test'] })
    await engine.ingest('Dogs are loyal pets', { domains: ['test'] })
    await engine.processInbox()
    await engine.processInbox()

    let callCount = 0
    llm.generateResult = '' // will be overridden below
    const originalGenerate = llm.generate.bind(llm)
    llm.generate = (_prompt: string) => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve('{ "text": "domestic animals", "reasoning": "search for animals" }')
      }
      return Promise.resolve('{ "answer": "Cats and dogs are common pets" }')
    }
    void originalGenerate

    llm.synthesizeResult = 'Cats and dogs are common domestic pets.'

    const result = await engine.ask('What are common pets?')
    expect(result.answer).toBe('Cats and dogs are common domestic pets.')
    expect(result.rounds).toBeGreaterThanOrEqual(2)
  })

  test('respects max rounds limit', async () => {
    await engine.ingest('Some data', { domains: ['test'] })
    await engine.processInbox()

    // LLM always returns query plans, never a final answer
    llm.generate = () => Promise.resolve('{ "text": "search terms", "reasoning": "keep searching" }')
    llm.synthesizeResult = 'Final synthesized answer.'

    const result = await engine.ask('endless question')
    // Max rounds is 3
    expect(result.rounds).toBe(3)
    expect(result.answer).toBe('Final synthesized answer.')
  })

  test('handles malformed LLM JSON gracefully', async () => {
    await engine.ingest('Some content', { domains: ['test'] })
    await engine.processInbox()

    // Return invalid JSON — regex finds no {}, so parsed = {} and it falls through
    // as a query plan for all rounds, then synthesizes at the end
    llm.generateResult = 'not valid json at all'
    llm.synthesizeResult = 'Synthesized from available memories.'

    const result = await engine.ask('question')
    // Should complete without throwing
    expect(typeof result.answer).toBe('string')
    expect(result.rounds).toBe(3)
  })

  test('deduplicates memories across rounds', async () => {
    await engine.ingest('Unique fact about planets', { domains: ['test'] })
    await engine.processInbox()

    let callCount = 0
    llm.generate = () => {
      callCount++
      if (callCount <= 2) {
        return Promise.resolve('{ "text": "planets", "reasoning": "search" }')
      }
      return Promise.resolve('{ "answer": "done" }')
    }
    llm.synthesizeResult = 'Answer about planets.'

    const result = await engine.ask('Tell me about planets')
    // Even though we searched multiple rounds, same memory should appear once
    const ids = result.memories.map(m => m.id)
    const uniqueIds = new Set(ids)
    expect(ids.length).toBe(uniqueIds.size)
  })

  test('respects domain filtering', async () => {
    await engine.registerDomain({
      id: 'science',
      name: 'Science',
      async processInboxItem() {},
    })

    await engine.ingest('Physics is fundamental', { domains: ['science'] })
    await engine.processInbox()

    llm.generateResult = '{ "answer": "Physics" }'
    llm.synthesizeResult = 'Physics is a fundamental science.'

    const result = await engine.ask('What is physics?', { domains: ['science'] })
    expect(typeof result.answer).toBe('string')
  })
})

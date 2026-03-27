import { Surreal } from 'surrealdb'
import { createNodeEngines } from '@surrealdb/node'
import type { LLMAdapter, ScoredMemory } from '../src/core/types.ts'

let dbCounter = 0

export async function createTestDb(): Promise<Surreal> {
  const db = new Surreal({ engines: createNodeEngines() })
  await db.connect('mem://')
  await db.use({ namespace: 'test', database: `test_${++dbCounter}_${Date.now()}` })
  return db
}

export class MockLLMAdapter implements LLMAdapter {
  extractResult: string[] = []
  consolidateResult = ''
  generateResult = ''
  synthesizeResult = ''

  async extract(): Promise<string[]> {
    return this.extractResult
  }
  async consolidate(): Promise<string> {
    return this.consolidateResult
  }
  async generate(): Promise<string> {
    return this.generateResult
  }
  async synthesize(
    _query: string,
    _memories: ScoredMemory[],
    _tagContext?: string[]
  ): Promise<string> {
    return this.synthesizeResult
  }
}

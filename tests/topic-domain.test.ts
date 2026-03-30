import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { MemoryEngine } from '../src/core/engine.ts'
import { MockLLMAdapter, MockEmbeddingAdapter } from './helpers.ts'
import { mergeSimilarTopics } from '../src/domains/topic/schedules.ts'
import { TOPIC_TAG, TOPIC_DOMAIN_ID } from '../src/domains/topic/types.ts'
import type { DomainConfig, OwnedMemory, DomainContext } from '../src/core/types.ts'

const testTopicDomain: DomainConfig = {
  id: 'topic',
  name: 'Topic',
  schema: {
    nodes: [],
    edges: [
      { name: 'subtopic_of', from: 'memory', to: 'memory' },
      { name: 'related_to', from: 'memory', to: 'memory', fields: [{ name: 'strength', type: 'float' }] },
      { name: 'about_topic', from: 'memory', to: 'memory', fields: [{ name: 'domain', type: 'string' }] },
    ],
  },
  async processInboxItem(_entry: OwnedMemory, _context: DomainContext) {},
}

describe('Topic domain - merge schedule', () => {
  let engine: MemoryEngine

  beforeEach(async () => {
    engine = new MemoryEngine()
    await engine.initialize({
      connection: 'mem://',
      namespace: 'test',
      database: `test_${Date.now()}`,
      llm: new MockLLMAdapter(),
      embedding: new MockEmbeddingAdapter(),
    })
    await engine.registerDomain(testTopicDomain)
  })

  afterEach(async () => {
    await engine.close()
  })

  test('merge-similar marks duplicate topic as merged', async () => {
    const context = engine.createDomainContext(TOPIC_DOMAIN_ID)

    const topicAId = await context.writeMemory({
      content: 'TypeScript programming language',
      tags: [TOPIC_TAG],
      ownership: {
        domain: TOPIC_DOMAIN_ID,
        attributes: {
          name: 'TypeScript',
          status: 'active',
          mentionCount: 3,
          lastMentionedAt: Date.now(),
          createdBy: 'test',
        },
      },
    })

    const topicBId = await context.writeMemory({
      content: 'TypeScript programming language',
      tags: [TOPIC_TAG],
      ownership: {
        domain: TOPIC_DOMAIN_ID,
        attributes: {
          name: 'TypeScript duplicate',
          status: 'active',
          mentionCount: 1,
          lastMentionedAt: Date.now(),
          createdBy: 'test',
        },
      },
    })

    await mergeSimilarTopics(context)

    // Search for the merged topic to check its attributes
    const searchResult = await context.search({ text: 'TypeScript programming language', tags: [TOPIC_TAG] })
    const entries = searchResult.entries

    const topicA = entries.find(e => e.id === topicAId)
    const topicB = entries.find(e => e.id === topicBId)

    expect(topicA).toBeDefined()
    expect(topicB).toBeDefined()

    const topicAAttrs = topicA!.domainAttributes[TOPIC_DOMAIN_ID]
    const topicBAttrs = topicB!.domainAttributes[TOPIC_DOMAIN_ID]

    // topicA has higher mentionCount, should remain active
    expect(topicAAttrs.status).toBe('active')

    // topicB has lower mentionCount, should be merged
    expect(topicBAttrs.status).toBe('merged')
    expect(topicBAttrs.mergedInto).toBe(topicAId)
  })

  test('merge-similar preserves higher-mentionCount topic as canonical', async () => {
    const context = engine.createDomainContext(TOPIC_DOMAIN_ID)

    const topicAId = await context.writeMemory({
      content: 'React framework for building UIs',
      tags: [TOPIC_TAG],
      ownership: {
        domain: TOPIC_DOMAIN_ID,
        attributes: {
          name: 'React',
          status: 'active',
          mentionCount: 5,
          lastMentionedAt: Date.now(),
          createdBy: 'test',
        },
      },
    })

    const topicBId = await context.writeMemory({
      content: 'React framework for building UIs',
      tags: [TOPIC_TAG],
      ownership: {
        domain: TOPIC_DOMAIN_ID,
        attributes: {
          name: 'React duplicate',
          status: 'active',
          mentionCount: 2,
          lastMentionedAt: Date.now(),
          createdBy: 'test',
        },
      },
    })

    await mergeSimilarTopics(context)

    const searchResult = await context.search({ text: 'React framework for building UIs', tags: [TOPIC_TAG] })
    const entries = searchResult.entries

    const topicA = entries.find(e => e.id === topicAId)
    const topicB = entries.find(e => e.id === topicBId)

    expect(topicA).toBeDefined()
    expect(topicB).toBeDefined()

    const topicAAttrs = topicA!.domainAttributes[TOPIC_DOMAIN_ID]
    const topicBAttrs = topicB!.domainAttributes[TOPIC_DOMAIN_ID]

    // topicA (mentionCount=5) remains active
    expect(topicAAttrs.status).toBe('active')
    // canonical gets merged topic's mentionCount added
    expect(topicAAttrs.mentionCount).toBe(7)

    // topicB (mentionCount=2) is merged into topicA
    expect(topicBAttrs.status).toBe('merged')
    expect(topicBAttrs.mergedInto).toBe(topicAId)
  })

  test('merge-similar skips topics below similarity threshold', async () => {
    const context = engine.createDomainContext(TOPIC_DOMAIN_ID)

    await context.writeMemory({
      content: 'quantum mechanics wave function collapse observation',
      tags: [TOPIC_TAG],
      ownership: {
        domain: TOPIC_DOMAIN_ID,
        attributes: {
          name: 'Quantum Mechanics',
          status: 'active',
          mentionCount: 3,
          lastMentionedAt: Date.now(),
          createdBy: 'test',
        },
      },
    })

    await context.writeMemory({
      content: 'medieval castle architecture buttress flying gothic cathedral',
      tags: [TOPIC_TAG],
      ownership: {
        domain: TOPIC_DOMAIN_ID,
        attributes: {
          name: 'Medieval Architecture',
          status: 'active',
          mentionCount: 2,
          lastMentionedAt: Date.now(),
          createdBy: 'test',
        },
      },
    })

    await mergeSimilarTopics(context)

    const searchResult = await context.search({ text: 'quantum mechanics medieval architecture' })
    const entries = searchResult.entries

    // Both should remain active since they are dissimilar
    for (const entry of entries) {
      const attrs = entry.domainAttributes[TOPIC_DOMAIN_ID]
      expect(attrs.status).toBe('active')
      expect(attrs.mergedInto).toBeUndefined()
    }
  })
})

import type { OwnedMemory, DomainContext } from '../../core/types.ts'
import { CHAT_TAG, CHAT_MESSAGE_TAG } from './types.ts'
import { TOPIC_TAG, TOPIC_DOMAIN_ID } from '../topic/types.ts'
import { ensureTag } from './utils.ts'

const BATCH_TOPIC_EXTRACTION_SCHEMA = JSON.stringify({
  type: 'array',
  items: {
    type: 'object',
    properties: {
      index: { type: 'number', description: 'Zero-based index of the message' },
      topics: {
        type: 'array',
        items: { type: 'string' },
        description: 'Topic names extracted from this message',
      },
    },
    required: ['index', 'topics'],
  },
})

const BATCH_TOPIC_EXTRACTION_PROMPT =
  'Extract key topics from each numbered message below. ' +
  'Return topics as short noun phrases (1-4 words). ' +
  'Only extract meaningful, specific topics — not generic words.'

export async function processInboxBatch(entries: OwnedMemory[], context: DomainContext): Promise<void> {
  const userId = context.requestContext.userId as string | undefined
  const chatSessionId = context.requestContext.chatSessionId as string | undefined

  if (!userId || !chatSessionId) return

  // Phase 1: Per-item metadata and tagging (no LLM)
  const chatTagId = await ensureTag(context, CHAT_TAG)
  const chatMessageTagId = await ensureTag(context, CHAT_MESSAGE_TAG)
  try {
    await context.graph.relate(chatMessageTagId, 'child_of', chatTagId)
  } catch { /* already related */ }

  const existing = await context.getMemories({
    tags: [CHAT_MESSAGE_TAG],
    attributes: { chatSessionId, userId },
  })
  let messageIndex = existing.length

  for (const entry of entries) {
    const role = (entry.domainAttributes.role as string | undefined) ?? 'user'

    await context.updateAttributes(entry.memory.id, {
      role,
      layer: 'working',
      chatSessionId,
      userId,
      messageIndex,
    })
    messageIndex++

    await context.tagMemory(entry.memory.id, chatTagId)
    await context.tagMemory(entry.memory.id, chatMessageTagId)
  }

  // Phase 2: Batch topic extraction (single LLM call)
  const topicsMap = await batchExtractTopics(entries, context)

  // Phase 3: Per-item topic linking
  for (const entry of entries) {
    const topicNames = topicsMap.get(entry.memory.id) ?? []
    for (const topicName of topicNames) {
      await linkTopic(context, entry.memory.id, topicName)
    }
  }
}

async function batchExtractTopics(
  entries: OwnedMemory[],
  context: DomainContext,
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>()
  const llm = context.llmAt('low')

  // Build numbered content list
  const numberedItems = entries
    .map((e, i) => `${i}. ${e.memory.content}`)
    .join('\n\n')

  if (llm.extractStructured) {
    try {
      const raw = await llm.extractStructured(
        numberedItems,
        BATCH_TOPIC_EXTRACTION_SCHEMA,
        BATCH_TOPIC_EXTRACTION_PROMPT,
      ) as Array<{ index: number; topics: string[] }>

      for (const item of raw) {
        if (item.index >= 0 && item.index < entries.length && Array.isArray(item.topics)) {
          result.set(entries[item.index].memory.id, item.topics)
        }
      }
      return result
    } catch {
      // Fall through to sequential fallback
    }
  }

  // Fallback: sequential extract calls
  for (const entry of entries) {
    try {
      const topics = await llm.extract(entry.memory.content)
      result.set(entry.memory.id, topics)
    } catch {
      result.set(entry.memory.id, [])
    }
  }

  return result
}

async function linkTopic(
  context: DomainContext,
  memoryId: string,
  topicName: string,
): Promise<void> {
  const searchResult = await context.search({
    text: topicName,
    tags: [TOPIC_TAG],
    minScore: 0.8,
  })

  let topicId: string

  if (searchResult.entries.length > 0) {
    topicId = searchResult.entries[0].id
    const topicAttrs = searchResult.entries[0].domainAttributes[TOPIC_DOMAIN_ID] as
      Record<string, unknown> | undefined
    const currentCount = (topicAttrs?.mentionCount as number | undefined) ?? 0

    await context.updateAttributes(topicId, {
      ...topicAttrs,
      mentionCount: currentCount + 1,
      lastMentionedAt: Date.now(),
    })
  } else {
    topicId = await context.writeMemory({
      content: topicName,
      tags: [TOPIC_TAG],
      ownership: {
        domain: TOPIC_DOMAIN_ID,
        attributes: {
          name: topicName,
          status: 'active',
          mentionCount: 1,
          lastMentionedAt: Date.now(),
          createdBy: context.domain,
        },
      },
    })
  }

  await context.graph.relate(memoryId, 'about_topic', topicId, { domain: context.domain })
}

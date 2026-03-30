import { StringRecordId } from 'surrealdb'
import type { DomainContext } from '../../core/types.ts'
import { TOPIC_TAG, TOPIC_DOMAIN_ID, MERGE_SIMILARITY_THRESHOLD } from './types.ts'

export async function mergeSimilarTopics(context: DomainContext): Promise<void> {
  const activeTopics = await context.getMemories({
    tags: [TOPIC_TAG],
    attributes: { status: 'active' },
  })

  const mergedInThisRun = new Set<string>()

  for (const topic of activeTopics) {
    if (mergedInThisRun.has(topic.id)) continue

    const searchResult = await context.search({
      text: topic.content,
      mode: 'vector',
      minScore: MERGE_SIMILARITY_THRESHOLD,
    })

    const similarEntries = searchResult.entries.filter(entry => {
      if (entry.id === topic.id) return false
      if (mergedInThisRun.has(entry.id)) return false
      const attrs = entry.domainAttributes[TOPIC_DOMAIN_ID]
      return attrs?.status === 'active'
    })

    for (const similar of similarEntries) {
      // Get fresh attributes for the current topic via search
      const topicAttrs = await getTopicAttributesFromGraph(context, topic.id)
      const similarAttrs = similar.domainAttributes[TOPIC_DOMAIN_ID]

      if (!topicAttrs || !similarAttrs) continue

      const topicMentionCount = (topicAttrs.mentionCount as number) ?? 0
      const similarMentionCount = (similarAttrs.mentionCount as number) ?? 0

      let canonicalId: string
      let mergedId: string
      let canonicalAttrs: Record<string, unknown>
      let mergedMentionCount: number

      if (topicMentionCount > similarMentionCount) {
        canonicalId = topic.id
        mergedId = similar.id
        canonicalAttrs = topicAttrs
        mergedMentionCount = similarMentionCount
      } else if (similarMentionCount > topicMentionCount) {
        canonicalId = similar.id
        mergedId = topic.id
        canonicalAttrs = similarAttrs
        mergedMentionCount = topicMentionCount
      } else {
        // Equal mentionCount: prefer older createdAt
        if (topic.createdAt <= similar.createdAt) {
          canonicalId = topic.id
          mergedId = similar.id
          canonicalAttrs = topicAttrs
          mergedMentionCount = similarMentionCount
        } else {
          canonicalId = similar.id
          mergedId = topic.id
          canonicalAttrs = similarAttrs
          mergedMentionCount = topicMentionCount
        }
      }

      // Mark the non-canonical as merged
      const mergedTopicAttrs = mergedId === topic.id ? topicAttrs : similarAttrs
      await context.updateAttributes(mergedId, {
        ...mergedTopicAttrs,
        status: 'merged',
        mergedInto: canonicalId,
      })

      // Create related_to edge
      await context.graph.relate(mergedId, 'related_to', canonicalId, {
        strength: similar.score,
      })

      // Update canonical's mentionCount
      const canonicalMentionCount = (canonicalAttrs.mentionCount as number) ?? 0
      await context.updateAttributes(canonicalId, {
        ...canonicalAttrs,
        mentionCount: canonicalMentionCount + mergedMentionCount,
      })

      mergedInThisRun.add(mergedId)

      // If current topic got merged, stop processing it
      if (mergedId === topic.id) break
    }
  }
}

async function getTopicAttributesFromGraph(
  context: DomainContext,
  memoryId: string
): Promise<Record<string, unknown> | null> {
  const memRef = new StringRecordId(memoryId.startsWith('memory:') ? memoryId : `memory:${memoryId}`)
  const domainRef = new StringRecordId(`domain:${TOPIC_DOMAIN_ID}`)
  const rows = await context.graph.query<{ attributes: Record<string, unknown> }[]>(
    'SELECT attributes FROM owned_by WHERE in = $memId AND out = $domainId',
    { memId: memRef, domainId: domainRef }
  )
  if (!rows || rows.length === 0) return null
  return rows[0].attributes ?? null
}

import type { DomainSkill } from '../../core/types.ts'
import { TOPIC_DOMAIN_ID, TOPIC_TAG, MERGE_SIMILARITY_THRESHOLD } from './types.ts'

const topicManagement: DomainSkill = {
  id: 'topic-management',
  name: 'How to create and manage topics',
  description: 'Tells external agents how to create topics, link memories to topics, set parent topics, and track mention counts',
  scope: 'external',
  content: `# Topic Management

Topics are memory entries owned by the \`${TOPIC_DOMAIN_ID}\` domain with the \`${TOPIC_TAG}\` tag.

## Creating a Topic

Before creating a topic, check for existing similar topics:

\`\`\`ts
const existing = await context.search({
  text: topicName,
  tags: ['${TOPIC_TAG}'],
  minScore: 0.8,
})
\`\`\`

If no sufficiently similar topic exists, create one:

\`\`\`ts
const topicId = await context.writeMemory({
  content: topicDescription, // human-readable description of the topic
  tags: ['${TOPIC_TAG}'],
  ownership: {
    domain: '${TOPIC_DOMAIN_ID}',
    attributes: {
      name: topicName,        // string — canonical label for the topic
      status: 'active',       // TopicStatus: 'active' | 'stale' | 'merged'
      mentionCount: 0,        // number — how many times this topic has been referenced
      lastMentionedAt: Date.now(), // number — unix timestamp
      createdBy: context.domain,  // string — domain ID that created this topic
    },
  },
})
\`\`\`

## Linking a Memory to a Topic

Use a graph edge to associate any memory with a topic:

\`\`\`ts
await context.graph.relate(memoryId, 'about_topic', topicId, {
  domain: context.domain, // the domain creating the relationship
})
\`\`\`

## Creating Topic Hierarchy

To mark a topic as a subtopic of a parent topic:

\`\`\`ts
await context.graph.relate(childTopicId, 'subtopic_of', parentTopicId)
\`\`\`

## Updating Mention Count

When a topic is referenced, increment its mention count:

\`\`\`ts
// Use search or getMemories to retrieve the current attributes before updating
const results = await context.search({ text: topicName, tags: ['${TOPIC_TAG}'], limit: 1 })
const topicEntry = results.entries[0]
const attrs = topicEntry?.domainAttributes?.['${TOPIC_DOMAIN_ID}'] ?? {}
const current = typeof attrs.mentionCount === 'number' ? attrs.mentionCount : 0

await context.updateAttributes(topicId, {
  mentionCount: current + 1,
  lastMentionedAt: Date.now(),
})
\`\`\`
`,
}

const topicQuery: DomainSkill = {
  id: 'topic-query',
  name: 'How to query topics',
  description: 'Tells external agents how to find topics, list active topics, and traverse topic relationships',
  scope: 'external',
  content: `# Topic Querying

## Finding Topics by Content

Use semantic or full-text search filtered by the \`${TOPIC_TAG}\` tag:

\`\`\`ts
const results = await context.search({
  text: queryText,
  tags: ['${TOPIC_TAG}'],
})
\`\`\`

## Listing Active Topics

Retrieve all active topics using a tag + attribute filter:

\`\`\`ts
const topics = await context.getMemories({
  tags: ['${TOPIC_TAG}'],
  attributes: { status: 'active' },
})
\`\`\`

To exclude merged or stale topics when using search results, filter the returned entries:

\`\`\`ts
const activeOnly = results.entries.filter(
  (e) => e.domainAttributes['${TOPIC_DOMAIN_ID}']?.status === 'active'
)
\`\`\`

## Finding Memories Linked to a Topic

Traverse the \`about_topic\` edge in reverse to get all memories linked to a given topic:

\`\`\`ts
// Pseudocode: traverse from topicId following incoming about_topic edges
const memories = await context.graph.traverse(topicId, '<-about_topic<-memory')
\`\`\`

## Finding Child Topics

Traverse the \`subtopic_of\` edge in reverse to get all subtopics of a parent:

\`\`\`ts
// Pseudocode: traverse from parentTopicId following incoming subtopic_of edges
const children = await context.graph.traverse(parentTopicId, '<-subtopic_of<-topic')
\`\`\`
`,
}

const topicProcessing: DomainSkill = {
  id: 'topic-processing',
  name: 'Internal topic merge detection',
  description: 'Internal skill for detecting and merging duplicate or near-duplicate topics',
  scope: 'internal',
  content: `# Topic Merge Detection (Internal)

This skill describes the merge detection logic run by the topic domain schedule.

## Finding Candidate Pairs

Search for active topics and identify pairs with high embedding similarity (threshold: ${MERGE_SIMILARITY_THRESHOLD}):

\`\`\`ts
const activeTopics = await context.getMemories({
  tags: ['${TOPIC_TAG}'],
  attributes: { status: 'active' },
})

// Compare embeddings pairwise; flag pairs where similarity > ${MERGE_SIMILARITY_THRESHOLD}
\`\`\`

## Selecting the Canonical Topic

For each candidate pair, the topic with the higher \`mentionCount\` is kept as the canonical topic. If counts are equal, prefer the older entry (lower \`createdAt\`).

## Merging Topics

1. Mark the non-canonical topic as merged:

\`\`\`ts
await context.updateAttributes(mergedTopicId, {
  status: 'merged',
  mergedInto: canonicalTopicId,
})
\`\`\`

2. Create a \`related_to\` edge between the two topics for traceability:

\`\`\`ts
await context.graph.relate(mergedTopicId, 'related_to', canonicalTopicId)
\`\`\`

3. Transfer mention count from the merged topic to the canonical topic:

\`\`\`ts
await context.updateAttributes(canonicalTopicId, {
  mentionCount: canonicalMentionCount + mergedMentionCount,
  lastMentionedAt: Date.now(),
})
\`\`\`

## Notes

- Only process topics with \`status: 'active'\`. Skip merged or stale entries.
- After merging, do not re-process the newly merged topic in the same run.
`,
}

export const topicSkills: DomainSkill[] = [topicManagement, topicQuery, topicProcessing]

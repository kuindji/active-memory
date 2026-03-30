# Topic Management

Topics are memory entries owned by the `topic` domain with the `topic` tag.

## Creating a Topic

Before creating a topic, check for existing similar topics:

```ts
const existing = await context.search({
  text: topicName,
  tags: ['topic'],
  minScore: 0.8,
})
```

If no sufficiently similar topic exists, create one:

```ts
const topicId = await context.writeMemory({
  content: topicDescription, // human-readable description of the topic
  tags: ['topic'],
  ownership: {
    domain: 'topic',
    attributes: {
      name: topicName,        // string — canonical label for the topic
      status: 'active',       // TopicStatus: 'active' | 'stale' | 'merged'
      mentionCount: 0,        // number — how many times this topic has been referenced
      lastMentionedAt: Date.now(), // number — unix timestamp
      createdBy: context.domain,  // string — domain ID that created this topic
    },
  },
})
```

## Linking a Memory to a Topic

Use a graph edge to associate any memory with a topic:

```ts
await context.graph.relate(memoryId, 'about_topic', topicId, {
  domain: context.domain, // the domain creating the relationship
})
```

## Creating Topic Hierarchy

To mark a topic as a subtopic of a parent topic:

```ts
await context.graph.relate(childTopicId, 'subtopic_of', parentTopicId)
```

## Updating Mention Count

When a topic is referenced, increment its mention count:

```ts
// Use search or getMemories to retrieve the current attributes before updating
const results = await context.search({ text: topicName, tags: ['topic'], limit: 1 })
const topicEntry = results.entries[0]
const attrs = topicEntry?.domainAttributes?.['topic'] ?? {}
const current = typeof attrs.mentionCount === 'number' ? attrs.mentionCount : 0

await context.updateAttributes(topicId, {
  mentionCount: current + 1,
  lastMentionedAt: Date.now(),
})
```

# Topic Querying

## Finding Topics by Content

Use semantic or full-text search filtered by the `topic` tag:

```ts
const results = await context.search({
  text: queryText,
  tags: ['topic'],
})
```

## Listing Active Topics

Retrieve all active topics using a tag + attribute filter:

```ts
const topics = await context.getMemories({
  tags: ['topic'],
  attributes: { status: 'active' },
})
```

To exclude merged or stale topics when using search results, filter the returned entries:

```ts
const activeOnly = results.entries.filter(
  (e) => e.domainAttributes['topic']?.status === 'active'
)
```

## Finding Memories Linked to a Topic

Traverse the `about_topic` edge in reverse to get all memories linked to a given topic:

```ts
// Pseudocode: traverse from topicId following incoming about_topic edges
const memories = await context.graph.traverse(topicId, '<-about_topic<-memory')
```

## Finding Child Topics

Traverse the `subtopic_of` edge in reverse to get all subtopics of a parent:

```ts
// Pseudocode: traverse from parentTopicId following incoming subtopic_of edges
const children = await context.graph.traverse(parentTopicId, '<-subtopic_of<-topic')
```

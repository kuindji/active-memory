# Topic Merge Detection (Internal)

This skill describes the merge detection logic run by the topic domain schedule.

## Finding Candidate Pairs

Search for active topics and identify pairs with high embedding similarity (threshold: 0.85):

```ts
const activeTopics = await context.getMemories({
  tags: ['topic'],
  attributes: { status: 'active' },
})

// Compare embeddings pairwise; flag pairs where similarity > 0.85
```

## Selecting the Canonical Topic

For each candidate pair, the topic with the higher `mentionCount` is kept as the canonical topic. If counts are equal, prefer the older entry (lower `createdAt`).

## Merging Topics

1. Mark the non-canonical topic as merged:

```ts
await context.updateAttributes(mergedTopicId, {
  status: 'merged',
  mergedInto: canonicalTopicId,
})
```

2. Create a `related_to` edge between the two topics for traceability:

```ts
await context.graph.relate(mergedTopicId, 'related_to', canonicalTopicId)
```

3. Transfer mention count from the merged topic to the canonical topic:

```ts
await context.updateAttributes(canonicalTopicId, {
  mentionCount: canonicalMentionCount + mergedMentionCount,
  lastMentionedAt: Date.now(),
})
```

## Notes

- Only process topics with `status: 'active'`. Skip merged or stale entries.
- After merging, do not re-process the newly merged topic in the same run.

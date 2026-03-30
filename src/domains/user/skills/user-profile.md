# User Profile Consolidation (Internal)

This skill describes the consolidation logic run by the user domain schedule.

## Finding All User Nodes

Query the graph for all user records:

```ts
const userNodes = await context.graph.query<{ id: string; userId: string }[]>(
  'SELECT id, userId FROM user'
)
```

## Collecting Linked Data

For each user node, retrieve all incoming edges and resolve the linked memories:

```ts
const edges = await context.getNodeEdges(userNodeId, 'in')
const memoryIds = edges.map(e => String(e.in)).filter(id => id.startsWith('memory:'))

const contents: string[] = []
for (const memId of memoryIds) {
  const memory = await context.getMemory(memId)
  if (memory) contents.push(memory.content)
}
```

## LLM Synthesis

Pass the collected memory contents to the LLM consolidation helper:

```ts
const summary = await context.llm.consolidate(contents)
```

## Summary Update Strategy

- If a profile summary memory already exists for this user (identified by having an `about_user` edge pointing to the same user node), update its content in place:

```ts
await context.graph.updateNode(existingSummaryId, { content: summary })
```

- If no summary exists, create a new memory and link it to the user node:

```ts
const summaryId = await context.writeMemory({
  content: summary,
  tags: ['user/profile-summary'],
  ownership: { domain: 'user', attributes: {} },
})
await context.graph.relate(summaryId, 'about_user', userNodeId)
```

## Notes

- Skip user nodes that have no linked memory edges.
- Skip LLM calls when there is no content to consolidate.
- Do not duplicate summaries — always check for an existing summary before creating a new one.

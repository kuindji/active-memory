# User Data Querying

## Finding User Facts by Category

Retrieve user facts filtered by a tag category:

```ts
const preferences = await context.getMemories({
  tags: ['user/preference'],
  domains: ['user'],
})
```

Available category tags: `user/identity`, `user/preference`, `user/expertise`, `user/goal`

## Getting All Data Linked to a User

Use `getNodeEdges` to find all memories connected to the user node:

```ts
const userId = requestContext.userId
const userNodeId = `user:${userId}`

const edges = await context.getNodeEdges(userNodeId, 'in')
// edges[].in contains the memory IDs pointing to this user node

const memoryIds = edges.map(e => String(e.in)).filter(id => id.startsWith('memory:'))
const memories = await Promise.all(memoryIds.map(id => context.getMemory(id)))
```

## Searching User Facts by Content

Use full-text or semantic search scoped to the user domain:

```ts
const results = await context.search({
  text: queryText,
  tags: ['user'],
  domains: ['user'],
})
```

## Getting the Profile Summary

A consolidated profile summary is stored with the `user/profile-summary` tag:

```ts
const summaries = await context.getMemories({
  tags: ['user/profile-summary'],
  domains: ['user'],
})

// The summary linked to a specific user can be identified by following
// its outgoing about_user edge to the matching user node
```

# User Data Storage

User facts are memory entries linked to a user node in the graph. The user node is a dedicated SurrealDB record identified by a `userId` string.

## Finding or Creating a User Node

Before storing a user fact, ensure the user node exists:

```ts
const userId = requestContext.userId // string — the external user identifier
const userNodeId = `user:${userId}`

const existing = await context.graph.getNode(userNodeId)
if (!existing) {
  await context.graph.createNodeWithId(userNodeId, { userId })
}
```

## Storing a User Fact

Write a memory entry and link it to the user node with an `about_user` edge:

```ts
const memoryId = await context.writeMemory({
  content: factText, // human-readable fact about the user
  tags: ['user/preference'], // use a category sub-tag (see below)
  ownership: {
    domain: 'user',
    attributes: {},
  },
})

await context.graph.relate(memoryId, 'about_user', userNodeId)
```

## Tag Categories

Use sub-tags under `user/` to categorise user facts:

| Tag | Use for |
|-----|---------|
| `user/identity` | Name, location, pronouns, and other identity attributes |
| `user/preference` | Likes, dislikes, settings, communication style |
| `user/expertise` | Skills, knowledge areas, professional background |
| `user/goal` | Current objectives, aspirations, ongoing projects |

Example:

```ts
// Identity fact
await context.writeMemory({
  content: 'User prefers to be addressed as Alex.',
  tags: ['user/identity'],
  ownership: { domain: 'user', attributes: {} },
})

// Preference fact
await context.writeMemory({
  content: 'User prefers concise responses without bullet lists.',
  tags: ['user/preference'],
  ownership: { domain: 'user', attributes: {} },
})
```

## Linking Existing Memories to a User

If a memory already exists and should be associated with a user, create the edge directly:

```ts
await context.graph.relate(existingMemoryId, 'about_user', userNodeId)
```

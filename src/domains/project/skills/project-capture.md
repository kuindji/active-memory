# Capturing Project Knowledge

Record curated project knowledge — decisions, rationale, clarifications, and direction — by writing directly to the project domain. This is the primary data path; agents write structured knowledge as a side effect of normal work.

## What to Capture

Focus on knowledge that cannot be derived from code or git history:

- **Decisions** — "We chose SQS over direct HTTP for order processing because of retry guarantees"
- **Rationale** — "The reason payments use a separate database is regulatory isolation"
- **Clarifications** — "Despite the name, `UserProfile` is actually the billing entity, not the identity record"
- **Direction** — "We're migrating from REST to gRPC for all inter-service communication"

Do NOT capture: implementation details visible in code, commit messages, or documentation that already exists.

## Writing Project Knowledge

Use `engine.ingest()` with the project domain as owner and classification metadata:

```ts
await engine.ingest('We chose event sourcing for the order pipeline because we need full audit trail for compliance', {
  domains: ['project'],
  metadata: {
    classification: 'decision',
    audience: ['technical', 'business'],
  },
})
```

### Required Metadata

- `classification` — One of: 'decision', 'rationale', 'clarification', 'direction'
- `audience` — Array of: 'technical', 'business' (one or both)

### Via CLI

```sh
active-memory ingest --domain project \
  --meta classification=decision \
  --meta audience=technical,business \
  "We chose event sourcing for the order pipeline because we need full audit trail"
```

## Creating Entity Nodes

When writing about specific architectural components, you can create entity nodes and link them to memories for richer graph traversal:

```ts
// Create or find a module entity
const moduleId = await context.graph.createNode('module', {
  name: 'order-processor',
  path: 'services/order-processor',
  kind: 'service',
})

// Link the memory to the entity
await context.graph.relate(memoryId, 'about_entity', moduleId, { relevance: 1.0 })
```

### Entity-to-Entity Relationships

Build the architecture graph by relating entities:

```ts
// Service communication
await context.graph.relate(orderProcessorId, 'connects_to', paymentServiceId, {
  protocol: 'sqs',
  direction: 'async',
  description: 'Sends payment requests after order validation',
})

// Service owns a data entity
await context.graph.relate(orderProcessorId, 'manages', orderEntityId, {
  role: 'owner',
})

// Module implements a business concept
await context.graph.relate(orderProcessorId, 'implements', reconciliationConceptId)

// Structural nesting
await context.graph.relate(backendPackageId, 'contains', orderProcessorId)
```

## When to Capture

Capture continuously as a side effect of normal work:

- During code review, when you notice a design choice worth explaining
- After a discussion that clarifies why something works a certain way
- When making a decision that affects architecture or data flow
- When business meaning of a field or entity isn't obvious from the code
- When direction changes are discussed or decided

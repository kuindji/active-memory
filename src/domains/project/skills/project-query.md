# Querying Project Knowledge

Search and retrieve project knowledge by classification, audience, entity references, and architecture graph traversal.

## Searching Memories

### By Text

```ts
const result = await engine.search({
  text: 'order processing',
  domains: ['project'],
})
```

### By Classification

Find all decisions:

```ts
const decisions = await engine.search({
  text: 'payment flow',
  domains: ['project'],
  tags: ['project/decision'],
})
```

### By Audience

Filter for non-technical stakeholders:

```ts
const businessContext = await engine.buildContext('What does the order pipeline do?', {
  domains: ['project'],
  context: { audience: 'business' },
})
```

### Via CLI

```sh
active-memory search --domain project "order processing"
active-memory search --domain project --tag project/decision "payment"
active-memory build-context --domain project "order pipeline architecture"
```

## Architecture Graph Queries

The project domain maintains an entity graph of modules, data entities, concepts, and patterns. Use graph traversal to explore architecture.

### What connects to a module?

```ts
// Find modules that communicate with order-processor
const connected = await context.graph.traverse(
  'module:order-processor',
  '<->connects_to<->module'
)
```

### What does a service manage?

```ts
// Find data entities managed by a service
const entities = await context.graph.traverse(
  'module:order-processor',
  '->manages->data_entity'
)
```

### What implements a concept?

```ts
// Find all modules implementing the reconciliation concept
const modules = await context.graph.traverse(
  'concept:reconciliation',
  '<-implements<-module'
)
```

### What memories are about an entity?

```ts
// Find all knowledge about a specific module
const memories = await context.graph.traverse(
  'module:order-processor',
  '<-about_entity<-memory'
)
```

## Surfacing Questions

The commit scanner and drift detector create `question` memories when they detect changes that may need human explanation:

```sh
active-memory search --domain project --tag project/question ""
```

## Using buildContext

The project domain's `buildContext` returns structured sections:

- **[Decisions]** — Relevant decisions and rationale (50% of token budget)
- **[Architecture]** — Entity-linked context from graph traversal (30%)
- **[Recent Observations]** — Latest observations from scans (20%)

Audience filtering removes technical-only content when `audience: 'business'` is set in request context.

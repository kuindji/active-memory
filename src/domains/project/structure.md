# Project Knowledge Domain

Captures the invisible knowledge layer around a codebase: architectural decisions and their rationale, business logic semantics, design direction, and relationships between system components. This knowledge cannot be derived from code or git history alone.

## Tags

- `project` — Root tag for all project knowledge memories
- `project/technical` — Implementation architecture, decisions, direction
- `project/business` — Data semantics, business rules, real-world meaning
- `project/decision` — "We chose X because Y"
- `project/rationale` — "The reason this works this way is..."
- `project/clarification` — "Despite the name, this actually means..."
- `project/direction` — "We're moving toward X"
- `project/observation` — System-detected change (from commit scanner or drift detector)
- `project/question` — Flagged gap needing human input

## Ownership Attributes

- `classification`: 'decision' | 'rationale' | 'clarification' | 'direction' | 'observation' | 'question'
- `audience`: ('technical' | 'business')[] — Who this knowledge is relevant to
- `superseded`: boolean — Whether this memory has been replaced by a newer one

## Entity Nodes

| Node | Fields | Purpose |
|------|--------|---------|
| `module` | `name`, `path?`, `kind?`, `status?` | Package, service, lambda, subsystem, library |
| `data_entity` | `name`, `source?` | Domain object (Order, Payment, Return) |
| `concept` | `name`, `description?` | Business concept (reconciliation, return flow) |
| `pattern` | `name`, `scope?` | Architectural/design pattern in use |

Module `kind` values: 'package', 'service', 'lambda', 'subsystem', 'library'
Module `status` values: 'active' (default), 'archived'

## Edges

### Memory-to-Entity
- `about_entity(memory -> module|data_entity|concept|pattern)` — What this memory is about. Fields: `relevance?` (number)

### Memory-to-Memory
- `supersedes(memory -> memory)` — Newer decision replaces older one (preserves history)
- `raises(memory -> memory)` — An observation raises a question

### Entity-to-Entity (Architecture Graph)
- `connects_to(module -> module)` — Runtime communication. Fields: `protocol?`, `direction?`, `description?`
- `manages(module -> data_entity)` — Service owns/handles this entity. Fields: `role?` (owner, reader, transformer)
- `contains(module -> module)` — Structural nesting (package contains lambdas)
- `implements(module -> concept)` — Module implements this business concept
- `has_field(data_entity -> data_entity)` — Entity composition/relationships. Fields: `cardinality?` (one, many)

### Cross-Domain
- `about_topic(memory -> topic)` — Links project memories to shared topics (reuses Topic domain edge)

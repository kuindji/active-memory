# Knowledge Base Domain

General-purpose knowledge base for storing domain-agnostic knowledge: facts, definitions, how-tos, technical references, concepts, and insights. A personal wiki not tied to any specific project or conversation.

## Tags

- `kb` — Root tag for all knowledge base memories
- `kb/fact` — Verified, discrete pieces of knowledge
- `kb/definition` — Term or concept definitions
- `kb/how-to` — Procedural explanations, recipes, step-by-step guides
- `kb/reference` — Technical references, specifications, standards
- `kb/concept` — Abstract ideas, principles, mental models
- `kb/insight` — Personal conclusions, learned lessons

## Ownership Attributes

- `classification`: 'fact' | 'definition' | 'how-to' | 'reference' | 'concept' | 'insight'
- `superseded`: boolean — Whether this entry has been replaced by a newer one
- `source`: 'manual' | 'extracted' | 'consolidated' (optional) — How this entry was created

## Edges

### Memory-to-Memory
- `supersedes(memory -> memory)` — Newer knowledge replaces older (preserves history)
- `related_knowledge(memory -> memory)` — Direct entry-to-entry relationship. Fields: `relationship` ('prerequisite' | 'example-of' | 'contrast' | 'elaboration')

### Cross-Domain
- `about_topic(memory -> topic)` — Links knowledge entries to shared topics (reuses Topic domain edge)

## Schedules

- **consolidate-knowledge** (default: 6 hours) — Clusters similar entries by classification and merges overlapping ones into consolidated entries

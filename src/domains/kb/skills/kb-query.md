# Querying Knowledge

Search and retrieve knowledge entries by classification, topic, or content similarity.

## Search by Classification

Filter knowledge by type using tags:

```sh
# Find all how-to entries about PostgreSQL
node memory-domain search --tags kb/how-to --text "PostgreSQL"

# Find definitions related to distributed systems
node memory-domain search --tags kb/definition --text "distributed systems"

# Find all facts (no text filter)
node memory-domain search --tags kb/fact
```

## Search by Topic

Knowledge entries are linked to topics via `about_topic` edges. Search traverses these links automatically through query expansion.

```sh
# This will also find entries linked to a "caching" topic
node memory-domain search --domains kb --text "caching strategies"
```

## Build Context

Use `buildContext` to get a structured knowledge summary organized by section:

- **[Definitions & Concepts]** — Term definitions and mental models
- **[Facts & References]** — Verified knowledge and technical references
- **[How-Tos & Insights]** — Procedures and learned lessons

Superseded entries are automatically excluded.

## Graph Traversal

Explore knowledge relationships:

```sh
# Find what a knowledge entry supersedes
node memory-domain graph traverse <memory-id> ->supersedes->memory

# Find related knowledge
node memory-domain graph traverse <memory-id> ->related_knowledge->memory

# Find topics linked to an entry
node memory-domain graph traverse <memory-id> ->about_topic->memory
```

### Relationship Types

| Type | Meaning |
|------|---------|
| `prerequisite` | Must understand this first |
| `example-of` | Illustrates a concept |
| `contrast` | Opposing or alternative view |
| `elaboration` | Adds detail to existing knowledge |

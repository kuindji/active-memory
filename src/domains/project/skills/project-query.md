# Querying Project Knowledge

Search and retrieve project knowledge by classification, audience, entity references, and graph traversal.

## Searching Memories

```sh
# By text
active-memory search "order processing" --domains project

# By classification tag
active-memory search "payment flow" --domains project --tags project/decision

# Build context with audience filter
active-memory build-context "order pipeline architecture" \
  --domains project \
  --meta audience=business
```

### Classification Tags

| Tag | Content |
|-----|---------|
| `project/decision` | Architectural and design decisions |
| `project/rationale` | Reasoning behind choices |
| `project/clarification` | Corrections and non-obvious explanations |
| `project/direction` | Future plans and migration paths |
| `project/question` | Observations needing human explanation |

## Architecture Graph Queries

The project domain maintains an entity graph. Use graph traversal to explore architecture.

```sh
# What modules connect to a service?
active-memory graph traverse <module-id> --edges connects_to --depth 1

# What data entities does a service manage?
active-memory graph traverse <module-id> --edges manages --direction out --depth 1

# What modules implement a concept?
active-memory graph traverse <concept-id> --edges implements --direction in --depth 1

# What memories are about an entity?
active-memory graph traverse <entity-id> --edges about_entity --direction in --depth 1
```

## Surfacing Questions

The commit scanner and drift detector create `question` memories when they detect changes needing explanation:

```sh
active-memory search "" --domains project --tags project/question
```

## Context Building

The project domain's `build-context` returns structured sections:

- **Decisions** — Relevant decisions and rationale (50% of token budget)
- **Architecture** — Entity-linked context from graph traversal (30%)
- **Recent Observations** — Latest observations from scans (20%)

Audience filtering removes technical-only content when `audience=business` is set via `--meta`.

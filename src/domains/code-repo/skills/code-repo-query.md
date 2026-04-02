# Querying Code Repo Knowledge

Search and retrieve code repo knowledge by classification, audience, entity references, and graph traversal.

## Searching Memories

```sh
# By text
node memory-domain search "<query-text>" --domains code-repo

# By classification tag
node memory-domain search "<query-text>" --domains code-repo --tags code-repo/decision

# Build context with audience filter
node memory-domain build-context "<content-to-build-context-for>" \
  --domains code-repo \
  --meta audience=business
```

### Classification Tags

| Tag | Content |
|-----|---------|
| `code-repo/decision` | Architectural and design decisions |
| `code-repo/rationale` | Reasoning behind choices |
| `code-repo/clarification` | Corrections and non-obvious explanations |
| `code-repo/direction` | Future plans and migration paths |
| `code-repo/question` | Observations needing human explanation |

## Architecture Graph Queries

The code repo domain maintains an entity graph. Use graph traversal to explore architecture.

```sh
# What modules connect to a service?
node memory-domain graph traverse <module-id> --edges connects_to --depth 1

# What data entities does a service manage?
node memory-domain graph traverse <module-id> --edges manages --direction out --depth 1

# What modules implement a concept?
node memory-domain graph traverse <concept-id> --edges implements --direction in --depth 1

# What memories are about an entity?
node memory-domain graph traverse <entity-id> --edges about_entity --direction in --depth 1
```

## Surfacing Questions

The commit scanner and drift detector create `question` memories when they detect changes needing explanation:

```sh
node memory-domain search "" --domains code-repo --tags code-repo/question
```

## Context Building

The code repo domain's `build-context` returns structured sections:

- **Decisions** — Relevant decisions and rationale (50% of token budget)
- **Architecture** — Entity-linked context from graph traversal (30%)
- **Recent Observations** — Latest observations from scans (20%)

Audience filtering removes technical-only content when `audience=business` is set via `--meta`.

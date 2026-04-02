# Capturing Knowledge

Record general-purpose knowledge — facts, definitions, how-tos, references, concepts, and insights. Focus on knowledge that is useful across projects and conversations.

## What to Capture

- **Facts** — "HTTP 429 status code means Too Many Requests"
- **Definitions** — "Eventual consistency means replicas converge to the same state over time"
- **How-Tos** — "To reset a PostgreSQL sequence: ALTER SEQUENCE ... RESTART WITH 1"
- **References** — "RFC 7519 defines JWT with header.payload.signature structure"
- **Concepts** — "The CAP theorem states you can only guarantee two of consistency, availability, partition tolerance"
- **Insights** — "In practice, optimistic locking works better than pessimistic for read-heavy workloads"

Do NOT capture: project-specific decisions (use code-repo domain), conversation context (use chat domain), or user preferences (use user domain).

## Ingesting Knowledge

```sh
node memory-domain ingest --domains kb \
  --meta classification=fact \
  --text "The HTTP 429 status code means Too Many Requests and indicates rate limiting"
```

### Optional Metadata

| Key | Values |
|-----|--------|
| `classification` | `fact`, `definition`, `how-to`, `reference`, `concept`, `insight` |
| `source` | `manual` (default when ingested by user) |

If classification is not provided, the inbox processor will classify automatically using LLM.

## When to Capture

Capture knowledge as you encounter it:

- When you learn a useful fact or technique worth remembering
- When you look up a definition or reference you'll need again
- When you discover a non-obvious insight through experience
- When you find a procedural solution to a recurring problem

# Topic Domain

Built-in primitive for tracking named topics across domains.

## Tags
- `topic` — All topic memories carry this tag

## Ownership Attributes
- `name`: string — Human-readable topic name
- `status`: 'active' | 'stale' | 'merged' — Topic lifecycle status
- `mentionCount`: number — Times referenced by other domains
- `lastMentionedAt`: number — Timestamp of last reference
- `createdBy`: string — Domain ID that created this topic
- `mergedInto`: string (optional) — Target topic ID when status is 'merged'

## Edges
- `subtopic_of`: Creates parent-child topic hierarchy
- `related_to`: Semantic relatedness between topics (with strength field)
- `about_topic`: Links any memory to a topic (with domain field)

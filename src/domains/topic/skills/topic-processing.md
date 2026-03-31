# Topic Merge Detection (Internal)

This skill describes the merge detection logic run by the topic domain schedule.

## Triggering

```sh
active-memory schedule trigger topic merge-similar-topics
```

## Finding Candidate Pairs

Search for active topics and identify pairs with high embedding similarity (threshold: 0.85):

```sh
active-memory search "" --tags topic --mode vector
```

The schedule compares embeddings pairwise and flags pairs where similarity exceeds 0.85.

## Selecting the Canonical Topic

For each candidate pair, the topic with the higher `mentionCount` is kept as the canonical topic. If counts are equal, prefer the older entry (lower `createdAt`).

## Merging Topics

1. Mark the non-canonical topic as merged:

```sh
active-memory memory <merged-topic-id> update --attr status=merged --attr mergedInto=<canonical-topic-id>
```

2. Create a `related_to` edge between the two topics for traceability:

```sh
active-memory graph relate <merged-topic-id> <canonical-topic-id> related_to --domain topic
```

3. Transfer mention count from the merged topic to the canonical topic:

```sh
active-memory memory <canonical-topic-id> update --attr mentionCount=<combined-count>
```

## Notes

- Only process topics with `status: active`. Skip merged or stale entries.
- After merging, do not re-process the newly merged topic in the same run.

# Project Knowledge Processing (Internal)

Documents the internal processing logic: inbox processing for unstructured knowledge, commit scanning, and drift detection.

## Inbox Processing

The inbox is a secondary path for unstructured knowledge dumps. Most project knowledge arrives via direct writes from agents using the `project-capture` skill.

When an unstructured memory arrives in the inbox:

1. If `classification` is missing from attributes, LLM classifies the content as one of: decision, rationale, clarification, direction, observation, question
2. Tags are applied: root `project` tag, audience sub-tags, classification sub-tag
3. LLM extracts entity references (module names, data entities, concepts, patterns)
4. Entity nodes are created or linked via `about_entity` edges
5. Topics are extracted and linked via `about_topic` edges
6. For decisions: existing decisions about the same entities are checked for contradictions; if found, a `supersedes` edge is created

## Commit Scanner Schedule

Runs periodically to detect structural changes in the project repository.

**Triggering manually:**

```sh
active-memory schedule trigger project commit-scanner
```

**What it detects:**
- New directories → creates `module` entity nodes
- Deleted directories → marks module entities as `status: archived`
- Significant structural changes → creates `observation` memories tagged `project/technical`
- Changes suggesting business logic shifts → creates `question` memories tagged `project/question`

**How it works:**
1. Reads last processed commit hash from domain metadata
2. Parses `git log --name-status` since that commit
3. Groups file additions, deletions, and renames by directory to identify module-level changes
4. Stores new HEAD hash for next run

Requires `projectRoot` to be set in domain options.

## Drift Detector Schedule

Runs periodically (default: 24 hours) to check whether recorded decisions still match the codebase structure.

**Triggering manually:**

```sh
active-memory schedule trigger project drift-detector
```

**What it detects:**
- Module entities with `path` fields pointing to paths that no longer exist
- Creates `observation` memories noting the structural drift

Requires `projectRoot` to be set in domain options.

## Schedule Configuration

Both schedules are enabled by default when `projectRoot` is provided, disabled when it's not. Intervals can be configured via domain options:

- Commit scanner: `intervalMs` (default: 3,600,000 — 1 hour)
- Drift detector: `intervalMs` (default: 86,400,000 — 24 hours)

# Code Repo Inbox Processing

Classify and enrich unstructured code repo knowledge arriving via the inbox.

## Your Role

You process unstructured knowledge dumps that lack proper classification or entity links. Most code repo knowledge arrives pre-classified via the `code-repo-capture` skill; inbox items are the exception.

## Classification

When `classification` is missing from attributes, classify the content as one of:

- **decision** — a choice that was made about architecture, tooling, process
- **rationale** — reasoning behind a decision
- **clarification** — disambiguation of requirements or terms
- **direction** — high-level guidance or vision
- **observation** — factual note about current state
- **question** — open question needing resolution

## Entity Extraction

Extract references to code repo entities from the content:

- **module** — code directories, services, packages
- **data_entity** — database tables, API resources, data models
- **concept** — business or architectural concepts
- **pattern** — recurring design or implementation patterns

For each entity, check whether a matching node already exists before creating a new one.

## Tagging

Apply tags based on classification and audience:

- Root tag: `code-repo`
- Audience sub-tags: `code-repo/technical`, `code-repo/business`
- Classification sub-tag: `code-repo/<classification>`

## Contradiction Detection

For items classified as `decision`: search for existing decisions linked to the same entities. If a prior decision contradicts the new one, create a `supersedes` edge from the new decision to the old one.

## Topic Linking

Extract topic references and link via `about_topic` edges. Reuse existing topics when a match is found.

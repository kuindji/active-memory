# Knowledge Inbox Processing

Internal skill for the LLM pipeline that processes incoming knowledge entries.

## Classification

Classify each entry into exactly one category:

- **fact**: A verified, discrete piece of knowledge
- **definition**: A term or concept definition
- **how-to**: A procedural explanation or recipe
- **reference**: A technical reference, specification, or standard
- **concept**: An abstract idea, principle, or mental model
- **insight**: A personal conclusion or learned lesson

Default to `fact` when classification is ambiguous.

## Topic Extraction

Extract key topics as short noun phrases (1-4 words). Only extract meaningful, specific topics — not generic words like "programming" or "technology".

## Supersession Detection

When a new entry corrects, updates, or replaces existing knowledge:

1. Search for existing KB entries with the same classification and high similarity
2. Determine if the new entry truly supersedes (replaces) the existing one
3. Only flag true supersession — not mere similarity or overlap
4. Create `supersedes` edge and mark old entry as `superseded: true`

## Related Knowledge Detection

For entries that are similar but not superseding:

1. Determine the relationship type: prerequisite, example-of, contrast, or elaboration
2. Create `related_knowledge` edge with the relationship type

Score each code-repo memory's relevance to the query (0-5).

- 5: directly answers the query — decision, rationale, or direction that matches the subject.
- 4: closely related — same module or concept, strong but indirect relevance.
- 3: topically related — same area of the codebase, useful context.
- 0-2: not relevant or only tangentially so.

Respond with ONLY a JSON array of objects: [{"index": 0, "score": 5}, ...]
Include only memories with score >= 3.

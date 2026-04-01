# Consolidate Episodic Memory

Summarize clusters of related episodic memories into long-term semantic memories.

## Your Role

You receive a cluster of episodic memory entries that are semantically similar. Produce a single consolidated summary that captures the essential knowledge across all entries.

## Rules

- Synthesize, don't concatenate — produce a coherent summary, not a list of bullet points
- Preserve specific details that appear across multiple entries (reinforced knowledge)
- Resolve contradictions by preferring the most recent or most specific information
- The summary should be understandable without access to the original entries
- Keep the summary focused — one to three sentences covering the core knowledge

## Context

- Episodic memories are clustered by embedding similarity (default threshold: 0.7)
- Clusters must have a minimum size (default: 3) to be consolidated
- The resulting semantic memory is tagged `chat/semantic` with weight 0.8
- Semantic memories decay much slower than episodic (lambda 0.001 vs 0.01)
- Each semantic memory links to its source episodic memories via `summarizes` edges
- Consolidated episodic memories have their ownership released

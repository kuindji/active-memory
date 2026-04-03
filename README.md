# @kuindji/memory-domain

A domain-driven memory engine with graph storage, embeddings, and semantic search. Built on SurrealDB.

## Features

- **Domain-based architecture** — memories are organized into bounded domains (topics, users, code repos, knowledge base) that define their own processing, search, and scheduling logic
- **Graph data model** — memories, tags, and domains form a rich graph with typed edges (reinforces, contradicts, summarizes, refines)
- **Hybrid search** — combines vector similarity, full-text search, and graph traversal
- **Inbox processing** — parallel ingestion pipeline with similarity batching and deduplication
- **LLM integration** — pluggable LLM adapters for extraction, synthesis, and reranking
- **Embedding support** — ONNX-based local embeddings via `onnxruntime-node`

## Installation

```bash
npm install @kuindji/memory-domain
```

## Quick Start

```typescript
import { MemoryEngine, topicDomain, ClaudeCliAdapter, OnnxEmbeddingAdapter } from "@kuindji/memory-domain";

const engine = new MemoryEngine({
    connection: "ws://localhost:8000",
    namespace: "my_app",
    database: "memories",
    llm: new ClaudeCliAdapter(),
    embedding: new OnnxEmbeddingAdapter(),
});

engine.registerDomain(topicDomain);
await engine.init();

// Ingest a memory
await engine.ingest("TypeScript 5.5 introduces inferred type predicates");

// Search
const results = await engine.search("TypeScript features");

// Ask a question
const answer = await engine.ask("What do I know about TypeScript?");
```

## CLI

The package includes CLI tools:

```bash
# CLI
npx memory-domain --help
npx memory-domain ingest --text "Some memory to store"
npx memory-domain search --query "find something"

# Interactive TUI
npx memory-domain-tui
```

## Configuration

Create a `memory-domain.config.ts` file in your project root:

```typescript
import { MemoryEngine, topicDomain, ClaudeCliAdapter, OnnxEmbeddingAdapter } from "@kuindji/memory-domain";

const engine = new MemoryEngine({
    connection: "ws://localhost:8000",
    namespace: "default",
    database: "memory",
    llm: new ClaudeCliAdapter(),
    embedding: new OnnxEmbeddingAdapter(),
});

engine.registerDomain(topicDomain);

export default engine;
```

## Built-in Domains

- **Topic** — general-purpose topic-based memories with lifecycle management
- **User** — user profile and preference tracking
- **Code Repo** — code repository knowledge (patterns, decisions, architecture)
- **Knowledge Base** — structured knowledge with classification
- **Log** — simple append-only logging

## Requirements

- Node.js 18+ or Bun
- SurrealDB instance

## License

MIT

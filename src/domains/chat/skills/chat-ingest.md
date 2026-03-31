# Chat Ingestion

Feed messages into the chat domain. Both user and assistant messages are supported.

## Required Metadata

Every ingestion call must include `userId` and `chatSessionId` via `--meta`:

```sh
active-memory ingest --domains chat \
  --meta userId=user-123 \
  --meta chatSessionId=session-456 \
  --text "What is TypeScript?"
```

## Message Role

Use the `role` metadata field to distinguish user input from agent output:

```sh
# User message
active-memory ingest --domains chat \
  --meta userId=user-123 \
  --meta chatSessionId=session-456 \
  --meta role=user \
  --text "What is TypeScript?"

# Assistant response
active-memory ingest --domains chat \
  --meta userId=user-123 \
  --meta chatSessionId=session-456 \
  --meta role=assistant \
  --text "TypeScript is a typed superset of JavaScript."
```

## What Happens on Ingestion

1. The message is stored as working memory with `chat/message` tag
2. Topics are extracted and linked via `about_topic` edges
3. `messageIndex` is auto-incremented per session
4. The raw message is available immediately for context building

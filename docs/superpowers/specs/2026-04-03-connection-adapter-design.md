# Connection Adapter

## Problem

The engine currently accepts a connection string directly and passes it to SurrealDB. This works for local file-based (`surrealkv://`) and remote (`ws://`) connections, but doesn't support scenarios where the database files live in remote storage like S3. We need a way to transparently download, extract, and optionally re-upload database archives without changing the engine's core connection logic.

## Solution

Introduce a `ConnectionAdapter` interface with two methods — `resolve()` and `save()` — that bracket the engine's connection lifecycle. The engine always goes through an adapter. A `PassthroughAdapter` handles native connection strings with zero overhead. An `S3ConnectionAdapter` downloads and extracts archives before the engine connects, and optionally compresses and uploads them on save.

## ConnectionAdapter Interface

```typescript
interface ConnectionAdapter {
  resolve(): Promise<string>;
  save(): Promise<void>;
}
```

- **`resolve()`** — Performs any setup needed (download, extract) and returns a local SurrealDB connection string (e.g. `surrealkv:///tmp/memory-domain-abc123/db`).
- **`save()`** — Persists changes back to the source if configured to do so. Called before the SurrealDB connection is closed.

## PassthroughAdapter

Location: `src/adapters/connection/passthrough.ts`

Wraps a plain connection string. `resolve()` returns it unchanged. `save()` is a no-op.

```typescript
class PassthroughAdapter implements ConnectionAdapter {
  constructor(private connection: string) {}

  async resolve(): Promise<string> {
    return this.connection;
  }

  async save(): Promise<void> {}
}
```

## S3ConnectionAdapter

Location: `src/adapters/connection/s3.ts`

### Config

```typescript
interface S3AdapterConfig {
  bucket: string;
  key: string;
  region: string;
  localDir?: string;       // Default: /tmp/memory-domain-<hash>
  save?: boolean;           // Default: false
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  };
}
```

- `bucket` — S3 bucket name.
- `key` — Path to the `.tar.gz` archive in S3.
- `region` — AWS region.
- `localDir` — Local directory to extract into. Defaults to a deterministic temp path derived from the bucket+key (so repeated opens reuse the same location).
- `save` — Whether `save()` compresses and uploads back to S3. Default `false`.
- `credentials` — Optional. If omitted, uses the default AWS credential chain (env vars, IAM role, etc.).

### Behavior

**`resolve()`:**

1. Determine `localDir` — use configured value, or derive from bucket+key hash under `/tmp`.
2. Download the archive from `s3://<bucket>/<key>` using `@aws-sdk/client-s3` (`GetObjectCommand`).
3. Extract the `.tar.gz` to `localDir` using `tar` + `zlib`.
4. Return `surrealkv://<localDir>/db` as the connection string.

If the archive doesn't exist in S3 (first run), `resolve()` creates the local directory and returns the connection string — SurrealDB will initialize a fresh database.

**`save()`:**

1. If `save` config is `false`, return immediately.
2. Compress `localDir` into a `.tar.gz` archive.
3. Upload to `s3://<bucket>/<key>` using `@aws-sdk/client-s3` (`PutObjectCommand`).

### Error handling

- S3 download failure (non-404) → throw with descriptive error.
- S3 upload failure → throw with descriptive error. The local files remain intact.
- Missing archive (404 on download) → treat as fresh database, no error.

## Engine Integration

Location: `src/core/engine.ts`, `src/core/types.ts`

### Config change

Add optional `adapter` field to `EngineConfig`:

```typescript
interface EngineConfig {
  connection?: string;           // Now optional when adapter is provided
  adapter?: ConnectionAdapter;
  // ... rest unchanged
}
```

Exactly one of `connection` or `adapter` must be provided. If `connection` is given without `adapter`, the engine wraps it in a `PassthroughAdapter`.

### initialize() change

Before connecting to SurrealDB, call the adapter:

```typescript
async initialize(config: EngineConfig): Promise<void> {
  this.adapter = config.adapter ?? new PassthroughAdapter(config.connection!);
  const connectionString = await this.adapter.resolve();

  const db = new Surreal({ engines: createNodeEngines() });
  await db.connect(connectionString);
  // ... rest unchanged
}
```

### close() change

Call `save()` after closing the database (SurrealDB must flush WAL and release file handles before we can safely compress):

```typescript
async close(): Promise<void> {
  this.stopProcessing();
  if (this.db) {
    await this.db.close();
    this.db = null;
  }
  if (this.adapter) {
    await this.adapter.save();
  }
}
```

## File Layout

| File | Purpose |
|------|---------|
| `src/core/types.ts` | `ConnectionAdapter` interface, `S3AdapterConfig` type |
| `src/adapters/connection/passthrough.ts` | `PassthroughAdapter` implementation |
| `src/adapters/connection/s3.ts` | `S3ConnectionAdapter` implementation |
| `src/core/engine.ts` | Integration in `initialize()` and `close()` |

## Dependencies

- `@aws-sdk/client-s3` — S3 download/upload.
- `tar` — Archive extraction and creation. Lightweight, well-maintained.

Both are production dependencies added via `bun add`.

## Usage Examples

**Default (unchanged behavior):**

```typescript
await engine.initialize({
  connection: "surrealkv://./db",
  llm: new ClaudeCliAdapter(),
});
```

**S3-backed database:**

```typescript
import { S3ConnectionAdapter } from "memory-domain/adapters/connection/s3";

await engine.initialize({
  adapter: new S3ConnectionAdapter({
    bucket: "my-memories",
    key: "project-a/db.tar.gz",
    region: "us-east-1",
    save: true,
  }),
  llm: new ClaudeCliAdapter(),
});
```

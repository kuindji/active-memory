# Active Memory CLI

Active Memory is a graph-backed memory engine. You interact with it through the `active-memory` CLI.

## Getting Help

```sh
active-memory help                  # list all commands
active-memory help <command>        # detailed help for a command
```

## Core Commands

| Command | Purpose |
|---------|---------|
| `ingest` | Store new memory from text (domain processing applies) |
| `write` | Create a memory with direct domain ownership (no processing) |
| `search` | Search memories by query |
| `ask` | Ask a question against stored memories |
| `build-context` | Build a token-budgeted context block from relevant memories |
| `memory` | Read, update, tag, or delete a specific memory |
| `graph` | Manage graph edges and traversals |
| `schedule` | List or trigger domain schedules |
| `domains` | List available domains |
| `domain` | Inspect a specific domain |

## Global Flags

| Flag | Purpose |
|------|---------|
| `--pretty` | Human-readable output (default is JSON) |
| `--meta key=value` | Set request context metadata (repeatable) |
| `--config <path>` | Path to config file |
| `--cwd <path>` | Working directory |

## Storing Memories

**`ingest`** sends text through domain processing (dedup, topic extraction, etc.):

```sh
active-memory ingest --text "Some knowledge" --domains project
```

**`write`** creates a memory with direct ownership, bypassing processing:

```sh
active-memory write --domain topic --text "Machine Learning" --tags topic --attr name="Machine Learning" --attr status=active
```

Use `ingest` when the domain should process the input. Use `write` when you know exactly what to store.

## Searching and Querying

```sh
active-memory search "query text" --domains project --limit 5
active-memory search "query" --tags topic --mode vector
active-memory ask "What did we decide about auth?" --domains project
active-memory build-context "current topic" --domains chat --budget 4000
```

## Graph Operations

```sh
active-memory graph edges <node-id> --direction out
active-memory graph relate <from> <to> <edge-type> --domain <owner>
active-memory graph unrelate <from> <to> <edge-type>
active-memory graph traverse <start-id> --edges about_topic,subtopic_of --depth 2
```

## Managing Memories

```sh
active-memory memory <id>                          # read
active-memory memory <id> update --text "new text"  # update
active-memory memory <id> tag important             # add tag
active-memory memory <id> untag important           # remove tag
active-memory memory <id> delete                    # delete
```

## Schedules

Domains register background processing schedules (e.g., topic merging, profile consolidation).

```sh
active-memory schedule list
active-memory schedule trigger <domain-id> <schedule-id>
active-memory schedule run-due
```

## Domains

Each domain owns a slice of the memory graph and defines its own tags, attributes, edges, and schedules.

```sh
active-memory domains --pretty              # list all domains
active-memory domain <id> structure --pretty # show domain data structure
active-memory domain <id> skills --pretty    # list domain skills
```

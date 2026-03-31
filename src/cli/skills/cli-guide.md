# Active Memory CLI

Active Memory is a graph-backed memory engine. You interact with it through the `active-memory` CLI.
Use project preferred runtime (node? bun?) to run this cli.

## Getting Help

`node active-memory help`                  # list all commands
`bun active-memory help <command>`        # detailed help for a command

## Domains

Each domain owns a slice of the memory graph and defines its own tags, attributes, edges, and schedules.

`node active-memory domains --pretty`               # list all registered domains
`node active-memory domain <id> structure --pretty` # show domain data structure
`node active-memory domain <id> skills --pretty`    # list domain skills

## Storing Memories

**`ingest`** sends text through memory domain processing:

`node active-memory ingest --text "<some-knowledge>" --domains <memory-domain>`

**`write`** creates a memory with direct ownership, bypassing processing:

`node active-memory write --domain <domain> --text "<some-memory>" --tags topic --attr name="<name-value>" --attr status=<status-value>`

Use `ingest` when the domain should process the input. Use `write` when you know exactly what to store.

## Searching and Querying

`node active-memory search "<query-text>" --domains <domain> --limit 5`
`node active-memory search "<query-text>" --tags <tag> --mode vector`
`node active-memory ask "<question-to-memory>" --domains <domain>`
`node active-memory build-context "<input-to-build-context-for>" --domains <domain> --budget 4000`

## Graph Operations

`node active-memory graph edges <node-id> --direction out`
`node active-memory graph relate <from> <to> <edge-type> --domain <owner>`
`node active-memory graph unrelate <from> <to> <edge-type>`
`node active-memory graph traverse <start-id> --edges about_topic,subtopic_of --depth 2`

## Managing Memories

`node active-memory memory <id>`                             # read
`node active-memory memory <id> update --text "<new-text>"`  # update
`node active-memory memory <id> tag <tag>`                   # add tag
`node active-memory memory <id> untag <tag>`                 # remove tag
`node active-memory memory <id> delete`                      # delete
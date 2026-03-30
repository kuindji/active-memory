const USAGE = `
Usage: active-memory <command> [options]

Commands:
  ingest          Store new memory from text or stdin
  search          Search memories by query
  ask             Ask a question against stored memories
  build-context   Build a context block from relevant memories
  domains         List all available domains
  domain          Inspect a specific domain
  help            Show this help text

Global Flags:
  --config <path>   Path to config file
  --json            Output as JSON
  --cwd <path>      Working directory

Run "active-memory help <command>" for detailed help on a specific command.
`.trim()

const COMMAND_HELP: Record<string, string> = {
  ingest: `
Usage: active-memory ingest [--text "..."] [--domains d1,d2] [--tags t1,t2] [--event-time <ms>] [--skip-dedup]

Store a new memory. Reads from stdin if piped, otherwise requires --text.

Options:
  --text <string>      Text content to ingest
  --domains <list>     Comma-separated list of domains to assign
  --tags <list>        Comma-separated list of tags to assign
  --event-time <ms>    Event timestamp in milliseconds (defaults to now)
  --skip-dedup         Skip deduplication check

Examples:
  echo "Meeting notes..." | active-memory ingest --domains work
  active-memory ingest --text "Buy milk" --tags shopping
`.trim(),

  search: `
Usage: active-memory search <query> [--mode vector|fulltext|graph|hybrid] [--domains d1,d2] [--tags t1,t2] [--limit N] [--budget N] [--min-score N]

Search stored memories by query string.

Arguments:
  <query>              The search query

Options:
  --mode <mode>        Search mode: vector, fulltext, graph, or hybrid (default: hybrid)
  --domains <list>     Comma-separated list of domains to search within
  --tags <list>        Comma-separated list of tags to filter by
  --limit <N>          Maximum number of results to return
  --budget <N>         Token budget for results
  --min-score <N>      Minimum relevance score threshold

Examples:
  active-memory search "project deadlines" --mode vector --limit 5
  active-memory search "shopping list" --domains personal --tags shopping
`.trim(),

  ask: `
Usage: active-memory ask <question> [--domains d1,d2] [--tags t1,t2] [--budget N] [--limit N]

Ask a natural language question and retrieve relevant memories as an answer.

Arguments:
  <question>           The question to ask

Options:
  --domains <list>     Comma-separated list of domains to search within
  --tags <list>        Comma-separated list of tags to filter by
  --budget <N>         Token budget for context
  --limit <N>          Maximum number of memories to consider

Examples:
  active-memory ask "What did I decide about the API design?"
  active-memory ask "What are my current tasks?" --domains work
`.trim(),

  'build-context': `
Usage: active-memory build-context <text> [--domains d1,d2] [--budget N] [--max-memories N]

Build a context block from memories relevant to the provided text.

Arguments:
  <text>               Text to build context around

Options:
  --domains <list>     Comma-separated list of domains to search within
  --budget <N>         Token budget for the context block
  --max-memories <N>   Maximum number of memories to include

Examples:
  active-memory build-context "Summarize the project status" --budget 2000
  active-memory build-context "Auth flow" --domains codebase --max-memories 10
`.trim(),

  domains: `
Usage: active-memory domains

List all available domains and their descriptions.

Examples:
  active-memory domains
  active-memory domains --json
`.trim(),

  domain: `
Usage: active-memory domain <id> <subcommand>

Inspect a specific domain by its ID.

Arguments:
  <id>                 Domain ID

Subcommands:
  structure            Show the domain's data structure
  skills               List all skills registered in the domain
  skill <skill-id>     Show details for a specific skill

Examples:
  active-memory domain codebase structure
  active-memory domain codebase skills
  active-memory domain codebase skill analyze-imports
`.trim(),

  help: `
Usage: active-memory help [<command>]

Show help text. Pass a command name to see detailed help for that command.

Examples:
  active-memory help
  active-memory help search
  active-memory --help
`.trim(),
}

function getHelpText(): string {
  return USAGE
}

function getCommandHelp(command: string): string | null {
  return COMMAND_HELP[command] ?? null
}

export { getHelpText, getCommandHelp }

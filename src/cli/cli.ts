import { parseArgs } from './parse-args.ts'
import { formatOutput } from './format.ts'
import { getHelpText, getCommandHelp } from './commands/help.ts'
import { domainsCommand, domainCommand } from './commands/domains.ts'
import ingestCommand from './commands/ingest.ts'
import searchCommand from './commands/search.ts'
import { askCommand } from './commands/ask.ts'
import { buildContextCommand } from './commands/build-context.ts'
import { loadConfig } from '../config-loader.ts'
import type { CommandHandler, CommandResult } from './types.ts'

const COMMANDS: Record<string, CommandHandler> = {
  ingest: ingestCommand,
  search: searchCommand,
  ask: askCommand,
  'build-context': buildContextCommand,
  domains: domainsCommand,
  domain: domainCommand,
}

async function main(): Promise<void> {
  const parsed = parseArgs(Bun.argv.slice(2))

  // Handle help early (no engine needed)
  if (parsed.command === 'help') {
    const specificHelp = parsed.args[0] ? getCommandHelp(parsed.args[0]) : null
    console.log(specificHelp ?? getHelpText())
    process.exit(0)
  }

  const handler = COMMANDS[parsed.command]
  if (!handler) {
    console.error(`Unknown command: ${parsed.command}\n`)
    console.log(getHelpText())
    process.exit(1)
  }

  // Load engine from config
  let engine
  try {
    const cwd = typeof parsed.flags['cwd'] === 'string' ? parsed.flags['cwd'] : undefined
    const config = typeof parsed.flags['config'] === 'string' ? parsed.flags['config'] : undefined
    engine = await loadConfig(cwd, config)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (parsed.flags.json) {
      console.log(JSON.stringify({ error: message }, null, 2))
    } else {
      console.error(`Error: ${message}`)
    }
    process.exit(1)
  }

  try {
    const result: CommandResult = await handler(engine, parsed)
    const formatCommand = result.formatCommand ?? parsed.command
    const output = formatOutput(formatCommand, result.output, parsed.flags.json === true)

    if (output) {
      console.log(output)
    }

    process.exit(result.exitCode)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const output = formatOutput('error', { error: message }, parsed.flags.json === true)
    console.error(output)
    process.exit(1)
  } finally {
    await engine.close()
  }
}

void main()

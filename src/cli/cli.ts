#!/usr/bin/env node
import { parseArgs } from "./parse-args.js";
import { formatOutput, formatError } from "./format.js";
import { getHelpText, getCommandHelp } from "./commands/help.js";
import { domainsCommand, domainCommand } from "./commands/domains.js";
import { ingestCommand } from "./commands/ingest.js";
import { searchCommand } from "./commands/search.js";
import { askCommand } from "./commands/ask.js";
import { buildContextCommand } from "./commands/build-context.js";
import { writeCommand } from "./commands/write.js";
import { memoryCommand } from "./commands/memory.js";
import { graphCommand } from "./commands/graph.js";
import { scheduleCommand } from "./commands/schedule.js";
import { initCommand } from "./commands/init.js";
import { skillCommand } from "./commands/skill.js";
import { loadConfig } from "../config-loader.js";
import type { CommandHandler, CommandResult } from "./types.js";

const COMMANDS: Record<string, CommandHandler> = {
    init: initCommand,
    ingest: ingestCommand,
    search: searchCommand,
    ask: askCommand,
    "build-context": buildContextCommand,
    domains: domainsCommand,
    domain: domainCommand,
    write: writeCommand,
    memory: memoryCommand,
    graph: graphCommand,
    schedule: scheduleCommand,
    skill: skillCommand,
};

async function main(): Promise<void> {
    const parsed = parseArgs(process.argv.slice(2));

    // Handle help early (no engine needed)
    if (parsed.command === "help") {
        const specificHelp = parsed.args[0] ? getCommandHelp(parsed.args[0]) : null;
        console.log(specificHelp ?? getHelpText());
        process.exit(0);
    }

    const handler = COMMANDS[parsed.command];
    if (!handler) {
        console.error(`Unknown command: ${parsed.command}\n`);
        console.log(getHelpText());
        process.exit(1);
    }

    const pretty = parsed.flags["pretty"] === true;

    // Load engine from config
    let engine;
    try {
        const cwd = typeof parsed.flags["cwd"] === "string" ? parsed.flags["cwd"] : undefined;
        const config =
            typeof parsed.flags["config"] === "string" ? parsed.flags["config"] : undefined;
        engine = await loadConfig(cwd, config);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(formatError("CONFIG_ERROR", message));
        process.exit(1);
    }

    let exitCode = 1;
    try {
        const result: CommandResult = await handler(engine, parsed);

        // Command-level validation errors: output has an error property with exitCode 1
        if (
            result.exitCode !== 0 &&
            result.output &&
            typeof result.output === "object" &&
            "error" in result.output
        ) {
            const errorMsg = (result.output as { error: string }).error;
            console.error(formatError("VALIDATION_ERROR", errorMsg));
            exitCode = result.exitCode;
            return;
        }

        const formatCommand = result.formatCommand ?? parsed.command;
        const output = formatOutput(formatCommand, result.output, pretty);

        if (output) {
            console.log(output);
        }

        exitCode = result.exitCode;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(formatError("COMMAND_ERROR", message));
    } finally {
        await engine.close();
        process.exit(exitCode);
    }
}

void main();

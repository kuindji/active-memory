import type { MemoryEngine } from "../core/engine.ts";

interface GlobalFlags {
    config?: string;
    pretty?: boolean;
    cwd?: string;
}

interface ParsedCommand {
    command: string;
    args: string[];
    flags: GlobalFlags & Record<string, string | boolean | Record<string, string>>;
}

interface CommandResult {
    output: unknown;
    exitCode: number;
    formatCommand?: string;
}

type CommandHandler = (engine: MemoryEngine, parsed: ParsedCommand) => Promise<CommandResult>;

export type { GlobalFlags, ParsedCommand, CommandResult, CommandHandler };

import type { MemoryEngine } from "../core/engine.js";
import { parseArgs } from "../cli/parse-args.js";
import { formatError } from "../cli/format.js";
import { dispatchCommand } from "./dispatch.js";
import type { DispatchResult } from "./dispatch.js";

const READ_ONLY_COMMANDS = [
    "search",
    "build-context",
    "memory",
    "graph",
    "skill",
    "domains",
    "domain",
] as const;

interface LambdaInvocation {
    command: string;
    /**
     * Argv tail *including flags*, e.g. `["query text", "--limit", "5"]`.
     * Do NOT pass a separate `flags` object — flags must be encoded as
     * argv strings, matching the CLI's input contract.
     */
    args: string[];
}

interface LambdaAdapterOptions {
    /**
     * Command allow-list profile.
     * - "read-only" (default): search, build-context, memory, graph, skill, domains, domain
     * - "full": every command in the registry
     * - string[]: custom allow list
     */
    profile?: "read-only" | "full" | readonly string[];
    /** Pretty-render (true) or JSON-render (false). Default: false. */
    pretty?: boolean;
}

type LambdaHandler = (event: LambdaInvocation) => Promise<DispatchResult>;

function invalidPayload(): DispatchResult {
    const code = "INVALID_PAYLOAD";
    const message = "Expected { command: non-empty string, args: string[] }";
    return {
        ok: false,
        exitCode: 2,
        error: { code, message },
        rendered: formatError(code, message),
    };
}

function helpRejected(): DispatchResult {
    const code = "COMMAND_NOT_ALLOWED";
    const message = "Command not allowed: help";
    return {
        ok: false,
        exitCode: 2,
        error: { code, message },
        rendered: formatError(code, message),
    };
}

/**
 * Create a Lambda-shaped handler bound to a long-lived MemoryEngine.
 *
 * Lifecycle: the returned handler NEVER calls `engine.close()`. The caller
 * is expected to construct the engine once at module scope and rely on
 * execution-environment reuse. Per-invocation errors resolve as
 * `{ok: false}`; cold-start engine-init errors propagate out of
 * `engine.initialize()` so Lambda marks the container as failed.
 */
function createLambdaAdapter(
    engine: MemoryEngine,
    options: LambdaAdapterOptions = {},
): LambdaHandler {
    const profile = options.profile ?? "read-only";
    const allow =
        profile === "full" ? undefined : profile === "read-only" ? READ_ONLY_COMMANDS : profile;
    const pretty = options.pretty ?? false;

    return async (event: LambdaInvocation): Promise<DispatchResult> => {
        if (
            !event ||
            typeof event !== "object" ||
            typeof event.command !== "string" ||
            event.command.length === 0 ||
            !Array.isArray(event.args)
        ) {
            return invalidPayload();
        }

        // `help` is a CLI concern, not a Lambda concern.
        if (event.command === "help") {
            return helpRejected();
        }

        const parsed = parseArgs([event.command, ...event.args]);
        return dispatchCommand(engine, parsed, { allow, pretty });
    };
}

export { createLambdaAdapter, READ_ONLY_COMMANDS };
export type { LambdaInvocation, LambdaAdapterOptions, LambdaHandler };

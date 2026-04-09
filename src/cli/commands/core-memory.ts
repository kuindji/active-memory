import type { CommandHandler } from "../types.js";

const coreMemoryCommand: CommandHandler = async (engine, parsed) => {
    const [subcommand] = parsed.args;

    if (!subcommand) {
        return {
            output: { error: "Subcommand is required: add, list, remove" },
            exitCode: 1,
        };
    }

    const domain = parsed.flags["domain"] as string | undefined;
    if (!domain) return { output: { error: "--domain is required" }, exitCode: 1 };

    if (subcommand === "add") {
        const text = parsed.flags["text"] as string | undefined;
        if (!text) return { output: { error: "--text is required" }, exitCode: 1 };
        try {
            const id = await engine.addCoreMemory(domain, text);
            return { output: { id, domain, content: text }, exitCode: 0 };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { output: { error: message }, exitCode: 1 };
        }
    }

    if (subcommand === "list") {
        try {
            const memories = await engine.listCoreMemories(domain);
            return { output: { memories, count: memories.length }, exitCode: 0 };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { output: { error: message }, exitCode: 1 };
        }
    }

    if (subcommand === "remove") {
        const id = parsed.flags["id"] as string | undefined;
        if (!id) return { output: { error: "--id is required" }, exitCode: 1 };
        try {
            await engine.removeCoreMemory(domain, id);
            return { output: { removed: true, id }, exitCode: 0 };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { output: { error: message }, exitCode: 1 };
        }
    }

    return { output: { error: `Unknown subcommand: ${subcommand}` }, exitCode: 1 };
};

export { coreMemoryCommand };

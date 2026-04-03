import { readFileSync } from "node:fs";
import type { IngestOptions } from "../../core/types.js";
import type { CommandHandler } from "../types.js";
import { parseMeta } from "../utils.js";

const ingestCommand: CommandHandler = async (engine, parsed) => {
    let text = parsed.flags["text"] as string | undefined;

    if (!text && !process.stdin.isTTY) {
        text = readFileSync(0, "utf-8").trim();
    }

    if (!text) {
        return { output: { error: "No input text. Use --text or pipe from stdin." }, exitCode: 1 };
    }

    const options: IngestOptions = {};

    if (parsed.flags["domains"]) {
        options.domains = (parsed.flags["domains"] as string).split(",");
    }
    if (parsed.flags["tags"]) {
        options.tags = (parsed.flags["tags"] as string).split(",");
    }
    if (parsed.flags["event-time"]) {
        options.eventTime = Number(parsed.flags["event-time"]);
    }
    if (parsed.flags["skip-dedup"] === true) {
        options.skipDedup = true;
    }

    const meta = parseMeta(parsed.flags);
    if (meta) {
        options.context = meta;
    }

    const result = await engine.ingest(text, options);
    return { output: result, exitCode: 0 };
};

export { ingestCommand };

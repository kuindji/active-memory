import type { CommandHandler } from "../types.js";
import type { AskOptions } from "../../core/types.js";
import { parseMeta } from "../utils.js";

const askCommand: CommandHandler = async (engine, parsed) => {
    const question = parsed.args[0];

    if (!question) {
        return { output: { error: "Question is required." }, exitCode: 1 };
    }

    const options: AskOptions = {};

    if (parsed.flags["domains"]) {
        options.domains = (parsed.flags["domains"] as string).split(",");
    }
    if (parsed.flags["tags"]) {
        options.tags = (parsed.flags["tags"] as string).split(",");
    }
    if (parsed.flags["budget"]) {
        options.budgetTokens = Number(parsed.flags["budget"]);
    }
    if (parsed.flags["limit"]) {
        options.limit = Number(parsed.flags["limit"]);
    }

    const meta = parseMeta(parsed.flags);
    if (meta) {
        options.context = meta;
    }

    const result = await engine.ask(question, options);
    return { output: result, exitCode: 0 };
};

export { askCommand };

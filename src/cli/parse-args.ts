import type { ParsedCommand } from "./types.ts";

const BOOLEAN_FLAGS = new Set(["pretty", "skip-dedup", "help"]);
const REPEATABLE_KV_FLAGS = new Set(["meta", "attr"]);

function parseArgs(argv: string[]): ParsedCommand {
    if (argv.length === 0) {
        return { command: "help", args: [], flags: {} };
    }

    const args: string[] = [];
    const flags: ParsedCommand["flags"] = {};
    let command = "";

    let i = 0;
    while (i < argv.length) {
        const token = argv[i];

        if (token.startsWith("--")) {
            const raw = token.slice(2);
            const eqIdx = raw.indexOf("=");

            if (eqIdx !== -1) {
                const key = raw.slice(0, eqIdx);
                const value = raw.slice(eqIdx + 1);
                if (REPEATABLE_KV_FLAGS.has(key)) {
                    const kvIdx = value.indexOf("=");
                    if (kvIdx !== -1) {
                        const kvKey = value.slice(0, kvIdx);
                        const kvVal = value.slice(kvIdx + 1);
                        const existing = flags[key];
                        if (existing && typeof existing === "object" && !Array.isArray(existing)) {
                            existing[kvKey] = kvVal;
                        } else {
                            flags[key] = { [kvKey]: kvVal };
                        }
                    } else {
                        flags[key] = value;
                    }
                } else {
                    flags[key] = value;
                }
            } else if (BOOLEAN_FLAGS.has(raw)) {
                flags[raw] = true;
            } else {
                const next = argv[i + 1];
                if (next !== undefined && !next.startsWith("--")) {
                    if (REPEATABLE_KV_FLAGS.has(raw)) {
                        const kvIdx = next.indexOf("=");
                        if (kvIdx !== -1) {
                            const kvKey = next.slice(0, kvIdx);
                            const kvVal = next.slice(kvIdx + 1);
                            const existing = flags[raw];
                            if (
                                existing &&
                                typeof existing === "object" &&
                                !Array.isArray(existing)
                            ) {
                                existing[kvKey] = kvVal;
                            } else {
                                flags[raw] = { [kvKey]: kvVal };
                            }
                        } else {
                            flags[raw] = next;
                        }
                    } else {
                        flags[raw] = next;
                    }
                    i++;
                } else {
                    flags[raw] = true;
                }
            }
        } else if (command === "") {
            command = token;
        } else {
            args.push(token);
        }

        i++;
    }

    if (flags["help"] === true) {
        return { command: "help", args, flags };
    }

    if (command === "") {
        return { command: "help", args, flags };
    }

    return { command, args, flags };
}

export { parseArgs };

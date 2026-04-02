import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CommandHandler } from "../types.ts";

const skillCommand: CommandHandler = async (engine, _parsed) => {
    const registry = engine.getDomainRegistry();
    const domains = registry.list();

    const sections: string[] = [];

    // Prepend general CLI guide
    try {
        const cliDir = dirname(fileURLToPath(import.meta.url));
        const cliGuide = await readFile(join(cliDir, "..", "skills", "cli-guide.md"), "utf-8");
        sections.push(cliGuide);
    } catch {
        // CLI guide file missing — skip
    }

    for (const domain of domains) {
        const skills = registry.getExternalSkills(domain.id);
        if (skills.length === 0) continue;

        for (const skill of skills) {
            const content = await registry.getSkillContent(domain.id, skill.id);
            if (content) {
                sections.push(content);
            }
        }
    }

    const combined = sections.join("\n\n---\n\n");

    return {
        output: { content: combined },
        exitCode: 0,
        formatCommand: "skill",
    };
};

export { skillCommand };

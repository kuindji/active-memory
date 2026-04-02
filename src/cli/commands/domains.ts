import type { CommandHandler, CommandResult } from "../types.ts";

const domainsCommand: CommandHandler = (engine, _parsed) => {
    const registry = engine.getDomainRegistry();
    const summaries = registry.listSummaries();
    return Promise.resolve({ output: summaries, exitCode: 0 });
};

const domainCommand: CommandHandler = async (engine, parsed): Promise<CommandResult> => {
    const registry = engine.getDomainRegistry();
    const domainId = parsed.args[0];
    const subcommand = parsed.args[1];

    if (!domainId) {
        return { output: { error: "Domain ID is required" }, exitCode: 1 };
    }

    const domain = registry.get(domainId);
    if (!domain) {
        return { output: { error: `Domain "${domainId}" not found` }, exitCode: 1 };
    }

    if (!subcommand) {
        return {
            output: { error: "Subcommand is required: structure, skills, or skill <skill-id>" },
            exitCode: 1,
        };
    }

    if (subcommand === "structure") {
        const structure = await registry.getStructure(domainId);
        if (!structure) {
            return {
                output: { error: `Domain "${domainId}" has no structure defined` },
                exitCode: 1,
            };
        }
        return {
            output: { domainId, structure },
            exitCode: 0,
            formatCommand: "domain-structure",
        };
    }

    if (subcommand === "skills") {
        const skills = registry.getExternalSkills(domainId);
        return {
            output: { domainId, skills },
            exitCode: 0,
            formatCommand: "domain-skills",
        };
    }

    if (subcommand === "skill") {
        const skillId = parsed.args[2];
        if (!skillId) {
            return { output: { error: "Skill ID is required" }, exitCode: 1 };
        }
        const skill = registry.getSkill(domainId, skillId);
        if (!skill) {
            return {
                output: { error: `Skill "${skillId}" not found in domain "${domainId}"` },
                exitCode: 1,
            };
        }
        const content = await registry.getSkillContent(domainId, skillId);
        return {
            output: { ...skill, content: content ?? "" },
            exitCode: 0,
            formatCommand: "domain-skill",
        };
    }

    return {
        output: {
            error: `Unknown subcommand "${subcommand}". Expected: structure, skills, or skill <skill-id>`,
        },
        exitCode: 1,
    };
};

export { domainsCommand, domainCommand };

import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import type {
    DomainConfig,
    OwnedMemory,
    DomainContext,
    SearchQuery,
    DomainSchedule,
} from "../../core/types.ts";
import { USER_DOMAIN_ID, DEFAULT_CONSOLIDATE_INTERVAL_MS } from "./types.ts";
import type { UserDomainOptions } from "./types.ts";
import { userSkills } from "./skills.ts";
import { consolidateUserProfile } from "./schedules.ts";

function buildSchedules(options?: UserDomainOptions): DomainSchedule[] {
    if (options?.consolidateSchedule?.enabled === false) return [];

    const intervalMs = options?.consolidateSchedule?.intervalMs ?? DEFAULT_CONSOLIDATE_INTERVAL_MS;

    return [
        {
            id: "consolidate-user-profile",
            name: "Consolidate user profile",
            intervalMs,
            run: consolidateUserProfile,
        },
    ];
}

export function createUserDomain(options?: UserDomainOptions): DomainConfig {
    return {
        id: USER_DOMAIN_ID,
        name: "User",
        baseDir: dirname(fileURLToPath(import.meta.url)),
        schema: {
            nodes: [
                {
                    name: "user",
                    fields: [{ name: "userId", type: "string", required: true }],
                    indexes: [{ name: "user_userId_unique", fields: ["userId"], type: "unique" }],
                },
            ],
            edges: [
                {
                    name: "about_user",
                    from: "memory",
                    to: "user",
                    fields: [{ name: "domain", type: "string" }],
                },
            ],
        },
        skills: userSkills,
        async processInboxBatch(_entries: OwnedMemory[], _context: DomainContext): Promise<void> {
            // User domain does not process inbox items
        },
        schedules: buildSchedules(options),
        describe() {
            return "Built-in primitive for tracking facts about individual users. Manages user identity, preferences, expertise, goals, and automatic profile consolidation.";
        },
        search: {
            async expand(query: SearchQuery, context: DomainContext): Promise<SearchQuery> {
                const userId = context.requestContext.userId as string | undefined;
                if (!userId) return query;

                // Check if user node exists
                const userNodeId = `user:${userId}`;
                const userNode = await context.graph.getNode(userNodeId);
                if (!userNode) return query;

                // User exists — future enhancement: augment query with user preferences/expertise
                return query;
            },
        },
    };
}

export const userDomain = createUserDomain();

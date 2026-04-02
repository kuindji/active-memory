import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import type {
    DomainConfig,
    OwnedMemory,
    DomainContext,
    SearchQuery,
    DomainSchedule,
} from "../../core/types.ts";
import { TOPIC_DOMAIN_ID, DEFAULT_MERGE_INTERVAL_MS } from "./types.ts";
import type { TopicDomainOptions } from "./types.ts";
import { topicSkills } from "./skills.ts";
import { mergeSimilarTopics } from "./schedules.ts";

function buildSchedules(options?: TopicDomainOptions): DomainSchedule[] {
    if (options?.mergeSchedule?.enabled === false) return [];

    const intervalMs = options?.mergeSchedule?.intervalMs ?? DEFAULT_MERGE_INTERVAL_MS;

    return [
        {
            id: "merge-similar-topics",
            name: "Merge similar topics",
            intervalMs,
            run: mergeSimilarTopics,
        },
    ];
}

export function createTopicDomain(options?: TopicDomainOptions): DomainConfig {
    return {
        id: TOPIC_DOMAIN_ID,
        name: "Topic",
        schema: {
            nodes: [],
            edges: [
                { name: "subtopic_of", from: "memory", to: "memory" },
                {
                    name: "related_to",
                    from: "memory",
                    to: "memory",
                    fields: [{ name: "strength", type: "float" }],
                },
                {
                    name: "about_topic",
                    from: "memory",
                    to: "memory",
                    fields: [{ name: "domain", type: "string" }],
                },
            ],
        },
        baseDir: dirname(fileURLToPath(import.meta.url)),
        skills: topicSkills,
        async processInboxBatch(_entries: OwnedMemory[], _context: DomainContext): Promise<void> {
            // Topics are created explicitly, not via inbox processing
        },
        schedules: buildSchedules(options),
        describe() {
            return "Built-in primitive for tracking named topics across domains. Manages topic lifecycle, hierarchy, and automatic merging of similar topics.";
        },
        search: {
            expand(query: SearchQuery, _context: DomainContext): Promise<SearchQuery> {
                // Placeholder for future enhancement: expand queries to include topic-linked memories
                return Promise.resolve(query);
            },
        },
    };
}

export const topicDomain = createTopicDomain();

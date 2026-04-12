import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { StringRecordId } from "surrealdb";
import { loadPrompt } from "../core/prompt-loader.js";
import type {
    DomainPlugin,
    DomainContext,
    OwnedMemory,
    SearchQuery,
    GraphApi,
} from "../core/types.js";

interface TopicLinkingOptions {
    /** The domain ID that owns topic memories. Defaults to "topic". */
    topicDomainId?: string;
    /** The tag used to identify topic memories. Defaults to "topic". */
    topicTag?: string;
    /** Minimum similarity score for topic matching. Defaults to 0.8. */
    minScore?: number;
    /** Whether to denormalize topics onto memory records. Defaults to true. */
    denormalize?: boolean;
}

const PLUGIN_BASE_DIR = dirname(fileURLToPath(import.meta.url));

const BATCH_TOPIC_EXTRACTION_SCHEMA = JSON.stringify({
    type: "array",
    items: {
        type: "object",
        properties: {
            index: { type: "number", description: "Zero-based index of the item" },
            topics: {
                type: "array",
                items: { type: "string" },
                description: "Topic names extracted from this item",
            },
        },
        required: ["index", "topics"],
    },
});

function createTopicLinkingPlugin(options?: TopicLinkingOptions): DomainPlugin {
    const topicDomainId = options?.topicDomainId ?? "topic";
    const topicTag = options?.topicTag ?? "topic";
    const minScore = options?.minScore ?? 0.8;
    const denormalize = options?.denormalize ?? true;

    async function linkSingleTopic(
        context: DomainContext,
        memoryId: string,
        topicName: string,
    ): Promise<void> {
        const searchResult = await context.search({
            text: topicName,
            tags: [topicTag],
            minScore,
        });

        let topicId: string;

        if (searchResult.entries.length > 0) {
            topicId = searchResult.entries[0].id;
            const topicAttrs = searchResult.entries[0].domainAttributes[topicDomainId] as
                | Record<string, unknown>
                | undefined;
            const currentCount = (topicAttrs?.mentionCount as number | undefined) ?? 0;

            await context.updateAttributes(topicId, {
                ...topicAttrs,
                mentionCount: currentCount + 1,
                lastMentionedAt: Date.now(),
            });
        } else {
            topicId = await context.writeMemory({
                content: topicName,
                tags: [topicTag],
                ownership: {
                    domain: topicDomainId,
                    attributes: {
                        name: topicName,
                        status: "active",
                        mentionCount: 1,
                        lastMentionedAt: Date.now(),
                        createdBy: context.domain,
                    },
                },
            });
        }

        await context.graph.relate(memoryId, "about_topic", topicId, {
            domain: context.domain,
        });
    }

    async function batchExtractTopics(
        context: DomainContext,
        entries: OwnedMemory[],
    ): Promise<Map<string, string[]>> {
        const result = new Map<string, string[]>();
        const llm = context.llmAt("low");
        const topicPrompt = await loadPrompt(PLUGIN_BASE_DIR, "topic-extraction");

        const numberedItems = entries.map((e, i) => `${i}. ${e.memory.content}`).join("\n\n");

        if (llm.extractStructured) {
            try {
                const raw = (await llm.extractStructured(
                    numberedItems,
                    BATCH_TOPIC_EXTRACTION_SCHEMA,
                    topicPrompt,
                )) as Array<{ index: number; topics: string[] }>;

                for (const item of raw) {
                    if (
                        item.index >= 0 &&
                        item.index < entries.length &&
                        Array.isArray(item.topics)
                    ) {
                        result.set(entries[item.index].memory.id, item.topics);
                    }
                }
                return result;
            } catch {
                // Fall through to sequential fallback
            }
        }

        for (const entry of entries) {
            try {
                const topics = await llm.extract(entry.memory.content);
                result.set(entry.memory.id, topics);
            } catch {
                result.set(entry.memory.id, []);
            }
        }

        return result;
    }

    async function linkToTopicsBatch(
        context: DomainContext,
        entries: OwnedMemory[],
    ): Promise<void> {
        const topicsMap = await batchExtractTopics(context, entries);

        for (const entry of entries) {
            const topicNames = topicsMap.get(entry.memory.id) ?? [];
            const validTopics: string[] = [];
            for (const topicName of topicNames) {
                const trimmed = topicName.trim();
                if (!trimmed) continue;
                await linkSingleTopic(context, entry.memory.id, trimmed);
                validTopics.push(trimmed);
            }

            if (denormalize && validTopics.length > 0) {
                try {
                    await context.graph.query("UPDATE $memId SET topics = $topics", {
                        memId: new StringRecordId(entry.memory.id),
                        topics: validTopics,
                    });
                } catch {
                    /* best-effort denormalization */
                }
            }
        }
    }

    async function findMatchingTopicMemoryIds(text: string, graph: GraphApi): Promise<string[]> {
        try {
            const words = text
                .toLowerCase()
                .split(/\s+/)
                .filter((w) => w.length > 3);
            if (words.length === 0) return [];

            const topicTagId = new StringRecordId(`tag:${topicTag}`);
            const results = await graph.query<Array<{ id: string; content: string }>>(
                `SELECT in as id, (SELECT content FROM ONLY $parent.in).content as content FROM tagged WHERE out = $tagId`,
                { tagId: topicTagId },
            );
            if (!Array.isArray(results) || results.length === 0) return [];

            return results
                .filter((r) => {
                    const content = (r.content ?? "").toLowerCase();
                    return words.some((w) => content.includes(w));
                })
                .map((r) => String(r.id));
        } catch {
            return [];
        }
    }

    return {
        type: "topic-linking",

        schema: {
            nodes: [],
            edges: [
                {
                    name: "about_topic",
                    from: "memory",
                    to: "memory",
                    fields: [{ name: "domain", type: "string" }],
                },
            ],
        },

        hooks: {
            async afterInboxProcess(entries: OwnedMemory[], context: DomainContext): Promise<void> {
                await linkToTopicsBatch(context, entries);
            },

            async expandSearch(query: SearchQuery, context: DomainContext): Promise<SearchQuery> {
                if (!query.text) return query;
                try {
                    const topicIds = await findMatchingTopicMemoryIds(query.text, context.graph);
                    if (topicIds.length === 0) return query;
                    return {
                        ...query,
                        traversal: {
                            from: topicIds,
                            pattern: "<-about_topic<-memory.*",
                            depth: 1,
                        },
                    };
                } catch {
                    return query;
                }
            },

            async bootstrap(context: DomainContext): Promise<void> {
                const domainRef = new StringRecordId(`domain:${context.domain}`);
                const rows = await context.graph.query<
                    Array<{ in: string; attributes: Record<string, unknown> }>
                >(
                    `SELECT in, attributes FROM owned_by WHERE out = $domainId AND in.topics IS NONE`,
                    { domainId: domainRef },
                );
                if (!rows || rows.length === 0) return;

                for (const row of rows) {
                    const topicRows = await context.graph.query<Array<{ content: string }>>(
                        `SELECT (SELECT content FROM ONLY $parent.out).content AS content FROM about_topic WHERE in = $memId`,
                        { memId: new StringRecordId(row.in) },
                    );
                    if (topicRows && topicRows.length > 0) {
                        const topics = topicRows
                            .map((t) => t.content)
                            .filter((c) => typeof c === "string" && c.length > 0);
                        if (topics.length > 0) {
                            await context.graph.query("UPDATE $memId SET topics = $topics", {
                                memId: new StringRecordId(row.in),
                                topics,
                            });
                        }
                    }
                }
            },
        },
    };
}

export type { TopicLinkingOptions };
export { createTopicLinkingPlugin };

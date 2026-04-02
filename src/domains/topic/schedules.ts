import { StringRecordId } from "surrealdb";
import type { DomainContext } from "../../core/types.ts";
import type { TopicAttributes } from "./types.ts";
import { TOPIC_TAG, TOPIC_DOMAIN_ID, MERGE_SIMILARITY_THRESHOLD } from "./types.ts";

export async function mergeSimilarTopics(context: DomainContext): Promise<void> {
    const activeTopics = await context.getMemories({
        tags: [TOPIC_TAG],
        attributes: { status: "active" },
    });

    const mergedInThisRun = new Set<string>();

    for (const topic of activeTopics) {
        if (mergedInThisRun.has(topic.id)) continue;

        const searchResult = await context.search({
            text: topic.content,
            mode: "vector",
            minScore: MERGE_SIMILARITY_THRESHOLD,
        });

        const similarEntries = searchResult.entries.filter((entry) => {
            if (entry.id === topic.id) return false;
            if (mergedInThisRun.has(entry.id)) return false;
            const attrs = entry.domainAttributes[TOPIC_DOMAIN_ID];
            return attrs?.status === "active";
        });

        for (const similar of similarEntries) {
            // Get fresh attributes for the current topic via graph query
            const topicAttrs = await getTopicAttributesFromGraph(context, topic.id);
            const similarAttrs = parseTopicAttributes(similar.domainAttributes[TOPIC_DOMAIN_ID]);

            if (!topicAttrs || !similarAttrs) continue;

            let canonicalId: string;
            let mergedId: string;
            let canonicalAttrs: TopicAttributes;
            let mergedAttrs: TopicAttributes;

            if (topicAttrs.mentionCount > similarAttrs.mentionCount) {
                canonicalId = topic.id;
                mergedId = similar.id;
                canonicalAttrs = topicAttrs;
                mergedAttrs = similarAttrs;
            } else if (similarAttrs.mentionCount > topicAttrs.mentionCount) {
                canonicalId = similar.id;
                mergedId = topic.id;
                canonicalAttrs = similarAttrs;
                mergedAttrs = topicAttrs;
            } else {
                // Equal mentionCount: prefer older createdAt
                if (topic.createdAt <= similar.createdAt) {
                    canonicalId = topic.id;
                    mergedId = similar.id;
                    canonicalAttrs = topicAttrs;
                    mergedAttrs = similarAttrs;
                } else {
                    canonicalId = similar.id;
                    mergedId = topic.id;
                    canonicalAttrs = similarAttrs;
                    mergedAttrs = topicAttrs;
                }
            }

            // Mark the non-canonical as merged
            await context.updateAttributes(mergedId, {
                ...mergedAttrs,
                status: "merged",
                mergedInto: canonicalId,
            });

            // Create related_to edge
            await context.graph.relate(mergedId, "related_to", canonicalId, {
                strength: similar.score,
            });

            // Update canonical's mentionCount and lastMentionedAt
            await context.updateAttributes(canonicalId, {
                ...canonicalAttrs,
                mentionCount: canonicalAttrs.mentionCount + mergedAttrs.mentionCount,
                lastMentionedAt: Date.now(),
            });

            mergedInThisRun.add(mergedId);

            // If current topic got merged, stop processing it
            if (mergedId === topic.id) break;
        }
    }
}

function parseTopicAttributes(raw: Record<string, unknown> | undefined): TopicAttributes | null {
    if (!raw) return null;
    if (
        typeof raw.name !== "string" ||
        typeof raw.status !== "string" ||
        typeof raw.mentionCount !== "number" ||
        typeof raw.lastMentionedAt !== "number" ||
        typeof raw.createdBy !== "string"
    )
        return null;
    return {
        name: raw.name,
        status: raw.status as TopicAttributes["status"],
        mentionCount: raw.mentionCount,
        lastMentionedAt: raw.lastMentionedAt,
        createdBy: raw.createdBy,
        mergedInto: typeof raw.mergedInto === "string" ? raw.mergedInto : undefined,
    };
}

async function getTopicAttributesFromGraph(
    context: DomainContext,
    memoryId: string,
): Promise<TopicAttributes | null> {
    const memRef = new StringRecordId(
        memoryId.startsWith("memory:") ? memoryId : `memory:${memoryId}`,
    );
    const domainRef = new StringRecordId(`domain:${TOPIC_DOMAIN_ID}`);
    const rows = await context.graph.query<{ attributes: Record<string, unknown> }[]>(
        "SELECT attributes FROM owned_by WHERE in = $memId AND out = $domainId",
        { memId: memRef, domainId: domainRef },
    );
    if (!rows || rows.length === 0) return null;
    return parseTopicAttributes(rows[0].attributes);
}

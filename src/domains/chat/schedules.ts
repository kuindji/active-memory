import { StringRecordId } from "surrealdb";
import type { DomainContext } from "../../core/types.ts";
import type { ChatDomainOptions } from "./types.ts";
import {
    CHAT_DOMAIN_ID,
    CHAT_TAG,
    CHAT_EPISODIC_TAG,
    CHAT_SEMANTIC_TAG,
    DEFAULT_WORKING_CAPACITY,
    DEFAULT_WORKING_MAX_AGE,
    DEFAULT_CONSOLIDATION_SIMILARITY,
    DEFAULT_CONSOLIDATION_MIN_CLUSTER,
    DEFAULT_EPISODIC_LAMBDA,
    DEFAULT_PRUNE_THRESHOLD,
} from "./types.ts";
import { ensureTag } from "./utils.ts";

interface WorkingMemoryRow {
    in: string;
    attributes: Record<string, unknown>;
}

export async function promoteWorkingMemory(
    context: DomainContext,
    options?: ChatDomainOptions,
): Promise<void> {
    await context.debug.time("chat.schedule.promote", async () => {
        const capacity = options?.workingMemoryCapacity ?? DEFAULT_WORKING_CAPACITY;
        const maxAge = options?.workingMemoryMaxAge ?? DEFAULT_WORKING_MAX_AGE;

        const rows = await context.graph.query<WorkingMemoryRow[]>(
            'SELECT in, attributes FROM owned_by WHERE out = $domainId AND attributes.layer = "working"',
            { domainId: new StringRecordId(`domain:${CHAT_DOMAIN_ID}`) },
        );
        if (!rows || rows.length === 0) return;

        const groups = new Map<string, { memId: string; attrs: Record<string, unknown> }[]>();
        for (const row of rows) {
            const memId = String(row.in);
            const attrs = row.attributes;
            const userId = typeof attrs.userId === "string" ? attrs.userId : "";
            const chatSessionId =
                typeof attrs.chatSessionId === "string" ? attrs.chatSessionId : "";
            const key = `${userId}::${chatSessionId}`;

            let group = groups.get(key);
            if (!group) {
                group = [];
                groups.set(key, group);
            }
            group.push({ memId, attrs });
        }

        const now = Date.now();

        for (const group of groups.values()) {
            const toPromote: { memId: string; attrs: Record<string, unknown> }[] = [];

            group.sort((a, b) => {
                const idxA = (a.attrs.messageIndex as number) ?? 0;
                const idxB = (b.attrs.messageIndex as number) ?? 0;
                return idxA - idxB;
            });

            for (const item of group) {
                const memory = await context.getMemory(item.memId);
                if (memory && now - memory.createdAt > maxAge) {
                    toPromote.push(item);
                }
            }

            if (group.length > capacity) {
                const overCapacityCount = group.length - capacity;
                for (let i = 0; i < overCapacityCount; i++) {
                    if (!toPromote.some((p) => p.memId === group[i].memId)) {
                        toPromote.push(group[i]);
                    }
                }
            }

            if (toPromote.length === 0) continue;

            const contents: string[] = [];
            const promotedIds: string[] = [];
            for (const item of toPromote) {
                const memory = await context.getMemory(item.memId);
                if (memory) {
                    contents.push(memory.content);
                    promotedIds.push(item.memId);
                }
            }

            if (contents.length === 0) continue;

            const facts = await context.debug.time(
                "chat.schedule.promote.extractFacts",
                () => context.llmAt("low").extract(contents.join("\n")),
                { memories: promotedIds.length },
            );
            if (!facts || facts.length === 0) {
                for (const memId of promotedIds) {
                    await context.releaseOwnership(memId, CHAT_DOMAIN_ID);
                }
                continue;
            }

            const sampleAttrs = toPromote[0].attrs;
            const userId = typeof sampleAttrs.userId === "string" ? sampleAttrs.userId : "";
            const chatSessionId =
                typeof sampleAttrs.chatSessionId === "string" ? sampleAttrs.chatSessionId : "";

            const chatTagId = await ensureTag(context, CHAT_TAG);
            const episodicTagId = await ensureTag(context, CHAT_EPISODIC_TAG);
            try {
                await context.graph.relate(episodicTagId, "child_of", chatTagId);
            } catch {
                /* already related */
            }

            for (const fact of facts) {
                const episodicId = await context.writeMemory({
                    content: fact,
                    tags: [CHAT_TAG, CHAT_EPISODIC_TAG],
                    ownership: {
                        domain: CHAT_DOMAIN_ID,
                        attributes: {
                            layer: "episodic",
                            userId,
                            chatSessionId,
                            weight: 1.0,
                        },
                    },
                });

                for (const memId of promotedIds) {
                    await context.graph.relate(episodicId, "summarizes", memId);
                }
            }

            for (const memId of promotedIds) {
                await context.releaseOwnership(memId, CHAT_DOMAIN_ID);
            }
        }
    });
}

export async function consolidateEpisodic(
    context: DomainContext,
    options?: ChatDomainOptions,
): Promise<void> {
    await context.debug.time("chat.schedule.consolidate", async () => {
        const similarityThreshold =
            options?.consolidation?.similarityThreshold ?? DEFAULT_CONSOLIDATION_SIMILARITY;
        const minClusterSize =
            options?.consolidation?.minClusterSize ?? DEFAULT_CONSOLIDATION_MIN_CLUSTER;

        const episodicMemories = await context.getMemories({
            tags: [CHAT_EPISODIC_TAG],
            attributes: { layer: "episodic" },
        });

        if (episodicMemories.length < minClusterSize) return;

        const clustered = new Set<string>();
        const clusters: string[][] = [];

        for (const memory of episodicMemories) {
            if (clustered.has(memory.id)) continue;

            const searchResult = await context.search({
                text: memory.content,
                tags: [CHAT_EPISODIC_TAG],
                attributes: { layer: "episodic" },
                minScore: similarityThreshold,
            });

            const clusterMembers = searchResult.entries
                .filter((entry) => !clustered.has(entry.id))
                .map((entry) => entry.id);

            if (clusterMembers.length >= minClusterSize) {
                clusters.push(clusterMembers);
                for (const id of clusterMembers) {
                    clustered.add(id);
                }
            }
        }

        for (const cluster of clusters) {
            const contents: string[] = [];
            for (const memId of cluster) {
                const memory = await context.getMemory(memId);
                if (memory) {
                    contents.push(memory.content);
                }
            }

            if (contents.length === 0) continue;

            const summary = await context.debug.time(
                "chat.schedule.consolidate.summary",
                () => context.llmAt("medium").consolidate(contents),
                { memories: contents.length },
            );
            if (!summary) continue;

            const chatTagId = await ensureTag(context, CHAT_TAG);
            const semanticTagId = await ensureTag(context, CHAT_SEMANTIC_TAG);
            try {
                await context.graph.relate(semanticTagId, "child_of", chatTagId);
            } catch {
                /* already related */
            }

            const semanticId = await context.writeMemory({
                content: summary,
                tags: [CHAT_TAG, CHAT_SEMANTIC_TAG],
                ownership: {
                    domain: CHAT_DOMAIN_ID,
                    attributes: {
                        layer: "semantic",
                        weight: 0.8,
                    },
                },
            });

            for (const memId of cluster) {
                await context.graph.relate(semanticId, "summarizes", memId);
            }
        }
    });
}

export async function pruneDecayed(
    context: DomainContext,
    options?: ChatDomainOptions,
): Promise<void> {
    await context.debug.time("chat.schedule.prune", async () => {
        const lambda = options?.decay?.episodicLambda ?? DEFAULT_EPISODIC_LAMBDA;
        const threshold = options?.decay?.pruneThreshold ?? DEFAULT_PRUNE_THRESHOLD;

        const rows = await context.graph.query<WorkingMemoryRow[]>(
            'SELECT in, attributes FROM owned_by WHERE out = $domainId AND attributes.layer = "episodic"',
            { domainId: new StringRecordId(`domain:${CHAT_DOMAIN_ID}`) },
        );
        if (!rows || rows.length === 0) return;

        const now = Date.now();

        for (const row of rows) {
            const memId = String(row.in);
            const weight = typeof row.attributes.weight === "number" ? row.attributes.weight : 1.0;

            const memory = await context.getMemory(memId);
            if (!memory) continue;

            const hoursSinceCreation = (now - memory.createdAt) / (1000 * 60 * 60);
            const decayedWeight = weight * Math.exp(-lambda * hoursSinceCreation);

            if (decayedWeight < threshold) {
                await context.releaseOwnership(memId, CHAT_DOMAIN_ID);
            }
        }
    });
}

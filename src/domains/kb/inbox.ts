import { StringRecordId } from "surrealdb";
import type { OwnedMemory, DomainContext, ScoredMemory } from "../../core/types.js";
import { KB_TAG, KB_DOMAIN_ID, DECOMPOSITION_TOKEN_THRESHOLD } from "./types.js";
import type { KbClassification } from "./types.js";
import {
    ensureTag,
    linkToTopicsBatch,
    classificationToTag,
    decomposeToAtomicFacts,
    batchGenerateQuestions,
} from "./utils.js";
import { countTokens } from "../../core/scoring.js";

interface DecomposeResult {
    processable: OwnedMemory[];
    decomposedParents: OwnedMemory[];
}

function logKbInboxWarning(scope: string, error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(`[memory-domain warning] ${scope}: ${errorMessage}`);
}

const VALID_CLASSIFICATIONS = new Set<string>([
    "fact",
    "definition",
    "how-to",
    "reference",
    "concept",
    "insight",
]);

const BATCH_CLASSIFICATION_PROMPT =
    "Classify each numbered item into exactly one knowledge category.\n\n" +
    "Categories:\n" +
    "- fact: A specific, verifiable data point or business rule. " +
    'Example: "TheFloorr uses Rakuten, CJ, Partnerize, and ProductsUp as affiliate networks."\n' +
    "- definition: Explains WHAT something IS — defines a term, role, or entity. Answers 'what is X?' " +
    'Example: "A PSE (Personal Shopper Entrepreneur) is a stylist who curates fashion for clients."\n' +
    "- how-to: Step-by-step process, procedure, or recipe. Answers 'how do I do X?' " +
    'Example: "To place an order: 1) select products, 2) generate a trackable link, 3) share with client."\n' +
    "- reference: Describes how a system, feature, or specification WORKS — its structure, rules, " +
    "configuration, or operational details. Answers 'how does X work?' " +
    'Example: "Products are partitioned into 16 search indices by gender, region, and price type."\n' +
    "- concept: An abstract principle, mental model, or framework for understanding. " +
    'Example: "Attribution connects a purchase back to the stylist who generated the trackable link."\n' +
    "- insight: A personal conclusion, learned lesson, or practical recommendation. " +
    'Example: "In practice, most payment delays are caused by pending network approvals."\n\n' +
    "KEY DISTINCTION: 'definition' answers 'what IS this thing?' while 'reference' answers " +
    "'how does this thing WORK?' If the text describes system behavior, feature specs, rules, " +
    "or configuration details, choose 'reference' not 'definition'.\n\n";

const BATCH_CLASSIFICATION_SCHEMA = JSON.stringify({
    type: "array",
    items: {
        type: "object",
        properties: {
            index: { type: "number", description: "Zero-based index of the item" },
            classification: {
                type: "string",
                enum: ["fact", "definition", "how-to", "reference", "concept", "insight"],
                description: "The knowledge category for this item",
            },
        },
        required: ["index", "classification"],
    },
});

const BATCH_SUPERSESSION_SCHEMA = JSON.stringify({
    type: "array",
    items: {
        type: "object",
        properties: {
            newIndex: { type: "number", description: "Zero-based index of the new entry" },
            existingId: { type: "string", description: "ID of the superseded existing entry" },
        },
        required: ["newIndex", "existingId"],
    },
});

const BATCH_RELATIONSHIP_SCHEMA = JSON.stringify({
    type: "array",
    items: {
        type: "object",
        properties: {
            newIndex: { type: "number", description: "Zero-based index of the new entry" },
            existingId: { type: "string", description: "ID of the related existing entry" },
            relationship: {
                type: "string",
                enum: ["prerequisite", "example-of", "contrast", "elaboration"],
                description: "How the new entry relates to the existing one",
            },
        },
        required: ["newIndex", "existingId", "relationship"],
    },
});

const SUPERSESSION_PROMPT_BUDGET = 4000;

export async function processInboxBatch(
    entries: OwnedMemory[],
    context: DomainContext,
): Promise<void> {
    await context.debug.time(
        "kb.inbox.total",
        async () => {
            // Stage 0: Atomic Fact Decomposition
            const { processable: processableEntries, decomposedParents } = await context.debug.time(
                "kb.inbox.decompose",
                () => decomposeEntries(entries, context),
                { entries: entries.length },
            );

            // Stage 1: Classification
            const classificationMap = await context.debug.time(
                "kb.inbox.classify",
                () => batchClassify(processableEntries, context),
                { entries: processableEntries.length },
            );

            // Classify decomposed parents (not included in later stages)
            if (decomposedParents.length > 0) {
                const parentClassificationMap = await context.debug.time(
                    "kb.inbox.classifyParents",
                    () => batchClassify(decomposedParents, context),
                    { entries: decomposedParents.length },
                );
                for (const parent of decomposedParents) {
                    const classification = parentClassificationMap.get(parent.memory.id) ?? "fact";
                    await context.updateAttributes(parent.memory.id, {
                        ...parent.domainAttributes,
                        decomposed: true,
                        classification,
                    });
                }
            }

            // Stage 1.5: Question generation (what question does this entry answer?)
            const questionMap = await context.debug.time(
                "kb.inbox.questionGeneration",
                () => batchGenerateQuestions(context, processableEntries),
                { entries: processableEntries.length },
            );

            // Stage 2: Tag & Attribute assignment
            const kbTagId = await ensureTag(context, KB_TAG);

            await context.debug.time(
                "kb.inbox.tagAndAttribute",
                async () => {
                    for (const entry of processableEntries) {
                        const classification = classificationMap.get(entry.memory.id) ?? "fact";
                        const existingSource = entry.domainAttributes.source as string | undefined;
                        const existingParentId = entry.domainAttributes.parentMemoryId as
                            | string
                            | undefined;
                        const answersQuestion = questionMap.get(entry.memory.id);

                        await context.updateAttributes(entry.memory.id, {
                            classification,
                            superseded: false,
                            validFrom: Date.now(),
                            confidence: 1.0,
                            ...(existingSource ? { source: existingSource } : {}),
                            ...(existingParentId ? { parentMemoryId: existingParentId } : {}),
                            ...(answersQuestion ? { answersQuestion } : {}),
                        });

                        await context.tagMemory(entry.memory.id, kbTagId);

                        const classTag = classificationToTag(classification as KbClassification);
                        const classTagId = await ensureTag(context, classTag);
                        try {
                            await context.graph.relate(classTagId, "child_of", kbTagId);
                        } catch {
                            /* already related */
                        }
                        await context.tagMemory(entry.memory.id, classTagId);

                        // Denormalize classification and answers_question onto memory record
                        try {
                            const updates: Record<string, unknown> = { classification };
                            if (answersQuestion) {
                                updates.answers_question = answersQuestion;
                            }
                            await context.graph.query(
                                "UPDATE $memId SET classification = $cls, answers_question = $aq",
                                {
                                    memId: new StringRecordId(entry.memory.id),
                                    cls: classification,
                                    aq: answersQuestion ?? null,
                                },
                            );
                        } catch {
                            /* best-effort denormalization */
                        }
                    }
                },
                { entries: processableEntries.length },
            );

            // Stage 3: Topic linking
            await context.debug.time(
                "kb.inbox.topicLinking",
                () => linkToTopicsBatch(context, processableEntries),
                { entries: processableEntries.length },
            );

            // Stage 4: Supersession detection
            await context.debug.time(
                "kb.inbox.supersessionDetection",
                () => batchDetectSupersession(processableEntries, classificationMap, context),
                { entries: processableEntries.length },
            );

            // Stage 5: Related knowledge linking
            await context.debug.time(
                "kb.inbox.relatedLinking",
                () => batchLinkRelated(processableEntries, classificationMap, context),
                { entries: processableEntries.length },
            );
        },
        { entries: entries.length },
    );
}

async function decomposeEntries(
    entries: OwnedMemory[],
    context: DomainContext,
): Promise<DecomposeResult> {
    const processable: OwnedMemory[] = [];
    const decomposedParents: OwnedMemory[] = [];

    for (const entry of entries) {
        const tokens = countTokens(entry.memory.content);
        if (tokens <= DECOMPOSITION_TOKEN_THRESHOLD) {
            processable.push(entry);
            continue;
        }

        const atomicFacts = await decomposeToAtomicFacts(entry.memory.content, context);
        if (!atomicFacts || atomicFacts.length <= 1) {
            processable.push(entry);
            continue;
        }

        // Mark parent as decomposed
        await context.updateAttributes(entry.memory.id, {
            ...entry.domainAttributes,
            decomposed: true,
        });

        // Track parent for separate classification
        decomposedParents.push(entry);

        // Create child memories
        for (const fact of atomicFacts) {
            const childId = await context.writeMemory({
                content: fact.claim,
                tags: [KB_TAG],
                ownership: {
                    domain: KB_DOMAIN_ID,
                    attributes: {
                        source: "decomposed",
                        parentMemoryId: entry.memory.id,
                        ...(fact.classification ? { classification: fact.classification } : {}),
                    },
                },
            });

            // Link child to parent
            await context.graph.relate(childId, "refines", entry.memory.id);

            // Fetch child memory for subsequent stages
            const childMemory = await context.getMemory(childId);
            if (childMemory) {
                processable.push({
                    memory: childMemory,
                    domainAttributes: {
                        source: "decomposed",
                        parentMemoryId: entry.memory.id,
                        ...(fact.classification ? { classification: fact.classification } : {}),
                    },
                    tags: [KB_TAG],
                });
            }
        }
    }

    return { processable, decomposedParents };
}

async function batchClassify(
    entries: OwnedMemory[],
    context: DomainContext,
): Promise<Map<string, string>> {
    const result = new Map<string, string>();

    const needsClassification: { entry: OwnedMemory; index: number }[] = [];
    for (let i = 0; i < entries.length; i++) {
        const existing = entries[i].domainAttributes.classification as string | undefined;
        if (existing && VALID_CLASSIFICATIONS.has(existing)) {
            result.set(entries[i].memory.id, existing);
        } else {
            needsClassification.push({ entry: entries[i], index: i });
        }
    }

    if (needsClassification.length === 0) return result;

    const classifyLlm = context.llmAt("low");

    const numberedItems = needsClassification
        .map((item, i) => `${i}. ${item.entry.memory.content}`)
        .join("\n\n");

    if (classifyLlm.extractStructured) {
        try {
            const raw = (await classifyLlm.extractStructured(
                `Items:\n${numberedItems}`,
                BATCH_CLASSIFICATION_SCHEMA,
                BATCH_CLASSIFICATION_PROMPT,
            )) as Array<{ index: number; classification: string }>;

            for (const item of raw) {
                if (item.index >= 0 && item.index < needsClassification.length) {
                    const cls = VALID_CLASSIFICATIONS.has(item.classification)
                        ? item.classification
                        : "fact";
                    result.set(needsClassification[item.index].entry.memory.id, cls);
                }
            }
        } catch (error) {
            logKbInboxWarning("kb.inbox.classify.extractStructured", error);
        }
    } else if (classifyLlm.generate) {
        try {
            const prompt =
                BATCH_CLASSIFICATION_PROMPT +
                `Items:\n${numberedItems}\n\n` +
                "Respond with ONLY one category per line, matching the item number:\n" +
                needsClassification.map((_, i) => `${i}. <category>`).join("\n");

            const response = await classifyLlm.generate(prompt);
            const lines = response.trim().split("\n");

            for (let i = 0; i < needsClassification.length; i++) {
                const line = lines[i]?.trim().toLowerCase() ?? "";
                const match = line.match(/^\d+\.\s*(.+)$/);
                const normalized = match ? match[1].trim() : line;
                if (VALID_CLASSIFICATIONS.has(normalized)) {
                    result.set(needsClassification[i].entry.memory.id, normalized);
                }
            }
        } catch (error) {
            logKbInboxWarning("kb.inbox.classify.generate", error);
        }
    }

    // Fill any unclassified entries with default
    for (const { entry } of needsClassification) {
        if (!result.has(entry.memory.id)) {
            result.set(entry.memory.id, "fact");
        }
    }

    return result;
}

async function batchDetectSupersession(
    entries: OwnedMemory[],
    classificationMap: Map<string, string>,
    context: DomainContext,
): Promise<void> {
    const llm = context.llmAt("low");
    if (!llm.extractStructured) return;

    const newEntryIds = new Set(entries.map((e) => e.memory.id));

    // Collect existing non-superseded entries that are similar to new ones
    const existingMap = new Map<string, ScoredMemory>();

    for (const entry of entries) {
        const classification = classificationMap.get(entry.memory.id) ?? "fact";
        const classTag = classificationToTag(classification as KbClassification);

        const searchResult = await context.search({
            text: entry.memory.content,
            tags: [classTag],
            minScore: 0.7,
        });

        for (const existing of searchResult.entries) {
            if (newEntryIds.has(existing.id)) continue;
            const attrs = existing.domainAttributes[KB_DOMAIN_ID] as
                | Record<string, unknown>
                | undefined;
            if (attrs && !attrs.superseded) {
                existingMap.set(existing.id, existing);
            }
        }
    }

    const existingEntries = [...existingMap.values()];
    if (existingEntries.length === 0) return;

    const batches = buildSupersessionBatches(entries, existingEntries);

    for (const batch of batches) {
        await processSupersessionBatch(batch.newEntries, batch.existingEntries, context);
    }
}

interface SupersessionBatch {
    newEntries: OwnedMemory[];
    existingEntries: ScoredMemory[];
}

function buildSupersessionBatches(
    newEntries: OwnedMemory[],
    existingEntries: ScoredMemory[],
): SupersessionBatch[] {
    const batches: SupersessionBatch[] = [];
    const existingLengths = existingEntries.map((e) => e.content.length);
    const totalExistingLength = existingLengths.reduce((sum, l) => sum + l, 0);

    let currentNew: OwnedMemory[] = [];
    let currentPromptLength = totalExistingLength;

    for (const entry of newEntries) {
        const entryLength = entry.memory.content.length;
        const projectedLength = currentPromptLength + entryLength;

        if (currentNew.length > 0 && projectedLength > SUPERSESSION_PROMPT_BUDGET) {
            batches.push({ newEntries: currentNew, existingEntries });
            currentNew = [];
            currentPromptLength = totalExistingLength;
        }

        currentNew.push(entry);
        currentPromptLength += entryLength;
    }

    if (currentNew.length > 0) {
        batches.push({ newEntries: currentNew, existingEntries });
    }

    return batches;
}

async function processSupersessionBatch(
    newEntries: OwnedMemory[],
    existingEntries: ScoredMemory[],
    context: DomainContext,
): Promise<void> {
    const llm = context.llmAt("low");
    if (!llm.extractStructured) return;

    const newItems = newEntries.map((e, i) => `${i}. ${e.memory.content}`).join("\n");

    const existingItems = existingEntries.map((e) => `[${e.id}] ${e.content}`).join("\n");

    const prompt =
        "For each new knowledge entry, identify which existing entries it supersedes (if any). " +
        "An entry is superseded when the new entry corrects, updates, or replaces the existing one. " +
        "Only flag true supersession — not mere similarity or overlap.\n\n" +
        `New entries:\n${newItems}\n\n` +
        `Existing entries:\n${existingItems}\n\n` +
        "Return only actual supersessions. If none exist, return an empty array.";

    try {
        const pairs = (await llm.extractStructured(
            prompt,
            BATCH_SUPERSESSION_SCHEMA,
            "Identify superseded knowledge pairs.",
        )) as Array<{ newIndex: number; existingId: string }>;

        for (const pair of pairs) {
            if (pair.newIndex < 0 || pair.newIndex >= newEntries.length) continue;
            const newMemoryId = newEntries[pair.newIndex].memory.id;
            const existing = existingEntries.find((e) => e.id === pair.existingId);
            if (!existing) continue;

            await context.graph.relate(newMemoryId, "supersedes", existing.id);
            await context.updateAttributes(existing.id, {
                ...existing.domainAttributes[KB_DOMAIN_ID],
                superseded: true,
                validUntil: Date.now(),
            });
        }
    } catch (error) {
        logKbInboxWarning("kb.inbox.supersessionDetection", error);
    }
}

async function batchLinkRelated(
    entries: OwnedMemory[],
    classificationMap: Map<string, string>,
    context: DomainContext,
): Promise<void> {
    const llm = context.llmAt("low");
    if (!llm.extractStructured) return;

    const newEntryIds = new Set(entries.map((e) => e.memory.id));
    const relatedMap = new Map<string, ScoredMemory>();

    for (const entry of entries) {
        const searchResult = await context.search({
            text: entry.memory.content,
            tags: [KB_TAG],
            minScore: 0.75,
        });

        for (const candidate of searchResult.entries) {
            if (newEntryIds.has(candidate.id)) continue;
            const attrs = candidate.domainAttributes[KB_DOMAIN_ID] as
                | Record<string, unknown>
                | undefined;
            if (attrs?.superseded) continue;
            relatedMap.set(candidate.id, candidate);
        }
    }

    const relatedEntries = [...relatedMap.values()];
    if (relatedEntries.length === 0) return;

    const newItems = entries
        .map(
            (e, i) => `${i}. [${classificationMap.get(e.memory.id) ?? "fact"}] ${e.memory.content}`,
        )
        .join("\n");

    const existingItems = relatedEntries.map((e) => `[${e.id}] ${e.content}`).join("\n");

    const prompt =
        "For each new knowledge entry, identify which existing entries are directly related (but NOT superseded). " +
        "Describe the relationship type: prerequisite (must understand this first), example-of (illustrates a concept), " +
        "contrast (presents an opposing or alternative view), elaboration (adds detail to existing knowledge).\n\n" +
        `New entries:\n${newItems}\n\n` +
        `Existing entries:\n${existingItems}\n\n` +
        "Return only meaningful relationships. If none exist, return an empty array.";

    try {
        const relationships = (await llm.extractStructured(
            prompt,
            BATCH_RELATIONSHIP_SCHEMA,
            "Identify related knowledge pairs.",
        )) as Array<{ newIndex: number; existingId: string; relationship: string }>;

        for (const rel of relationships) {
            if (rel.newIndex < 0 || rel.newIndex >= entries.length) continue;
            const newMemoryId = entries[rel.newIndex].memory.id;
            const existing = relatedEntries.find((e) => e.id === rel.existingId);
            if (!existing) continue;

            try {
                await context.graph.relate(newMemoryId, "related_knowledge", existing.id, {
                    relationship: rel.relationship,
                });
            } catch {
                // Best-effort
            }
        }
    } catch (error) {
        logKbInboxWarning("kb.inbox.relatedLinking", error);
    }
}

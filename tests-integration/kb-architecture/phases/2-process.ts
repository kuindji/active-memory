import type {
    ArchitectureConfig,
    Dataset,
    IngestedData,
    ProcessedData,
    ProcessedEntry,
} from "../types.js";
import { readDataset, readCheckpoint, writeCheckpoint } from "../checkpoint.js";
import { drainInbox } from "../engine-factory.js";
import { KB_DOMAIN_ID } from "../../../src/domains/kb/types.js";
import type { MemoryEngine } from "../../../src/core/engine.js";

export async function runProcess(
    config: ArchitectureConfig,
    engine: MemoryEngine,
): Promise<ProcessedData> {
    const dataset = readDataset<Dataset>();
    const ingested = readCheckpoint<IngestedData>(config.name, 1);
    const start = performance.now();

    console.log(`\n[Phase 2: Process] Config: "${config.name}"`);
    console.log(
        `  Pipeline: classify=${config.pipeline.classify} tag=${config.pipeline.tagAssign} topic=${config.pipeline.topicLink} supersede=${config.pipeline.supersede} relate=${config.pipeline.relateKnowledge}`,
    );

    await drainInbox(engine);

    const ctx = engine.createDomainContext(KB_DOMAIN_ID);
    const processedEntries: ProcessedEntry[] = [];

    let correctClassifications = 0;
    let totalClassified = 0;

    for (const datasetEntry of dataset.entries) {
        const memoryId = ingested.data.memoryIdMap[datasetEntry.id];
        if (!memoryId) continue;

        const edges = await ctx.getNodeEdges(memoryId, "out");
        let assignedClassification = "unknown";
        const supersessionEdges: string[] = [];
        const relatedEdges: string[] = [];

        for (const edge of edges) {
            const edgeId = typeof edge.id === "string" ? edge.id : String(edge.id);
            if (edgeId.startsWith("owned_by:")) {
                const attrs = edge as unknown as Record<string, unknown>;
                if (typeof attrs.attributes === "object" && attrs.attributes !== null) {
                    const ownAttrs = attrs.attributes as Record<string, unknown>;
                    if (typeof ownAttrs.classification === "string") {
                        assignedClassification = ownAttrs.classification;
                    }
                }
            }
            if (edgeId.startsWith("supersedes:")) {
                supersessionEdges.push(String(edge.in));
            }
            if (edgeId.startsWith("related_knowledge:")) {
                relatedEdges.push(String(edge.in));
            }
        }

        const inEdges = await ctx.getNodeEdges(memoryId, "in");
        for (const edge of inEdges) {
            const edgeId = typeof edge.id === "string" ? edge.id : String(edge.id);
            if (edgeId.startsWith("supersedes:")) {
                supersessionEdges.push(String(edge.out));
            }
        }

        if (assignedClassification !== "unknown") {
            totalClassified++;
            if (assignedClassification === datasetEntry.expectedClassification) {
                correctClassifications++;
            }
        }

        processedEntries.push({
            datasetId: datasetEntry.id,
            memoryId,
            assignedClassification,
            expectedClassification: datasetEntry.expectedClassification,
            supersessionEdges,
            relatedEdges,
        });
    }

    const classificationAccuracy =
        totalClassified > 0 ? correctClassifications / totalClassified : 0;
    const durationMs = performance.now() - start;

    const data: ProcessedData = {
        entries: processedEntries,
        stageTiming: {},
        classificationAccuracy,
    };

    writeCheckpoint(config.name, 2, data, durationMs);

    const factCount = processedEntries.filter((e) => e.assignedClassification === "fact").length;
    const factRatio = totalClassified > 0 ? factCount / totalClassified : 0;

    console.log(`[Phase 2] Classification accuracy: ${(classificationAccuracy * 100).toFixed(1)}%`);
    console.log(
        `[Phase 2] Fact ratio: ${(factRatio * 100).toFixed(1)}% (${factCount}/${totalClassified})`,
    );
    console.log(`[Phase 2] Duration: ${(durationMs / 1000).toFixed(1)}s`);

    if (factRatio > 0.5 && config.pipeline.classify) {
        console.warn(
            `[Phase 2 WARNING] >50% entries classified as "fact" — possible classification failure`,
        );
    }

    return data;
}

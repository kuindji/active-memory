import type { ArchitectureConfig, ConsolidatedData } from "../types.js";
import { writeCheckpoint } from "../checkpoint.js";
import { consolidateKnowledge } from "../../../src/domains/kb/schedules.js";
import { KB_DOMAIN_ID } from "../../../src/domains/kb/types.js";
import type { MemoryEngine } from "../../../src/core/engine.js";

export async function runConsolidate(
    config: ArchitectureConfig,
    engine: MemoryEngine,
): Promise<ConsolidatedData> {
    if (!config.consolidate) {
        console.log(
            `\n[Phase 3: Consolidate] Skipped (consolidation disabled for "${config.name}")`,
        );
        const data: ConsolidatedData = {
            clustersFound: 0,
            mergesPerformed: 0,
            durationMs: 0,
        };
        writeCheckpoint(config.name, 3, data, 0);
        return data;
    }

    const start = performance.now();
    console.log(`\n[Phase 3: Consolidate] Config: "${config.name}"`);

    const ctx = engine.createDomainContext(KB_DOMAIN_ID);
    await consolidateKnowledge(ctx);

    const durationMs = performance.now() - start;

    const searchResult = await ctx.search({
        tags: ["kb"],
        attributes: { source: "consolidated" },
    });
    const mergesPerformed = searchResult.entries.length;

    const data: ConsolidatedData = {
        clustersFound: mergesPerformed,
        mergesPerformed,
        durationMs,
    };

    writeCheckpoint(config.name, 3, data, durationMs);
    console.log(
        `[Phase 3] Merges: ${mergesPerformed}, Duration: ${(durationMs / 1000).toFixed(1)}s`,
    );

    return data;
}

import type {
    ArchitectureConfig,
    Dataset,
    IngestedData,
    EvaluationData,
    EvaluationEntry,
} from "../types.js";
import { readDataset, readCheckpoint, writeCheckpoint } from "../checkpoint.js";
import { KB_DOMAIN_ID } from "../../../src/domains/kb/types.js";
import type { MemoryEngine } from "../../../src/core/engine.js";

export async function runEvaluate(
    config: ArchitectureConfig,
    engine: MemoryEngine,
): Promise<EvaluationData> {
    const dataset = readDataset<Dataset>();
    const ingested = readCheckpoint<IngestedData>(config.name, 1);
    const start = performance.now();

    console.log(
        `\n[Phase 4: Evaluate] Config: "${config.name}", questions: ${dataset.questions.length}`,
    );

    const entries: EvaluationEntry[] = [];

    for (const question of dataset.questions) {
        const requiredMemoryIds = question.requiredEntryIds
            .map((id) => ingested.data.memoryIdMap[id])
            .filter(Boolean);
        const excludedMemoryIds = question.excludedEntryIds
            .map((id) => ingested.data.memoryIdMap[id])
            .filter(Boolean);

        const bcStart = performance.now();
        const contextResult = await engine.buildContext(question.question, {
            domains: [KB_DOMAIN_ID],
            budgetTokens: config.contextBudget,
        });
        const buildContextMs = performance.now() - bcStart;

        const askStart = performance.now();
        const askResult = await engine.ask(question.question, {
            domains: [KB_DOMAIN_ID],
            budgetTokens: config.contextBudget,
            maxRounds: 2,
        });
        const askMs = performance.now() - askStart;

        const memoriesReturned = contextResult.memories.map((m) => m.id);

        entries.push({
            questionId: question.id,
            question: question.question,
            expectedAnswer: question.expectedAnswer,
            difficulty: question.difficulty,
            context: contextResult.context,
            answer: askResult.answer,
            memoriesReturned,
            requiredEntryIds: requiredMemoryIds,
            excludedEntryIds: excludedMemoryIds,
            buildContextMs,
            askMs,
        });

        console.log(
            `  [${question.id}] buildContext: ${(buildContextMs / 1000).toFixed(1)}s, ask: ${(askMs / 1000).toFixed(1)}s`,
        );
    }

    const durationMs = performance.now() - start;
    const avgBuildContextMs = entries.reduce((s, e) => s + e.buildContextMs, 0) / entries.length;
    const avgAskMs = entries.reduce((s, e) => s + e.askMs, 0) / entries.length;

    const data: EvaluationData = { entries, avgBuildContextMs, avgAskMs };

    writeCheckpoint(config.name, 4, data, durationMs);

    const emptyContextQuestions = entries.filter(
        (e) => e.requiredEntryIds.length > 0 && e.memoriesReturned.length === 0,
    );
    if (emptyContextQuestions.length > 0) {
        console.warn(
            `[Phase 4 WARNING] ${emptyContextQuestions.length} question(s) got 0 memories returned`,
        );
        for (const q of emptyContextQuestions) {
            console.warn(`  - ${q.questionId}: expected ${q.requiredEntryIds.length} entries`);
        }
    }

    console.log(
        `[Phase 4] Avg buildContext: ${(avgBuildContextMs / 1000).toFixed(1)}s, Avg ask: ${(avgAskMs / 1000).toFixed(1)}s`,
    );
    console.log(`[Phase 4] Total: ${(durationMs / 1000).toFixed(1)}s`);

    return data;
}

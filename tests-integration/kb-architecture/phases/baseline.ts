import type { Dataset, EvaluationData, EvaluationEntry } from "../types.js";
import { readDataset, writeCheckpoint } from "../checkpoint.js";
import { getLlm } from "../engine-factory.js";

export async function runBaseline(): Promise<void> {
    const dataset = readDataset<Dataset>();
    const llm = getLlm();
    const start = performance.now();

    console.log(
        `\n[Baseline] Testing Haiku without KB context on ${dataset.questions.length} questions...\n`,
    );

    const entries: EvaluationEntry[] = [];

    for (const question of dataset.questions) {
        const askStart = performance.now();
        const answer = await llm.generate!(question.question);
        const askMs = performance.now() - askStart;

        entries.push({
            questionId: question.id,
            question: question.question,
            expectedAnswer: question.expectedAnswer,
            difficulty: question.difficulty,
            context: "",
            answer,
            memoriesReturned: [],
            requiredEntryIds: [],
            excludedEntryIds: [],
            buildContextMs: 0,
            askMs,
        });

        console.log(`  [${question.id}] ${(askMs / 1000).toFixed(1)}s`);
    }

    const durationMs = performance.now() - start;
    const avgAskMs = entries.reduce((s, e) => s + e.askMs, 0) / entries.length;

    const data: EvaluationData = { entries, avgBuildContextMs: 0, avgAskMs };

    writeCheckpoint("baseline-no-kb", 4, data, durationMs);
    writeCheckpoint("baseline-no-kb", 1, { memoryIdMap: {}, entryCount: 0 }, 0);
    writeCheckpoint(
        "baseline-no-kb",
        2,
        { entries: [], stageTiming: {}, classificationAccuracy: 0 },
        0,
    );

    console.log(
        `\n[Baseline] Done in ${(durationMs / 1000).toFixed(1)}s, avg ask: ${(avgAskMs / 1000).toFixed(1)}s`,
    );
}

if (import.meta.main) {
    runBaseline().catch(console.error);
}

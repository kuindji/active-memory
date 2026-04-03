import type { ArchitectureConfig, TuningData } from "../types.js";
import { writeCheckpoint } from "../checkpoint.js";
import { runIngest } from "./1-ingest.js";
import { runProcess } from "./2-process.js";
import { runEvaluate } from "./4-evaluate.js";
import { runScore } from "./5-score.js";
import { KB_DOMAIN_ID } from "../../../src/domains/kb/types.js";

export async function runTune(config: ArchitectureConfig): Promise<TuningData> {
    const start = performance.now();
    console.log(`\n[Phase 7: Tune] Config: "${config.name}"`);

    // Ingest and process once — creates the engine and writes checkpoints 1 & 2
    const { engine } = await runIngest(config);
    await runProcess(config, engine);

    // Get initial params
    const initialParams = engine.getTunableParams(KB_DOMAIN_ID);
    console.log(`[Phase 7] Initial params:`, initialParams);

    // Evaluate function for tuning: applies candidate params, runs Phase 4 + Phase 5
    const evaluate = async (params: Record<string, number>): Promise<number> => {
        await engine.saveTunableParams(KB_DOMAIN_ID, params);
        await runEvaluate(config, engine);
        const scoreData = await runScore(config);
        console.log(
            `[Phase 7] Params: ${JSON.stringify(params)} → score: ${scoreData.avgScore.toFixed(2)}`,
        );
        return scoreData.avgScore;
    };

    const result = await engine.tune(KB_DOMAIN_ID, evaluate, { maxIterations: 30 });

    console.log(
        `[Phase 7] Best score: ${result.bestScore.toFixed(2)}/5 after ${result.iterations} iterations`,
    );
    console.log(`[Phase 7] Best params:`, result.bestParams);

    await engine.close();

    const data: TuningData = {
        configName: config.name,
        initialParams,
        bestParams: result.bestParams,
        initialScore: result.history[0]?.score ?? 0,
        bestScore: result.bestScore,
        iterations: result.iterations,
        history: result.history,
    };

    writeCheckpoint(config.name, 7, data, performance.now() - start);
    return data;
}

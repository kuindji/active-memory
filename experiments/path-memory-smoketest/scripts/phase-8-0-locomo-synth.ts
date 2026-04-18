/**
 * Phase 8.0 — LOCOMO + local-LLM answer-synthesis run.
 *
 * Precondition: Ollama is running locally and the chosen model has been
 * pulled. Start with:
 *   ollama serve &
 *   ollama pull qwen2.5:1.5b-instruct
 *
 * Usage:
 *   bun scripts/phase-8-0-locomo-synth.ts [path] [--limit N] [--category NAME] [--model NAME]
 *
 * Defaults:
 *   path     ./data/locomo.json
 *   model    qwen2.5:1.5b-instruct
 *   output   ./data/phase-8-0-locomo-synth-output.json
 */

import { existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getEmbedder } from "../src/embedder.js";
import { loadLocomo } from "../data/locomo-loader.js";
import {
    flattenQuestionResults,
    runLocomo,
    type LocomoConversationResult,
    type LocomoQuestionResult,
} from "../eval/locomo-adapter.js";
import {
    aggregateLocomoByCategory,
    aggregateLocomoOverall,
    scoreLocomo,
    type LocomoScore,
} from "../eval/locomo-score.js";
import { OllamaSynthesizer } from "../src/llm-synthesizer.js";
import type { RetrievalOptions } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = resolve(here, "../data/locomo.json");
const DEFAULT_OUT = resolve(here, "../data/phase-8-0-locomo-synth-output.json");
const DEFAULT_MODEL = "qwen2.5:1.5b-instruct";

const RETRIEVAL_OPTIONS: RetrievalOptions = {
    traversal: "dijkstra",
    temporalHopCost: 0.5,
    probeComposition: "weighted-fusion",
    weightedFusionTau: 0.2,
    anchorTopK: 5,
    resultTopN: 10,
    sessionDecayTau: 0.2,
    accessTracking: false,
};

type Args = {
    datasetPath: string;
    limit?: number;
    category?: string;
    model: string;
};

function parseArgs(argv: string[]): Args {
    let datasetPath = DEFAULT_PATH;
    let limit: number | undefined;
    let category: string | undefined;
    let model = DEFAULT_MODEL;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--limit") {
            const next = argv[i + 1];
            if (!next) throw new Error("--limit requires a value");
            const parsed = Number.parseInt(next, 10);
            if (!Number.isFinite(parsed) || parsed <= 0) {
                throw new Error(`--limit must be a positive integer, got "${next}"`);
            }
            limit = parsed;
            i++;
        } else if (a === "--category") {
            const next = argv[i + 1];
            if (!next) throw new Error("--category requires a value");
            category = next;
            i++;
        } else if (a === "--model") {
            const next = argv[i + 1];
            if (!next) throw new Error("--model requires a value");
            model = next;
            i++;
        } else if (!a.startsWith("-")) {
            datasetPath = resolve(a);
        } else {
            throw new Error(`Unknown flag: ${a}`);
        }
    }
    return { datasetPath, limit, category, model };
}

function formatMs(ms: number): string {
    return `${ms.toFixed(1)}ms`;
}

function summarizeScores(scores: LocomoScore[]): void {
    const overall = aggregateLocomoOverall(scores);
    console.log(
        `# retrieval overall:  n=${overall.count}  scored=${overall.scoredCount}  contain=${(overall.substringContainmentRate * 100).toFixed(1)}%  F1=${overall.meanTokenF1.toFixed(3)}  evidR=${overall.meanEvidenceRecall.toFixed(3)}`,
    );
    console.log(
        `# synth overall:      synthScored=${overall.synthScoredCount}  contain=${(overall.synthSubstringContainmentRate * 100).toFixed(1)}%  F1=${overall.synthMeanTokenF1.toFixed(3)}  abstain=${overall.abstentionCount}  falseAbstain=${overall.falseAbstentionCount}  meanMs=${overall.synthMeanMs.toFixed(1)}`,
    );
    const delta = overall.synthSubstringContainmentRate - overall.substringContainmentRate;
    console.log(`# Δ contain (synth − retrieval): ${(delta * 100).toFixed(2)}pp`);
    console.log();
    console.log(
        "category                       | n   | rContain | sContain |  Δ pp  | sF1   | abstain | falseAbs | msMean",
    );
    console.log("-".repeat(120));
    for (const agg of aggregateLocomoByCategory(scores)) {
        const d = (agg.synthSubstringContainmentRate - agg.substringContainmentRate) * 100;
        console.log(
            [
                agg.category.slice(0, 30).padEnd(30),
                String(agg.count).padStart(3),
                (agg.substringContainmentRate * 100).toFixed(1).padStart(7) + "%",
                (agg.synthSubstringContainmentRate * 100).toFixed(1).padStart(7) + "%",
                (d >= 0 ? "+" : "") + d.toFixed(2).padStart(5),
                agg.synthMeanTokenF1.toFixed(3).padStart(5),
                String(agg.abstentionCount).padStart(7),
                String(agg.falseAbstentionCount).padStart(8),
                agg.synthMeanMs.toFixed(1).padStart(6),
            ].join(" | "),
        );
    }
}

function buildOutput(questions: LocomoQuestionResult[], scores: LocomoScore[]): unknown {
    const scoreById = new Map(scores.map((s) => [`${s.sampleId}::${s.questionIndex}`, s]));
    return questions.map((q) => {
        const key = `${q.sampleId}::${q.questionIndex}`;
        const score = scoreById.get(key);
        return {
            sampleId: q.sampleId,
            questionIndex: q.questionIndex,
            category: q.category,
            adversarial: q.adversarial,
            questionText: q.questionText,
            goldAnswer: q.goldAnswer,
            evidenceDiaIds: q.evidenceDiaIds,
            retrievedClaimIds: q.retrievedClaimIds,
            retrievedClaimTexts: q.retrievedClaimTexts,
            retrievedDiaIds: q.retrievedDiaIds,
            topPathCount: q.topPaths.length,
            retrieveMs: q.retrieveMs,
            synthesizedAnswer: q.synthesizedAnswer,
            synthAbstained: q.synthAbstained,
            synthMs: q.synthMs,
            metrics: score?.metrics ?? null,
            synthMetrics: score?.synthMetrics ?? null,
        };
    });
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));

    if (!existsSync(args.datasetPath)) {
        console.log(`# Phase 8.0 LOCOMO synth run`);
        console.log(`# Dataset not found at: ${args.datasetPath}`);
        console.log(`# Download LOCOMO and place JSON at that path. Exiting 0 for CI.`);
        return;
    }

    const all = loadLocomo(args.datasetPath);
    let selected = all;
    if (args.category !== undefined) {
        selected = all
            .map((c) => ({ ...c, qa: c.qa.filter((q) => q.category === args.category) }))
            .filter((c) => c.qa.length > 0);
    }
    if (args.limit !== undefined) selected = selected.slice(0, args.limit);

    const totalQuestions = selected.reduce((acc, c) => acc + c.qa.length, 0);

    console.log(`# Phase 8.0 LOCOMO synth run`);
    console.log(`#   dataset            ${args.datasetPath}`);
    console.log(`#   model              ${args.model}`);
    console.log(`#   selected conv      ${selected.length}`);
    console.log(`#   selected questions ${totalQuestions}`);
    console.log();

    if (selected.length === 0) {
        console.log("# No conversations after filtering; nothing to do.");
        return;
    }

    const synthesizer = new OllamaSynthesizer({ model: args.model });
    await synthesizer.healthCheck();

    const embedder = await getEmbedder();
    const started = performance.now();
    const convResults: LocomoConversationResult[] = await runLocomo(selected, {
        embedder,
        retrievalOptions: RETRIEVAL_OPTIONS,
        synthesizer,
    });
    const totalMs = performance.now() - started;

    const questions = flattenQuestionResults(convResults);
    console.log(
        `# total wall-clock: ${formatMs(totalMs)}  (${(totalMs / Math.max(1, questions.length)).toFixed(1)}ms / question)`,
    );

    const scores = scoreLocomo(questions);
    console.log();
    summarizeScores(scores);

    writeFileSync(DEFAULT_OUT, JSON.stringify(buildOutput(questions, scores), null, 2), "utf8");
    console.log();
    console.log(`# wrote ${DEFAULT_OUT}`);
}

await main();

/**
 * Phase 8.0 confounder — run 3B model on a 150-probe LOCOMO slice.
 *
 * Purpose: rule out "model was too small" if the 1.5B primary shows no
 * lift. Stratifies 150 questions proportionally across categories, runs
 * them through the same synth pipeline with qwen2.5:3b-instruct, and
 * prints retrieval + synth contain side-by-side.
 *
 * Usage:
 *   bun scripts/phase-8-0-confounder.ts [path] [--model NAME] [--size N]
 *
 * Defaults:
 *   model  qwen2.5:3b-instruct
 *   size   150
 */

import { existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getEmbedder } from "../src/embedder.js";
import { loadLocomo, type LocomoConversation, type LocomoQA } from "../data/locomo-loader.js";
import {
    flattenQuestionResults,
    runLocomo,
    type LocomoQuestionResult,
} from "../eval/locomo-adapter.js";
import {
    aggregateLocomoOverall,
    aggregateLocomoByCategory,
    scoreLocomo,
} from "../eval/locomo-score.js";
import { OllamaSynthesizer } from "../src/llm-synthesizer.js";
import type { RetrievalOptions } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = resolve(here, "../data/locomo.json");
const DEFAULT_OUT = resolve(here, "../data/phase-8-0-confounder-output.json");
const DEFAULT_MODEL = "qwen2.5:3b-instruct";
const DEFAULT_SIZE = 150;

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

type Args = { datasetPath: string; model: string; size: number };

function parseArgs(argv: string[]): Args {
    let datasetPath = DEFAULT_PATH;
    let model = DEFAULT_MODEL;
    let size = DEFAULT_SIZE;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--model") {
            const next = argv[++i];
            if (next === undefined) throw new Error("--model requires a value");
            model = next;
        } else if (a === "--size") {
            const next = argv[++i];
            if (!next) throw new Error("--size requires a value");
            const parsed = Number.parseInt(next, 10);
            if (!Number.isFinite(parsed) || parsed <= 0) {
                throw new Error(`--size must be positive, got "${next}"`);
            }
            size = parsed;
        } else if (!a.startsWith("-")) {
            datasetPath = resolve(a);
        } else {
            throw new Error(`Unknown flag: ${a}`);
        }
    }
    return { datasetPath, model, size };
}

// Deterministic stratified proportional sampling: take the first share
// per category, where share = round(categoryShare * targetSize) (min 1).
function stratifiedSlice(conversations: LocomoConversation[], size: number): LocomoConversation[] {
    type Entry = { conv: LocomoConversation; qa: LocomoQA };
    const byCategory = new Map<string, Entry[]>();
    let total = 0;
    for (const conv of conversations) {
        for (const qa of conv.qa) {
            const list = byCategory.get(qa.category) ?? [];
            list.push({ conv, qa });
            byCategory.set(qa.category, list);
            total += 1;
        }
    }
    if (total === 0) return [];

    const picked = new Map<string, Set<LocomoQA>>();
    for (const [cat, entries] of byCategory) {
        const share = Math.max(1, Math.round((entries.length / total) * size));
        picked.set(cat, new Set(entries.slice(0, share).map((e) => e.qa)));
    }

    return conversations
        .map((conv) => ({
            ...conv,
            qa: conv.qa.filter((qa) => picked.get(qa.category)?.has(qa) === true),
        }))
        .filter((conv) => conv.qa.length > 0);
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    if (!existsSync(args.datasetPath)) {
        console.log(`# Dataset missing at ${args.datasetPath}; exiting 0.`);
        return;
    }

    const all = loadLocomo(args.datasetPath);
    const sliced = stratifiedSlice(all, args.size);
    const totalQuestions = sliced.reduce((acc, c) => acc + c.qa.length, 0);

    console.log(`# Phase 8.0 confounder run`);
    console.log(`#   model              ${args.model}`);
    console.log(`#   requested size     ${args.size}`);
    console.log(`#   actual questions   ${totalQuestions}`);
    console.log();

    const synthesizer = new OllamaSynthesizer({ model: args.model });
    await synthesizer.healthCheck();

    const embedder = await getEmbedder();
    const convResults = await runLocomo(sliced, {
        embedder,
        retrievalOptions: RETRIEVAL_OPTIONS,
        synthesizer,
    });
    const questions: LocomoQuestionResult[] = flattenQuestionResults(convResults);
    const scores = scoreLocomo(questions);
    const overall = aggregateLocomoOverall(scores);

    console.log(`# retrieval contain: ${(overall.substringContainmentRate * 100).toFixed(1)}%`);
    console.log(
        `# synth contain:     ${(overall.synthSubstringContainmentRate * 100).toFixed(1)}%`,
    );
    console.log(
        `# Δ contain:         ${((overall.synthSubstringContainmentRate - overall.substringContainmentRate) * 100).toFixed(2)}pp`,
    );
    console.log(`# false abstain:     ${overall.falseAbstentionCount}/${overall.synthScoredCount}`);

    console.log();
    console.log("# per-category:");
    console.log("category                       | n   | Δ contain (pp) | falseAbs");
    console.log("-".repeat(80));
    for (const agg of aggregateLocomoByCategory(scores)) {
        const d = (agg.synthSubstringContainmentRate - agg.substringContainmentRate) * 100;
        console.log(
            [
                agg.category.slice(0, 30).padEnd(30),
                String(agg.count).padStart(3),
                (d >= 0 ? "+" : "") + d.toFixed(2).padStart(6),
                String(agg.falseAbstentionCount).padStart(8),
            ].join(" | "),
        );
    }

    writeFileSync(
        DEFAULT_OUT,
        JSON.stringify({ model: args.model, overall, questions }, null, 2),
        "utf8",
    );
    console.log();
    console.log(`# wrote ${DEFAULT_OUT}`);
}

await main();

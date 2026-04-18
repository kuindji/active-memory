/**
 * Phase 1 — w-sweep fallback.
 *
 * Plan §MSC CMR variants: "If none clears H1, run a `w` sweep (0.3, 0.7) with
 * the best ρ before declaring null." Best ρ from phase1-msc-dryrun.ts was 0.70
 * reset (containment 1.06% @ K=10). Here we sweep w ∈ {0.3, 0.7} with ρ=0.70
 * reset at K=10 only and decide final H1.
 */

import { existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getEmbedder } from "../src/embedder.js";
import { loadMsc } from "../../path-memory-smoketest/data/msc-loader.js";
import {
    aggregate,
    runMscDialogueCmr,
    runMscDialogueFlat,
    type CmrVariant,
    type DialogueResult,
} from "../eval/msc-cmr-adapter.js";

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = resolve(here, "../../path-memory-smoketest/data/msc-test.json");
const OUTPUT_PATH = resolve(here, "../data/phase1-msc-w-sweep-output.json");

const DEFAULT_LIMIT = 100;
const TOPK = 10;
const BEST_RHO = 0.7;
const H1_DELTA_PP = 2.0;

const VARIANTS: CmrVariant[] = [
    { name: "w=0.3 ρ=0.70 reset", rho: BEST_RHO, beta: 0.5, w: 0.3, resetAtSession: true },
    { name: "w=0.5 ρ=0.70 reset", rho: BEST_RHO, beta: 0.5, w: 0.5, resetAtSession: true },
    { name: "w=0.7 ρ=0.70 reset", rho: BEST_RHO, beta: 0.5, w: 0.7, resetAtSession: true },
];

type Args = { datasetPath: string; limit: number };

function parseArgs(argv: string[]): Args {
    let datasetPath = DEFAULT_PATH;
    let limit = DEFAULT_LIMIT;
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
        } else if (!a.startsWith("-")) {
            datasetPath = resolve(a);
        } else {
            throw new Error(`Unknown flag: ${a}`);
        }
    }
    return { datasetPath, limit };
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    if (!existsSync(args.datasetPath)) {
        console.log(`# Dataset not found at ${args.datasetPath}. Exiting 0.`);
        return;
    }
    const dialogues = loadMsc(args.datasetPath).slice(0, args.limit);
    console.log(`# Phase 1 w-sweep (ρ=${BEST_RHO} reset, K=${TOPK})`);
    console.log(`#   dialogues ${dialogues.length}`);
    console.log();

    const embedder = await getEmbedder();

    const flatResults: DialogueResult[] = [];
    console.log("# flat ...");
    for (const d of dialogues) {
        flatResults.push(await runMscDialogueFlat(d, { embedder, topK: TOPK }));
    }
    const flatAgg = aggregate(flatResults);
    const flatScore = flatAgg.meanPersonaStringContainmentRate;
    console.log(`# flat containment ${(flatScore * 100).toFixed(2)}%`);

    const rows: Array<{ label: string; containment: number; tokenRecall: number; delta: number }> =
        [];
    let best = -Infinity;
    let bestLabel = "";
    for (const v of VARIANTS) {
        console.log(`# ${v.name} ...`);
        const results: DialogueResult[] = [];
        for (const d of dialogues) {
            results.push(await runMscDialogueCmr(d, { embedder, variant: v, topK: TOPK }));
        }
        const agg = aggregate(results);
        const delta = (agg.meanPersonaStringContainmentRate - flatScore) * 100;
        rows.push({
            label: v.name,
            containment: agg.meanPersonaStringContainmentRate,
            tokenRecall: agg.meanPersonaTokenRecall,
            delta,
        });
        console.log(
            `#   containment ${(agg.meanPersonaStringContainmentRate * 100).toFixed(2)}%  tokenRecall ${agg.meanPersonaTokenRecall.toFixed(3)}  Δ=${delta >= 0 ? "+" : ""}${delta.toFixed(2)}pp`,
        );
        if (agg.meanPersonaStringContainmentRate > best) {
            best = agg.meanPersonaStringContainmentRate;
            bestLabel = v.name;
        }
    }

    console.log();
    const bestDelta = (best - flatScore) * 100;
    console.log(
        `# Best in w-sweep: ${bestLabel} containment ${(best * 100).toFixed(2)}%  Δ=${bestDelta >= 0 ? "+" : ""}${bestDelta.toFixed(2)}pp`,
    );
    if (bestDelta >= H1_DELTA_PP) {
        console.log(`# H1 verdict (after w-sweep): PASS`);
    } else {
        console.log(`# H1 verdict (after w-sweep): FAIL (final null)`);
    }

    writeFileSync(
        OUTPUT_PATH,
        JSON.stringify({ flat: flatAgg, rows, bestLabel, bestDelta }, null, 2),
        "utf8",
    );
    console.log(`# wrote ${OUTPUT_PATH}`);
}

await main();

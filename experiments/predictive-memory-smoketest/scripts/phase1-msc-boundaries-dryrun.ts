/**
 * Phase 1 — H3: HMM session-boundary recovery on MSC.
 *
 * Flatten all sessions of each MSC dialogue into one turn stream; gold
 * boundaries are the indices where new sessions start. Run HMM @ oracle K,
 * HMM at K ∈ {2, 4, 8, 16}, and cosine-change baseline. Pass criterion:
 * HMM(oracle K) F1 ≥ cosine-change F1 + 0.05 on aggregate.
 *
 * Usage:
 *   bun scripts/phase1-msc-boundaries-dryrun.ts [path] [--limit N]
 *
 * Defaults: same 100-dialogue slice as the MSC persona dry-run.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getEmbedder } from "../src/embedder.js";
import { loadMsc } from "../../path-memory-smoketest/data/msc-loader.js";
import { scoreBoundary } from "../eval/boundary-score.js";
import {
    embedDialoguesOnce,
    flattenMscForBoundaries,
    runMscCosineChangeFromCache,
    runMscHmmAtKFromCache,
    runMscHmmOracleFromCache,
    type MscFlatDialogue,
} from "../eval/msc-boundary-adapter.js";

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = resolve(here, "../../path-memory-smoketest/data/msc-test.json");
const OUTPUT_DIR = resolve(here, "../data");
const OUTPUT_PATH = resolve(OUTPUT_DIR, "phase1-msc-boundaries-output.json");

const DEFAULT_LIMIT = 100;
const K_SWEEP = [2, 4, 8, 16] as const;
const COSINE_Z = 1.0;
const H3_DELTA = 0.05;

type Args = {
    datasetPath: string;
    limit: number;
};

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

function printRow(
    label: string,
    tp: number,
    fp: number,
    fn: number,
    precision: number,
    recall: number,
    f1: number,
): void {
    console.log(
        [
            label.padEnd(22),
            `p=${precision.toFixed(3)}`.padStart(9),
            `r=${recall.toFixed(3)}`.padStart(9),
            `f1=${f1.toFixed(3)}`.padStart(10),
            `tp=${tp}`.padStart(7),
            `fp=${fp}`.padStart(7),
            `fn=${fn}`.padStart(7),
        ].join(" | "),
    );
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    if (!existsSync(args.datasetPath)) {
        console.log(`# Phase 1 MSC boundary dry-run`);
        console.log(`# Dataset not found at: ${args.datasetPath}. Exiting 0.`);
        return;
    }

    const dialogues = loadMsc(args.datasetPath);
    const selectedDialogues = dialogues.slice(0, args.limit);
    const flat: MscFlatDialogue[] = selectedDialogues.map(flattenMscForBoundaries);

    console.log(`# Phase 1 MSC boundary dry-run`);
    console.log(`#   dataset            ${args.datasetPath}`);
    console.log(`#   selected dialogues ${flat.length}`);
    const sessionCounts = flat.map((d) => d.sessionCount);
    const meanSessions = sessionCounts.reduce((a, b) => a + b, 0) / Math.max(1, flat.length);
    console.log(`#   mean sessions/dlg  ${meanSessions.toFixed(2)}`);
    const meanTurns = flat.reduce((a, b) => a + b.texts.length, 0) / Math.max(1, flat.length);
    console.log(`#   mean turns/dlg     ${meanTurns.toFixed(1)}`);
    console.log();

    const embedder = await getEmbedder();
    console.log("# embedding all turns once (shared cache across methods)...");
    const embedStart = performance.now();
    const cache = await embedDialoguesOnce(embedder, flat);
    const embedMs = performance.now() - embedStart;
    console.log(`# embed time: ${(embedMs / 1000).toFixed(1)}s`);
    console.log();

    console.log(
        "method                 | precision |    recall |       f1 |      tp |      fp |      fn",
    );
    console.log("-".repeat(96));

    const cosineRuns = runMscCosineChangeFromCache(flat, cache, { zThreshold: COSINE_Z });
    const cosineScore = scoreBoundary(cosineRuns, 2);
    printRow(
        `cosine-change(z=${COSINE_Z})`,
        cosineScore.tp,
        cosineScore.fp,
        cosineScore.fn,
        cosineScore.precision,
        cosineScore.recall,
        cosineScore.f1,
    );

    const oracleRuns = runMscHmmOracleFromCache(flat, cache);
    const oracleScore = scoreBoundary(oracleRuns, 2);
    printRow(
        "hmm(oracle K)",
        oracleScore.tp,
        oracleScore.fp,
        oracleScore.fn,
        oracleScore.precision,
        oracleScore.recall,
        oracleScore.f1,
    );

    const kRows: Array<{
        k: number;
        f1: number;
        p: number;
        r: number;
        tp: number;
        fp: number;
        fn: number;
    }> = [];
    for (const k of K_SWEEP) {
        const runs = runMscHmmAtKFromCache(flat, cache, k);
        const s = scoreBoundary(runs, 2);
        printRow(`hmm(k=${k})`, s.tp, s.fp, s.fn, s.precision, s.recall, s.f1);
        kRows.push({ k, f1: s.f1, p: s.precision, r: s.recall, tp: s.tp, fp: s.fp, fn: s.fn });
    }

    console.log();
    const delta = oracleScore.f1 - cosineScore.f1;
    console.log(
        `# HMM(oracle K) F1 − cosine-change F1 = ${delta >= 0 ? "+" : ""}${delta.toFixed(3)}`,
    );
    if (delta >= H3_DELTA) {
        console.log(`# H3 verdict: PASS (Δ=${delta.toFixed(3)} ≥ ${H3_DELTA}).`);
    } else {
        console.log(`# H3 verdict: FAIL (Δ=${delta.toFixed(3)} < ${H3_DELTA}).`);
    }

    mkdirSync(OUTPUT_DIR, { recursive: true });
    writeFileSync(
        OUTPUT_PATH,
        JSON.stringify(
            {
                dialogueCount: flat.length,
                meanSessionsPerDialogue: meanSessions,
                meanTurnsPerDialogue: meanTurns,
                embedMs,
                cosineChange: { z: COSINE_Z, ...cosineScore },
                hmmOracle: oracleScore,
                hmmSweep: kRows,
                h3Delta: delta,
                h3Pass: delta >= H3_DELTA,
            },
            null,
            2,
        ),
        "utf8",
    );
    console.log(`# wrote ${OUTPUT_PATH}`);
}

await main();

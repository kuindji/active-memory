/**
 * Phase 1 — MSC persona-recall dry-run.
 *
 * H1 (primary): On MSC persona-string-containment, CMR beats FlatVectorBaseline
 * by ≥ 2 percentage points at matched topK=10.
 *
 * Runs FlatRetriever + four CMR variants (V1..V4) over a 100-dialogue slice
 * of MSC, sweeps topK ∈ {5, 10, 20}, prints a variant × topK table, and emits
 * an H1 verdict.
 *
 * Usage:
 *   bun scripts/phase1-msc-dryrun.ts [path] [--limit N]
 *
 * Defaults:
 *   path    ../path-memory-smoketest/data/msc-test.json (Phase 7.5 mirror)
 *   limit   100 (matches Phase 7.5's 200-probe slice)
 *   output  ./data/phase1-msc-dryrun-output.json
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getEmbedder } from "../src/embedder.js";
import { loadMsc } from "../../path-memory-smoketest/data/msc-loader.js";
import {
    aggregate,
    runMscDialogueCmr,
    runMscDialogueFlat,
    type Aggregate,
    type CmrVariant,
    type DialogueResult,
} from "../eval/msc-cmr-adapter.js";

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = resolve(here, "../../path-memory-smoketest/data/msc-test.json");
const OUTPUT_DIR = resolve(here, "../data");
const OUTPUT_PATH = resolve(OUTPUT_DIR, "phase1-msc-dryrun-output.json");

const DEFAULT_LIMIT = 100;
const TOP_KS = [5, 10, 20] as const;
const H1_DELTA_PP = 2.0;

// β=0.5, w=0.5 are Phase 0 defaults; varying ρ + session-reset per plan §CMR variants.
const VARIANTS: CmrVariant[] = [
    { name: "V1 ρ=0.85 cont", rho: 0.85, beta: 0.5, w: 0.5, resetAtSession: false },
    { name: "V2 ρ=0.85 reset", rho: 0.85, beta: 0.5, w: 0.5, resetAtSession: true },
    { name: "V3 ρ=0.70 reset", rho: 0.7, beta: 0.5, w: 0.5, resetAtSession: true },
    { name: "V4 ρ=0.95 reset", rho: 0.95, beta: 0.5, w: 0.5, resetAtSession: true },
];

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

type Cell = {
    label: string;
    topK: number;
    aggregate: Aggregate;
    avgRetrieveMs: number;
    results: DialogueResult[];
};

function avgRetrieveMs(results: DialogueResult[]): number {
    if (results.length === 0) return 0;
    let sum = 0;
    for (const r of results) sum += r.speaker1.retrieveMs + r.speaker2.retrieveMs;
    return sum / (results.length * 2);
}

function printTable(cells: Cell[]): void {
    console.log();
    console.log("# Phase 1 MSC persona-recall — variant × topK");
    console.log();
    const header = ["variant", ...TOP_KS.map((k) => `K=${k} con`)].join(" | ");
    console.log(header);
    console.log("-".repeat(Math.max(header.length, 60)));
    const byVariant = new Map<string, Map<number, Cell>>();
    for (const c of cells) {
        const m = byVariant.get(c.label) ?? new Map<number, Cell>();
        m.set(c.topK, c);
        byVariant.set(c.label, m);
    }
    const orderedLabels = ["flat", ...VARIANTS.map((v) => v.name)];
    for (const label of orderedLabels) {
        const m = byVariant.get(label);
        if (!m) continue;
        const cols: string[] = [label.padEnd(16)];
        for (const k of TOP_KS) {
            const cell = m.get(k);
            cols.push(
                cell
                    ? cell.aggregate.meanPersonaStringContainmentRate.toFixed(4).padStart(8)
                    : "  n/a   ".padStart(8),
            );
        }
        console.log(cols.join(" | "));
    }
    console.log();
    console.log("# persona token recall (secondary metric)");
    console.log();
    console.log(header);
    console.log("-".repeat(Math.max(header.length, 60)));
    for (const label of orderedLabels) {
        const m = byVariant.get(label);
        if (!m) continue;
        const cols: string[] = [label.padEnd(16)];
        for (const k of TOP_KS) {
            const cell = m.get(k);
            cols.push(
                cell
                    ? cell.aggregate.meanPersonaTokenRecall.toFixed(4).padStart(8)
                    : "  n/a   ".padStart(8),
            );
        }
        console.log(cols.join(" | "));
    }
    console.log();
    console.log("# retrieve latency (avg ms per probe)");
    console.log();
    console.log(header);
    console.log("-".repeat(Math.max(header.length, 60)));
    for (const label of orderedLabels) {
        const m = byVariant.get(label);
        if (!m) continue;
        const cols: string[] = [label.padEnd(16)];
        for (const k of TOP_KS) {
            const cell = m.get(k);
            cols.push(cell ? cell.avgRetrieveMs.toFixed(1).padStart(8) : "  n/a   ".padStart(8));
        }
        console.log(cols.join(" | "));
    }
}

function verdictH1(cells: Cell[]): void {
    const atK10 = cells.filter((c) => c.topK === 10);
    const flat = atK10.find((c) => c.label === "flat");
    if (!flat) {
        console.log("# H1 verdict: INDETERMINATE (no flat baseline at K=10).");
        return;
    }
    const flatScore = flat.aggregate.meanPersonaStringContainmentRate;
    console.log();
    console.log(`# Flat baseline @ K=10 — containment ${(flatScore * 100).toFixed(2)}%`);
    let bestCmr: Cell | undefined;
    for (const c of atK10) {
        if (c.label === "flat") continue;
        if (
            !bestCmr ||
            c.aggregate.meanPersonaStringContainmentRate >
                bestCmr.aggregate.meanPersonaStringContainmentRate
        ) {
            bestCmr = c;
        }
    }
    if (!bestCmr) {
        console.log("# H1 verdict: INDETERMINATE (no CMR variants at K=10).");
        return;
    }
    const cmrScore = bestCmr.aggregate.meanPersonaStringContainmentRate;
    const deltaPP = (cmrScore - flatScore) * 100;
    console.log(
        `# Best CMR @ K=10 — ${bestCmr.label} containment ${(cmrScore * 100).toFixed(2)}%  Δ=${deltaPP >= 0 ? "+" : ""}${deltaPP.toFixed(2)}pp`,
    );
    if (deltaPP >= H1_DELTA_PP) {
        console.log(`# H1 verdict: PASS (Δ=${deltaPP.toFixed(2)}pp ≥ ${H1_DELTA_PP}pp).`);
    } else {
        console.log(`# H1 verdict: FAIL (Δ=${deltaPP.toFixed(2)}pp < ${H1_DELTA_PP}pp).`);
    }
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    if (!existsSync(args.datasetPath)) {
        console.log(`# Phase 1 MSC dry-run`);
        console.log(`# Dataset not found at: ${args.datasetPath}`);
        console.log(`# Exiting 0 (CI-friendly). Phase 7.5 loader expects msc-test.json.`);
        return;
    }
    const dialogues = loadMsc(args.datasetPath);
    const selected = dialogues.slice(0, args.limit);
    console.log(`# Phase 1 MSC dry-run`);
    console.log(`#   dataset            ${args.datasetPath}`);
    console.log(`#   total dialogues    ${dialogues.length}`);
    console.log(`#   selected dialogues ${selected.length}`);
    console.log(`#   variants           ${VARIANTS.length} CMR + flat`);
    console.log(`#   topK               ${TOP_KS.join(", ")}`);
    console.log();

    const embedder = await getEmbedder();
    const cells: Cell[] = [];
    const started = performance.now();

    for (const k of TOP_KS) {
        console.log(`# flat @ K=${k} ...`);
        const flatResults: DialogueResult[] = [];
        for (const d of selected) {
            flatResults.push(await runMscDialogueFlat(d, { embedder, topK: k }));
        }
        cells.push({
            label: "flat",
            topK: k,
            aggregate: aggregate(flatResults),
            avgRetrieveMs: avgRetrieveMs(flatResults),
            results: flatResults,
        });
        for (const variant of VARIANTS) {
            console.log(`# ${variant.name} @ K=${k} ...`);
            const results: DialogueResult[] = [];
            for (const d of selected) {
                results.push(await runMscDialogueCmr(d, { embedder, variant, topK: k }));
            }
            cells.push({
                label: variant.name,
                topK: k,
                aggregate: aggregate(results),
                avgRetrieveMs: avgRetrieveMs(results),
                results,
            });
        }
    }

    const totalMs = performance.now() - started;
    console.log();
    console.log(`# total runtime: ${(totalMs / 1000).toFixed(1)}s`);

    printTable(cells);
    verdictH1(cells);

    mkdirSync(OUTPUT_DIR, { recursive: true });
    const out = cells.map((c) => ({
        label: c.label,
        topK: c.topK,
        aggregate: c.aggregate,
        avgRetrieveMs: c.avgRetrieveMs,
        dialogues: c.results.map((r) => ({
            dialogueId: r.dialogueId,
            ingestedTurnCount: r.ingestedTurnCount,
            sessionCount: r.sessionCount,
            ingestMs: r.ingestMs,
            speaker1: {
                probeText: r.speaker1.probeText,
                goldPersona: r.speaker1.goldPersona,
                retrievedClaimTexts: r.speaker1.retrievedClaimTexts,
                retrieveMs: r.speaker1.retrieveMs,
                metrics: r.speaker1.metrics,
            },
            speaker2: {
                probeText: r.speaker2.probeText,
                goldPersona: r.speaker2.goldPersona,
                retrievedClaimTexts: r.speaker2.retrievedClaimTexts,
                retrieveMs: r.speaker2.retrieveMs,
                metrics: r.speaker2.metrics,
            },
        })),
    }));
    writeFileSync(OUTPUT_PATH, JSON.stringify(out, null, 2), "utf8");
    console.log(`# wrote ${OUTPUT_PATH}`);
}

await main();

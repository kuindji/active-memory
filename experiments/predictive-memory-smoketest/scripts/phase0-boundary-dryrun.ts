import { getEmbedder, resolveEncoder } from "../src/embedder.js";
import { BOUNDARY_FIXTURES } from "../data/boundary-fixtures.js";
import { runCosineChange, runHmmOracleK, runHmmSweep } from "../eval/boundary-adapter.js";
import { scoreBoundary } from "../eval/boundary-score.js";

async function main() {
    const encoder = resolveEncoder();
    console.log(`Phase 0 — Boundary dry-run (encoder=${encoder})`);
    console.log(`Fixtures: ${BOUNDARY_FIXTURES.length}`);
    for (const fx of BOUNDARY_FIXTURES) {
        console.log(
            `  ${fx.id}: turns=${fx.turns.length} segments=${fx.segmentCount} gold=${fx.goldBoundaries.join(",")}`,
        );
    }

    const embedder = await getEmbedder();

    console.log("");
    console.log("— Cosine-change baseline (z > 1.0) —");
    const cc = await runCosineChange(embedder, BOUNDARY_FIXTURES, { zThreshold: 1.0 });
    const ccSummary = scoreBoundary(cc);
    logSummary(ccSummary);

    console.log("");
    console.log("— HMM (oracle K = true segment count) —");
    const oracle = await runHmmOracleK(embedder, BOUNDARY_FIXTURES);
    const oracleSummary = scoreBoundary(oracle);
    logSummary(oracleSummary);

    console.log("");
    const sweep = await runHmmSweep(embedder, BOUNDARY_FIXTURES);
    const kList = [...sweep.perK.keys()].join(",");
    console.log(`— HMM sweep (K ∈ {${kList}}) —`);
    for (const [k, runs] of sweep.perK.entries()) {
        const s = scoreBoundary(runs);
        console.log(
            `  K=${k}: P=${s.precision.toFixed(3)} R=${s.recall.toFixed(3)} F1=${s.f1.toFixed(3)}`,
        );
    }
    const sweepSummary = scoreBoundary(sweep.best);
    console.log(`  bic-selected (brittle — see per-K; illustrative only):`);
    logSummary(sweepSummary);

    console.log("");
    const delta = oracleSummary.f1 - ccSummary.f1;
    console.log(`Δ F1 (hmm-oracle - cosine-change): ${delta.toFixed(3)}`);
    const pass = oracleSummary.f1 >= ccSummary.f1 + 0.1;
    console.log(`Plan pass criterion (hmm F1 ≥ cosine F1 + 0.10): ${pass ? "PASS" : "FAIL"}`);
}

function logSummary(s: {
    method: string;
    precision: number;
    recall: number;
    f1: number;
    tp: number;
    fp: number;
    fn: number;
    perFixture: Array<{ fixtureId: string; f1: number; predicted: number; gold: number }>;
}) {
    console.log(
        `  ${s.method} P=${s.precision.toFixed(3)} R=${s.recall.toFixed(3)} F1=${s.f1.toFixed(3)} (tp=${s.tp} fp=${s.fp} fn=${s.fn})`,
    );
    for (const pf of s.perFixture) {
        console.log(
            `    ${pf.fixtureId.padEnd(28)} F1=${pf.f1.toFixed(3)} pred=${pf.predicted} gold=${pf.gold}`,
        );
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

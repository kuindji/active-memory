import { getEmbedder, resolveEncoder } from "../src/embedder.js";
import { REINSTATEMENT_FIXTURES } from "../data/reinstatement-fixtures.js";
import { runFlat, runCmr } from "../eval/reinstatement-adapter.js";
import { scoreReinstatement } from "../eval/reinstatement-score.js";
import { DEFAULT_CMR } from "../src/cmr.js";

function formatRank(r: number): string {
    return r === Number.POSITIVE_INFINITY ? "∞" : String(r);
}

async function main() {
    const encoder = resolveEncoder();
    console.log(`Phase 0 — Reinstatement dry-run (encoder=${encoder})`);
    console.log(`CMR cfg: rho=${DEFAULT_CMR.rho} beta=${DEFAULT_CMR.beta} w=${DEFAULT_CMR.w}`);
    console.log(`Fixtures: ${REINSTATEMENT_FIXTURES.length}`);

    const embedder = await getEmbedder();
    const flat = await runFlat(embedder, REINSTATEMENT_FIXTURES);
    const cmr = await runCmr(embedder, REINSTATEMENT_FIXTURES, DEFAULT_CMR);

    const flatSummary = scoreReinstatement(flat);
    const cmrSummary = scoreReinstatement(cmr);

    console.log("");
    console.log("Per-fixture (target rank / distractor rank):");
    console.log("fixture                          flat           cmr");
    for (let i = 0; i < flat.length; i++) {
        const f = flat[i];
        const c = cmr[i];
        const fPair = `${formatRank(f.targetRank)}/${formatRank(f.distractorRank)}`;
        const cPair = `${formatRank(c.targetRank)}/${formatRank(c.distractorRank)}`;
        console.log(`  ${f.fixtureId.padEnd(32)} ${fPair.padEnd(14)} ${cPair}`);
    }

    console.log("");
    console.log("Summary:");
    for (const s of [flatSummary, cmrSummary]) {
        console.log(
            `  ${s.retriever.padEnd(6)} n=${s.n} MRR=${s.mrr.toFixed(3)} ` +
                `pairAcc=${(s.pairAccuracy * 100).toFixed(1)}% ` +
                `top1=${(s.top1Rate * 100).toFixed(1)}% ` +
                `medianRank=${s.medianTargetRank}`,
        );
    }
    console.log("");
    const delta = cmrSummary.pairAccuracy - flatSummary.pairAccuracy;
    console.log(`Δ pair-accuracy (cmr - flat): ${(delta * 100).toFixed(1)} percentage points`);
    const pass = cmrSummary.pairAccuracy >= 0.8 && flatSummary.pairAccuracy <= 0.6;
    console.log(`Plan pass criterion (cmr ≥ 80%, flat ≤ 60%): ${pass ? "PASS" : "FAIL"}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

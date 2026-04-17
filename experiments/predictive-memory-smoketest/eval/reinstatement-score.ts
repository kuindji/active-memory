import type { ReinstatementRun } from "./reinstatement-adapter.js";

export type ReinstatementSummary = {
    retriever: string;
    n: number;
    mrr: number;
    pairAccuracy: number;
    top1Rate: number;
    medianTargetRank: number;
};

export function scoreReinstatement(runs: ReinstatementRun[]): ReinstatementSummary {
    if (runs.length === 0) {
        return {
            retriever: "n/a",
            n: 0,
            mrr: 0,
            pairAccuracy: 0,
            top1Rate: 0,
            medianTargetRank: 0,
        };
    }
    let rrSum = 0;
    let pairHits = 0;
    let top1 = 0;
    const targetRanks: number[] = [];
    for (const r of runs) {
        rrSum += r.targetRank === Number.POSITIVE_INFINITY ? 0 : 1 / r.targetRank;
        if (r.targetRank < r.distractorRank) pairHits += 1;
        if (r.targetRank === 1) top1 += 1;
        targetRanks.push(r.targetRank);
    }
    targetRanks.sort((a, b) => a - b);
    const mid = Math.floor(targetRanks.length / 2);
    const median =
        targetRanks.length % 2 === 0
            ? (targetRanks[mid - 1] + targetRanks[mid]) / 2
            : targetRanks[mid];
    return {
        retriever: runs[0].retriever,
        n: runs.length,
        mrr: rrSum / runs.length,
        pairAccuracy: pairHits / runs.length,
        top1Rate: top1 / runs.length,
        medianTargetRank: median,
    };
}

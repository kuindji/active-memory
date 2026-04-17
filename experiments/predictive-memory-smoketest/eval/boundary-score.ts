import type { BoundaryRun } from "./boundary-adapter.js";
import type { BoundaryScore } from "../src/types.js";

export type BoundarySummary = BoundaryScore & {
    method: string;
    n: number;
    perFixture: Array<{ fixtureId: string; f1: number; predicted: number; gold: number }>;
};

export function scoreOne(predicted: number[], gold: number[], tolerance = 2): BoundaryScore {
    const goldSet = gold.slice();
    const usedGold = new Set<number>();
    let tp = 0;
    for (const p of predicted) {
        let matchIdx = -1;
        let matchDist = Number.POSITIVE_INFINITY;
        for (let i = 0; i < goldSet.length; i++) {
            if (usedGold.has(i)) continue;
            const d = Math.abs(goldSet[i] - p);
            if (d <= tolerance && d < matchDist) {
                matchDist = d;
                matchIdx = i;
            }
        }
        if (matchIdx >= 0) {
            tp += 1;
            usedGold.add(matchIdx);
        }
    }
    const fp = predicted.length - tp;
    const fn = gold.length - tp;
    const precision = predicted.length === 0 ? (gold.length === 0 ? 1 : 0) : tp / predicted.length;
    const recall = gold.length === 0 ? 1 : tp / gold.length;
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    return { precision, recall, f1, tp, fp, fn };
}

export function scoreBoundary(runs: BoundaryRun[], tolerance = 2): BoundarySummary {
    if (runs.length === 0) {
        return {
            method: "n/a",
            n: 0,
            precision: 0,
            recall: 0,
            f1: 0,
            tp: 0,
            fp: 0,
            fn: 0,
            perFixture: [],
        };
    }
    let tp = 0;
    let fp = 0;
    let fn = 0;
    const perFixture: BoundarySummary["perFixture"] = [];
    for (const r of runs) {
        const s = scoreOne(r.predicted, r.gold, tolerance);
        tp += s.tp;
        fp += s.fp;
        fn += s.fn;
        perFixture.push({
            fixtureId: r.fixtureId,
            f1: s.f1,
            predicted: r.predicted.length,
            gold: r.gold.length,
        });
    }
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    return {
        method: runs[0].method,
        n: runs.length,
        precision,
        recall,
        f1,
        tp,
        fp,
        fn,
        perFixture,
    };
}

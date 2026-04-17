import type { Segmentation } from "./types.js";

/**
 * Contiguous K-segmentation via dynamic programming over within-segment
 * sum-of-squared-errors from segment centroids. Equivalent to Viterbi
 * decoding of a left-to-right Gaussian HMM with tied isotropic covariance,
 * which is the constrained topology Baldassano et al. 2017 use for narrative
 * event segmentation. Exact optimum in O(T^2 * K).
 */

export type HmmSegmenterConfig = {
    kCandidates: number[];
    bicPenalty: number;
};

export const DEFAULT_HMM: HmmSegmenterConfig = {
    kCandidates: [2, 4, 8, 16],
    bicPenalty: 0.01,
};

function prefixSums(embeddings: number[][]): {
    sum: number[][];
    sqSum: number[];
} {
    const T = embeddings.length;
    const d = embeddings[0].length;
    const sum: number[][] = Array.from({ length: T + 1 }, () => new Array<number>(d).fill(0));
    const sqSum: number[] = new Array<number>(T + 1).fill(0);
    for (let t = 0; t < T; t++) {
        let rowSq = 0;
        for (let i = 0; i < d; i++) {
            sum[t + 1][i] = sum[t][i] + embeddings[t][i];
            rowSq += embeddings[t][i] * embeddings[t][i];
        }
        sqSum[t + 1] = sqSum[t] + rowSq;
    }
    return { sum, sqSum };
}

function segmentCost(sum: number[][], sqSum: number[], i: number, j: number): number {
    // Within-segment SSE for points [i..j] (inclusive, 0-indexed):
    // sum of |x_t - mean|^2 = sum |x_t|^2 - n * |mean|^2
    const n = j - i + 1;
    if (n <= 0) return 0;
    const sumSq = sqSum[j + 1] - sqSum[i];
    const d = sum[0].length;
    let meanSq = 0;
    for (let k = 0; k < d; k++) {
        const s = sum[j + 1][k] - sum[i][k];
        meanSq += (s * s) / n;
    }
    const cost = sumSq - meanSq;
    return cost > 0 ? cost : 0;
}

function segmentForK(
    embeddings: number[][],
    k: number,
    sum: number[][],
    sqSum: number[],
): Segmentation {
    const T = embeddings.length;
    if (k <= 1 || T <= k) {
        return { boundaries: [], k: 1, cost: segmentCost(sum, sqSum, 0, T - 1) };
    }
    // dp[segmentsUsed][endIndex] = min cost of covering [0..endIndex] with segmentsUsed segments
    // endIndex is inclusive, 0..T-1
    const INF = Number.POSITIVE_INFINITY;
    const dp: number[][] = Array.from({ length: k + 1 }, () => new Array<number>(T).fill(INF));
    const back: number[][] = Array.from({ length: k + 1 }, () => new Array<number>(T).fill(-1));
    for (let e = 0; e < T; e++) {
        dp[1][e] = segmentCost(sum, sqSum, 0, e);
        back[1][e] = 0;
    }
    for (let s = 2; s <= k; s++) {
        for (let e = s - 1; e < T; e++) {
            // last segment is [start..e], s-1 segments cover [0..start-1]
            let best = INF;
            let bestStart = -1;
            for (let start = s - 1; start <= e; start++) {
                const prev = dp[s - 1][start - 1];
                if (prev === INF) continue;
                const c = prev + segmentCost(sum, sqSum, start, e);
                if (c < best) {
                    best = c;
                    bestStart = start;
                }
            }
            dp[s][e] = best;
            back[s][e] = bestStart;
        }
    }
    // recover boundaries
    const boundaries: number[] = [];
    let segs = k;
    let end = T - 1;
    while (segs > 1) {
        const start = back[segs][end];
        boundaries.push(start);
        end = start - 1;
        segs -= 1;
    }
    boundaries.reverse();
    return { boundaries, k, cost: dp[k][T - 1] };
}

export function hmmSegmentation(embeddings: number[][], k: number): Segmentation {
    const { sum, sqSum } = prefixSums(embeddings);
    return segmentForK(embeddings, k, sum, sqSum);
}

export type HmmSweepResult = {
    best: Segmentation;
    perK: Segmentation[];
};

export function hmmSegmentationSweep(
    embeddings: number[][],
    cfg: HmmSegmenterConfig = DEFAULT_HMM,
): HmmSweepResult {
    const T = embeddings.length;
    const { sum, sqSum } = prefixSums(embeddings);
    const perK: Segmentation[] = cfg.kCandidates.map((k) => segmentForK(embeddings, k, sum, sqSum));

    // BIC-style selection: residual SSE + penalty * K * log(T).
    // SSE on L2-normalized vectors is O(n), not O(n*d), so the complexity
    // term should not carry d — that would dominate every realistic signal.
    // This is a proxy, not a true Gaussian BIC; K selection here is a
    // best-effort fallback when the oracle is unavailable.
    let best = perK[0];
    let bestScore = Number.POSITIVE_INFINITY;
    for (const seg of perK) {
        const complexity = cfg.bicPenalty * seg.k * Math.log(Math.max(T, 2));
        const score = seg.cost + complexity;
        if (score < bestScore) {
            bestScore = score;
            best = seg;
        }
    }
    return { best, perK };
}

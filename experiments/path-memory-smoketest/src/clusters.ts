import { cosineSimilarity } from "../../../src/core/scoring.js";

/**
 * Phase 2.4 — cluster-affinity primitive (Option H).
 *
 * Pure-functional soft k-means over unit-norm embeddings. Used by the
 * retriever's `cluster-affinity-boost` anchor-scoring kind to add a
 * topical-cohesion signal to the Phase-2.1 weighted-fusion aggregate.
 *
 * The clustering is cosine-based (not Euclidean) because the project's
 * embeddings are already unit-normalized and the retriever's primary
 * similarity is cosine — using Euclidean here would measure something
 * subtly different from the rest of the pipeline.
 *
 * Determinism is load-bearing for unit-test stability: the initial
 * centroid draw uses a seeded LCG so the same `(embeddings, k, seed)`
 * always produces the same model.
 */

export type SoftClusterMembership = number[];

export type ClusterModel = {
    k: number;
    centroids: number[][];
};

export type FitKMeansOptions = {
    seed?: number;
    maxIter?: number;
    similarity?: (a: number[], b: number[]) => number;
};

const DEFAULT_MAX_ITER = 25;
const DEFAULT_SEED = 1;
const DEFAULT_TEMPERATURE = 0.1;

export function fitKMeans(
    embeddings: number[][],
    k: number,
    opts: FitKMeansOptions = {},
): ClusterModel {
    if (embeddings.length === 0) throw new Error("fitKMeans: embeddings must be non-empty");
    if (k <= 0) throw new Error("fitKMeans: k must be positive");
    const n = embeddings.length;
    const effectiveK = Math.min(k, n);
    const dim = embeddings[0].length;
    const sim = opts.similarity ?? cosineSimilarity;
    const maxIter = opts.maxIter ?? DEFAULT_MAX_ITER;
    const rng = mulberry32(opts.seed ?? DEFAULT_SEED);

    const centroids = initKMeansPlusPlus(embeddings, effectiveK, sim, rng);
    const assignments = new Array<number>(n).fill(-1);

    for (let iter = 0; iter < maxIter; iter++) {
        let changed = false;
        for (let i = 0; i < n; i++) {
            const best = assignBest(embeddings[i], centroids, sim);
            if (assignments[i] !== best) {
                assignments[i] = best;
                changed = true;
            }
        }
        if (!changed) break;

        const sums: number[][] = Array.from({ length: effectiveK }, () =>
            new Array<number>(dim).fill(0),
        );
        const counts = new Array<number>(effectiveK).fill(0);
        for (let i = 0; i < n; i++) {
            const c = assignments[i];
            const emb = embeddings[i];
            const acc = sums[c];
            for (let d = 0; d < dim; d++) acc[d] += emb[d];
            counts[c] += 1;
        }

        for (let c = 0; c < effectiveK; c++) {
            if (counts[c] === 0) {
                // Dead centroid: reseed to the point least similar to any
                // existing centroid. Keeps k clusters populated without
                // rerunning init from scratch.
                centroids[c] = reseedDeadCentroid(embeddings, centroids, sim);
                continue;
            }
            const v = sums[c];
            const inv = 1 / counts[c];
            for (let d = 0; d < dim; d++) v[d] *= inv;
            centroids[c] = normalize(v);
        }
    }

    return { k: effectiveK, centroids };
}

export function softMembership(
    embedding: number[],
    model: ClusterModel,
    temperature: number = DEFAULT_TEMPERATURE,
    similarity?: (a: number[], b: number[]) => number,
): SoftClusterMembership {
    const sim = similarity ?? cosineSimilarity;
    const temp = Math.max(temperature, 1e-6);
    const sims = model.centroids.map((c) => sim(embedding, c));
    // Softmax with temperature. Subtract max first for numerical stability.
    let maxSim = -Infinity;
    for (const s of sims) if (s > maxSim) maxSim = s;
    const exps = sims.map((s) => Math.exp((s - maxSim) / temp));
    let sum = 0;
    for (const e of exps) sum += e;
    if (sum === 0) return new Array<number>(model.k).fill(1 / model.k);
    return exps.map((e) => e / sum);
}

export function membershipSimilarity(a: SoftClusterMembership, b: SoftClusterMembership): number {
    if (a.length !== b.length) {
        throw new Error(`membershipSimilarity: length mismatch ${a.length} vs ${b.length}`);
    }
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function initKMeansPlusPlus(
    embeddings: number[][],
    k: number,
    sim: (a: number[], b: number[]) => number,
    rng: () => number,
): number[][] {
    const n = embeddings.length;
    const centroids: number[][] = [];
    const firstIdx = Math.floor(rng() * n);
    centroids.push(cloneVec(embeddings[firstIdx]));

    // Track max similarity to any chosen centroid so far — `1 - maxSim` is
    // the distance proxy used to weight the next pick.
    const maxSim = new Array<number>(n);
    for (let i = 0; i < n; i++) maxSim[i] = sim(embeddings[i], centroids[0]);

    while (centroids.length < k) {
        let total = 0;
        const weights = new Array<number>(n);
        for (let i = 0; i < n; i++) {
            const d = Math.max(0, 1 - maxSim[i]);
            const w = d * d;
            weights[i] = w;
            total += w;
        }
        let pickIdx: number;
        if (total === 0) {
            // All remaining points identical to existing centroids.
            // Pick the first unassigned index deterministically.
            pickIdx = firstUnusedIndex(embeddings, centroids, sim);
        } else {
            const r = rng() * total;
            let acc = 0;
            pickIdx = n - 1;
            for (let i = 0; i < n; i++) {
                acc += weights[i];
                if (acc >= r) {
                    pickIdx = i;
                    break;
                }
            }
        }
        centroids.push(cloneVec(embeddings[pickIdx]));
        const newCentroid = centroids[centroids.length - 1];
        for (let i = 0; i < n; i++) {
            const s = sim(embeddings[i], newCentroid);
            if (s > maxSim[i]) maxSim[i] = s;
        }
    }

    return centroids;
}

function assignBest(
    emb: number[],
    centroids: number[][],
    sim: (a: number[], b: number[]) => number,
): number {
    let bestIdx = 0;
    let bestSim = -Infinity;
    for (let c = 0; c < centroids.length; c++) {
        const s = sim(emb, centroids[c]);
        if (s > bestSim) {
            bestSim = s;
            bestIdx = c;
        }
    }
    return bestIdx;
}

function reseedDeadCentroid(
    embeddings: number[][],
    centroids: number[][],
    sim: (a: number[], b: number[]) => number,
): number[] {
    let worstIdx = 0;
    let worstSim = Infinity;
    for (let i = 0; i < embeddings.length; i++) {
        let best = -Infinity;
        for (const c of centroids) {
            const s = sim(embeddings[i], c);
            if (s > best) best = s;
        }
        if (best < worstSim) {
            worstSim = best;
            worstIdx = i;
        }
    }
    return cloneVec(embeddings[worstIdx]);
}

function firstUnusedIndex(
    embeddings: number[][],
    centroids: number[][],
    sim: (a: number[], b: number[]) => number,
): number {
    for (let i = 0; i < embeddings.length; i++) {
        let matched = false;
        for (const c of centroids) {
            if (sim(embeddings[i], c) > 1 - 1e-9) {
                matched = true;
                break;
            }
        }
        if (!matched) return i;
    }
    return 0;
}

function cloneVec(v: number[]): number[] {
    return v.slice();
}

function normalize(v: number[]): number[] {
    let sq = 0;
    for (const x of v) sq += x * x;
    if (sq === 0) return v.slice();
    const inv = 1 / Math.sqrt(sq);
    return v.map((x) => x * inv);
}

function mulberry32(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

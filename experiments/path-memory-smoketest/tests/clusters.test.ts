import { describe, test, expect } from "bun:test";
import {
    fitKMeans,
    membershipSimilarity,
    softMembership,
    type ClusterModel,
} from "../src/clusters.js";

function hashStr(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function pseudoVec(seed: number, dim: number): number[] {
    const v = new Array<number>(dim);
    let state = seed || 1;
    let norm = 0;
    for (let i = 0; i < dim; i++) {
        state = (state * 1664525 + 1013904223) >>> 0;
        const x = (state / 0xffffffff) * 2 - 1;
        v[i] = x;
        norm += x * x;
    }
    const inv = 1 / Math.sqrt(norm);
    for (let i = 0; i < dim; i++) v[i] *= inv;
    return v;
}

/**
 * Build a cluster of `count` near-identical unit vectors around a base
 * direction by perturbing each dimension slightly and renormalizing.
 * Returns near-cosine-1 points within the cluster and well-separated
 * points across clusters (when `base` vectors are themselves well apart).
 */
function clusterAround(base: number[], count: number, jitterSeed: number): number[][] {
    const dim = base.length;
    const out: number[][] = [];
    for (let i = 0; i < count; i++) {
        const jitter = pseudoVec(jitterSeed + i, dim);
        const v = new Array<number>(dim);
        let sq = 0;
        for (let d = 0; d < dim; d++) {
            v[d] = base[d] + 0.02 * jitter[d];
            sq += v[d] * v[d];
        }
        const inv = 1 / Math.sqrt(sq);
        for (let d = 0; d < dim; d++) v[d] *= inv;
        out.push(v);
    }
    return out;
}

describe("fitKMeans", () => {
    test("seeded init produces bit-identical centroids across runs", () => {
        const dim = 32;
        const points = [
            ...clusterAround(pseudoVec(hashStr("A"), dim), 6, 100),
            ...clusterAround(pseudoVec(hashStr("B"), dim), 6, 200),
            ...clusterAround(pseudoVec(hashStr("C"), dim), 6, 300),
        ];
        const a = fitKMeans(points, 3, { seed: 42 });
        const b = fitKMeans(points, 3, { seed: 42 });
        expect(a.k).toBe(3);
        expect(b.k).toBe(3);
        for (let c = 0; c < 3; c++) {
            for (let d = 0; d < dim; d++) {
                expect(a.centroids[c][d]).toBe(b.centroids[c][d]);
            }
        }
    });

    test("recovers three well-separated synthetic clusters", () => {
        const dim = 64;
        const baseA = pseudoVec(hashStr("alpha"), dim);
        const baseB = pseudoVec(hashStr("beta"), dim);
        const baseC = pseudoVec(hashStr("gamma"), dim);
        const points = [
            ...clusterAround(baseA, 8, 10),
            ...clusterAround(baseB, 8, 20),
            ...clusterAround(baseC, 8, 30),
        ];
        const model = fitKMeans(points, 3, { seed: 7 });

        // Every real base vector should have a close centroid (cosine ≥ 0.95).
        for (const base of [baseA, baseB, baseC]) {
            let best = -Infinity;
            for (const c of model.centroids) {
                let dot = 0;
                for (let d = 0; d < dim; d++) dot += base[d] * c[d];
                if (dot > best) best = dot;
            }
            expect(best).toBeGreaterThan(0.95);
        }
    });

    test("clamps k to n when k > embeddings.length", () => {
        const points = [pseudoVec(1, 16), pseudoVec(2, 16), pseudoVec(3, 16)];
        const model = fitKMeans(points, 10, { seed: 1 });
        expect(model.k).toBe(3);
        expect(model.centroids.length).toBe(3);
    });

    test("k = 1 returns a single valid centroid", () => {
        const points = [pseudoVec(1, 16), pseudoVec(2, 16), pseudoVec(3, 16)];
        const model = fitKMeans(points, 1, { seed: 1 });
        expect(model.k).toBe(1);
        expect(model.centroids.length).toBe(1);
        let sq = 0;
        for (const x of model.centroids[0]) sq += x * x;
        // Centroid is re-normalized after averaging, so ‖c‖ ≈ 1.
        expect(Math.abs(sq - 1)).toBeLessThan(1e-6);
    });

    test("rejects empty input and non-positive k", () => {
        expect(() => fitKMeans([], 3)).toThrow();
        expect(() => fitKMeans([pseudoVec(1, 8)], 0)).toThrow();
    });
});

describe("softMembership", () => {
    test("distribution sums to 1 over every cluster count", () => {
        const dim = 32;
        const model: ClusterModel = {
            k: 5,
            centroids: [
                pseudoVec(1, dim),
                pseudoVec(2, dim),
                pseudoVec(3, dim),
                pseudoVec(4, dim),
                pseudoVec(5, dim),
            ],
        };
        const m = softMembership(pseudoVec(99, dim), model, 0.1);
        let sum = 0;
        for (const x of m) sum += x;
        expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
        for (const x of m) expect(x).toBeGreaterThanOrEqual(0);
    });

    test("high temperature → near-uniform; low temperature → peaked", () => {
        const dim = 32;
        const model: ClusterModel = {
            k: 3,
            centroids: [pseudoVec(1, dim), pseudoVec(2, dim), pseudoVec(3, dim)],
        };
        // Pick an embedding close to centroid 0 so the distribution has a clear peak.
        const near0 = model.centroids[0];
        const sharp = softMembership(near0, model, 0.05);
        const flat = softMembership(near0, model, 100);
        const sharpMax = Math.max(...sharp);
        const flatMax = Math.max(...flat);
        expect(sharpMax).toBeGreaterThan(flatMax);
        expect(flatMax).toBeLessThan(0.4); // near-uniform at 1/3 ≈ 0.333
    });
});

describe("membershipSimilarity", () => {
    test("identical distributions return 1", () => {
        const a = [0.1, 0.3, 0.6];
        expect(membershipSimilarity(a, a.slice())).toBeCloseTo(1, 12);
    });

    test("distributions on disjoint clusters return 0", () => {
        expect(membershipSimilarity([1, 0, 0], [0, 1, 0])).toBe(0);
        expect(membershipSimilarity([1, 0, 0, 0], [0, 0, 0, 1])).toBe(0);
    });

    test("bridge distribution has positive similarity to both endpoints", () => {
        const onlyA = [1, 0];
        const onlyB = [0, 1];
        const bridge = [0.5, 0.5];
        const toA = membershipSimilarity(bridge, onlyA);
        const toB = membershipSimilarity(bridge, onlyB);
        expect(toA).toBeGreaterThan(0);
        expect(toB).toBeGreaterThan(0);
        expect(toA).toBeCloseTo(toB, 12);
    });

    test("length mismatch throws", () => {
        expect(() => membershipSimilarity([1, 0], [1, 0, 0])).toThrow();
    });
});

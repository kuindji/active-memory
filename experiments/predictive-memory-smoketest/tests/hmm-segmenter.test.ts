import { describe, test, expect } from "bun:test";
import { hmmSegmentation, hmmSegmentationSweep } from "../src/hmm-segmenter.js";
import { cosineChangeSegmentation } from "../src/cosine-change.js";

function unitVec(d: number, seed: number): number[] {
    // deterministic pseudo-random unit vector for toy streams
    const v = new Array<number>(d);
    let s = seed;
    for (let i = 0; i < d; i++) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        v[i] = (s / 0x7fffffff) * 2 - 1;
    }
    let n = 0;
    for (const x of v) n += x * x;
    n = Math.sqrt(n) || 1;
    for (let i = 0; i < d; i++) v[i] /= n;
    return v;
}

function jitter(base: number[], seed: number, amount: number): number[] {
    const out = base.slice();
    let s = seed;
    for (let i = 0; i < out.length; i++) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        const noise = ((s / 0x7fffffff) * 2 - 1) * amount;
        out[i] += noise;
    }
    let n = 0;
    for (const x of out) n += x * x;
    n = Math.sqrt(n) || 1;
    for (let i = 0; i < out.length; i++) out[i] /= n;
    return out;
}

describe("HMM (DP contiguous K-segmentation)", () => {
    test("recovers the single boundary on a 2-topic toy stream", () => {
        const d = 32;
        const a = unitVec(d, 11);
        const b = unitVec(d, 29);
        const stream: number[][] = [];
        for (let i = 0; i < 8; i++) stream.push(jitter(a, 100 + i, 0.05));
        for (let i = 0; i < 8; i++) stream.push(jitter(b, 200 + i, 0.05));
        const seg = hmmSegmentation(stream, 2);
        expect(seg.boundaries.length).toBe(1);
        // ±1 tolerance for noise
        expect(seg.boundaries[0]).toBeGreaterThanOrEqual(7);
        expect(seg.boundaries[0]).toBeLessThanOrEqual(9);
    });

    test("sweep picks K close to the true segment count on clean synthetic streams", () => {
        const d = 32;
        const topics = [11, 29, 47, 53].map((s) => unitVec(d, s));
        const stream: number[][] = [];
        for (let ti = 0; ti < topics.length; ti++) {
            for (let i = 0; i < 10; i++) stream.push(jitter(topics[ti], ti * 1000 + i, 0.05));
        }
        const sweep = hmmSegmentationSweep(stream, {
            kCandidates: [2, 4, 8, 16],
            bicPenalty: 0.01, // small penalty for tiny toy d
        });
        expect([2, 4]).toContain(sweep.best.k);
    });

    test("cosine-change baseline catches at least some boundaries", () => {
        const d = 32;
        const a = unitVec(d, 11);
        const b = unitVec(d, 29);
        const stream: number[][] = [];
        for (let i = 0; i < 8; i++) stream.push(jitter(a, 100 + i, 0.05));
        for (let i = 0; i < 8; i++) stream.push(jitter(b, 200 + i, 0.05));
        const seg = cosineChangeSegmentation(stream, { zThreshold: 1.0 });
        expect(seg.boundaries.length).toBeGreaterThanOrEqual(1);
    });
});

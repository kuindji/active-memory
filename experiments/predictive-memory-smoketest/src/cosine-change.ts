import { cosineSimilarity } from "../../../src/core/scoring.js";
import type { Segmentation } from "./types.js";

export type CosineChangeConfig = {
    zThreshold: number;
};

export const DEFAULT_COSINE_CHANGE: CosineChangeConfig = { zThreshold: 1.0 };

export function cosineChangeSegmentation(
    embeddings: number[][],
    cfg: CosineChangeConfig = DEFAULT_COSINE_CHANGE,
): Segmentation {
    const T = embeddings.length;
    if (T < 3) return { boundaries: [], k: 1, cost: 0 };

    const changes: number[] = new Array<number>(T - 1);
    for (let t = 1; t < T; t++) {
        changes[t - 1] = 1 - cosineSimilarity(embeddings[t - 1], embeddings[t]);
    }
    let mean = 0;
    for (const v of changes) mean += v;
    mean /= changes.length;
    let variance = 0;
    for (const v of changes) variance += (v - mean) ** 2;
    const std = Math.sqrt(variance / changes.length) || 1e-9;

    const boundaries: number[] = [];
    for (let i = 0; i < changes.length; i++) {
        const z = (changes[i] - mean) / std;
        if (z > cfg.zThreshold) boundaries.push(i + 1);
    }
    return { boundaries, k: boundaries.length + 1, cost: 0 };
}

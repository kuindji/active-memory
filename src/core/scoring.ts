import { encodingForModel } from "js-tiktoken";

let encoder: ReturnType<typeof encodingForModel> | null = null;

function getEncoder() {
    if (!encoder) {
        encoder = encodingForModel("gpt-4o");
    }
    return encoder;
}

export function countTokens(text: string): number {
    return getEncoder().encode(text).length;
}

export function mergeScores(
    scores: { vector?: number; fulltext?: number; graph?: number },
    weights: { vector: number; fulltext: number; graph: number },
    options: { penalizeMissing?: boolean } = {},
): number {
    let total = 0;
    let presentSum = 0;

    if (scores.vector !== undefined) {
        total += scores.vector * weights.vector;
        presentSum += weights.vector;
    }
    if (scores.fulltext !== undefined) {
        total += scores.fulltext * weights.fulltext;
        presentSum += weights.fulltext;
    }
    if (scores.graph !== undefined) {
        total += scores.graph * weights.graph;
        presentSum += weights.graph;
    }

    // When penalizeMissing is true (intended for hybrid search), divide by the
    // full configured weight sum so candidates present in fewer modalities are
    // correctly penalized. Without this, a candidate present in only one
    // modality gets its raw score passed through, outranking multi-modal hits.
    const divisor = options.penalizeMissing
        ? weights.vector + weights.fulltext + weights.graph
        : presentSum;

    return divisor > 0 ? total / divisor : 0;
}

export function computeDecay(
    weight: number,
    timestamp: number,
    now: number,
    lambda: number,
): number {
    if (weight === 0) return 0;
    const hours = (now - timestamp) / (3600 * 1000);
    return weight * Math.exp(-lambda * hours);
}

export function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
}

export function applyTokenBudget<T extends { tokenCount?: number; content?: string }>(
    entries: T[],
    budget: number,
): T[] {
    const result: T[] = [];
    let usedTokens = 0;

    for (const entry of entries) {
        const tokens = entry.tokenCount ?? (entry.content ? countTokens(entry.content) : 0);
        if (usedTokens + tokens > budget) break;
        result.push(entry);
        usedTokens += tokens;
    }

    return result;
}

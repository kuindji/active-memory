import type { EmbeddingAdapter } from "../../../src/core/types.js";
import type { MscDialogue } from "../../path-memory-smoketest/data/msc-loader.js";
import {
    cosineChangeSegmentation,
    DEFAULT_COSINE_CHANGE,
    type CosineChangeConfig,
} from "../src/cosine-change.js";
import { hmmSegmentation } from "../src/hmm-segmenter.js";
import type { BoundaryRun } from "./boundary-adapter.js";

// Phase 1 — H3: real session-boundary recovery.
//
// Flatten all sessions of a dialogue into one turn stream. Gold boundaries are
// the indices where a new MSC session starts (turn 0 of session i, i ≥ 1).
// Run HMM @ oracle K = sessionCount, HMM sweep over k ∈ {2,4,8,16}, and
// cosine-change as the baseline. Scoring via eval/boundary-score.scoreBoundary
// (±2 tolerance, Phase 0 defaults).

export type MscFlatDialogue = {
    dialogueId: number;
    texts: string[];
    goldBoundaries: number[];
    sessionCount: number;
};

export function flattenMscForBoundaries(dialogue: MscDialogue): MscFlatDialogue {
    const texts: string[] = [];
    const gold: number[] = [];
    for (let s = 0; s < dialogue.sessions.length; s++) {
        const session = dialogue.sessions[s];
        if (s > 0) gold.push(texts.length);
        for (const turn of session.turns) {
            texts.push(`${turn.speaker}: ${turn.text}`);
        }
    }
    return {
        dialogueId: dialogue.dialogueId,
        texts,
        goldBoundaries: gold,
        sessionCount: dialogue.sessions.length,
    };
}

async function embedStream(embedder: EmbeddingAdapter, texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (const t of texts) out.push(await embedder.embed(t));
    return out;
}

export async function runMscHmmOracle(
    embedder: EmbeddingAdapter,
    dialogues: MscFlatDialogue[],
): Promise<BoundaryRun[]> {
    const out: BoundaryRun[] = [];
    for (const d of dialogues) {
        const emb = await embedStream(embedder, d.texts);
        const seg = hmmSegmentation(emb, d.sessionCount);
        out.push({
            fixtureId: `msc-${d.dialogueId}`,
            method: `hmm(k=oracle=${d.sessionCount})`,
            predicted: seg.boundaries,
            gold: d.goldBoundaries,
            k: seg.k,
        });
    }
    return out;
}

export async function runMscHmmAtK(
    embedder: EmbeddingAdapter,
    dialogues: MscFlatDialogue[],
    k: number,
): Promise<BoundaryRun[]> {
    const out: BoundaryRun[] = [];
    for (const d of dialogues) {
        const emb = await embedStream(embedder, d.texts);
        const seg = hmmSegmentation(emb, k);
        out.push({
            fixtureId: `msc-${d.dialogueId}`,
            method: `hmm(k=${k})`,
            predicted: seg.boundaries,
            gold: d.goldBoundaries,
            k: seg.k,
        });
    }
    return out;
}

export async function runMscCosineChange(
    embedder: EmbeddingAdapter,
    dialogues: MscFlatDialogue[],
    cfg: CosineChangeConfig = DEFAULT_COSINE_CHANGE,
): Promise<BoundaryRun[]> {
    const out: BoundaryRun[] = [];
    for (const d of dialogues) {
        const emb = await embedStream(embedder, d.texts);
        const seg = cosineChangeSegmentation(emb, cfg);
        out.push({
            fixtureId: `msc-${d.dialogueId}`,
            method: `cosine-change(z=${cfg.zThreshold})`,
            predicted: seg.boundaries,
            gold: d.goldBoundaries,
            k: seg.k,
        });
    }
    return out;
}

export async function embedDialoguesOnce(
    embedder: EmbeddingAdapter,
    dialogues: MscFlatDialogue[],
): Promise<Map<number, number[][]>> {
    const out = new Map<number, number[][]>();
    for (const d of dialogues) {
        out.set(d.dialogueId, await embedStream(embedder, d.texts));
    }
    return out;
}

export function runMscHmmOracleFromCache(
    dialogues: MscFlatDialogue[],
    cache: Map<number, number[][]>,
): BoundaryRun[] {
    const out: BoundaryRun[] = [];
    for (const d of dialogues) {
        const emb = cache.get(d.dialogueId);
        if (!emb) throw new Error(`Missing embeddings for dialogue ${d.dialogueId}`);
        const seg = hmmSegmentation(emb, d.sessionCount);
        out.push({
            fixtureId: `msc-${d.dialogueId}`,
            method: `hmm(k=oracle=${d.sessionCount})`,
            predicted: seg.boundaries,
            gold: d.goldBoundaries,
            k: seg.k,
        });
    }
    return out;
}

export function runMscHmmAtKFromCache(
    dialogues: MscFlatDialogue[],
    cache: Map<number, number[][]>,
    k: number,
): BoundaryRun[] {
    const out: BoundaryRun[] = [];
    for (const d of dialogues) {
        const emb = cache.get(d.dialogueId);
        if (!emb) throw new Error(`Missing embeddings for dialogue ${d.dialogueId}`);
        const seg = hmmSegmentation(emb, k);
        out.push({
            fixtureId: `msc-${d.dialogueId}`,
            method: `hmm(k=${k})`,
            predicted: seg.boundaries,
            gold: d.goldBoundaries,
            k: seg.k,
        });
    }
    return out;
}

export function runMscCosineChangeFromCache(
    dialogues: MscFlatDialogue[],
    cache: Map<number, number[][]>,
    cfg: CosineChangeConfig = DEFAULT_COSINE_CHANGE,
): BoundaryRun[] {
    const out: BoundaryRun[] = [];
    for (const d of dialogues) {
        const emb = cache.get(d.dialogueId);
        if (!emb) throw new Error(`Missing embeddings for dialogue ${d.dialogueId}`);
        const seg = cosineChangeSegmentation(emb, cfg);
        out.push({
            fixtureId: `msc-${d.dialogueId}`,
            method: `cosine-change(z=${cfg.zThreshold})`,
            predicted: seg.boundaries,
            gold: d.goldBoundaries,
            k: seg.k,
        });
    }
    return out;
}

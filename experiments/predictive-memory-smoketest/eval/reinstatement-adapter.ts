import type { EmbeddingAdapter } from "../../../src/core/types.js";
import { CmrRetriever, FlatRetriever, DEFAULT_CMR, type CmrConfig } from "../src/cmr.js";
import type { ReinstatementFixture } from "../data/reinstatement-fixtures.js";

export type ReinstatementRun = {
    fixtureId: string;
    retriever: "flat" | "cmr";
    targetRank: number; // 1-based; Infinity if not found
    distractorRank: number;
    targetScore: number;
    distractorScore: number;
};

async function runOne(
    retriever: FlatRetriever | CmrRetriever,
    fixture: ReinstatementFixture,
): Promise<{
    targetRank: number;
    distractorRank: number;
    targetScore: number;
    distractorScore: number;
}> {
    await retriever.ingestMany(fixture.stream);
    const topK = fixture.stream.length;
    const scored = await retriever.query(fixture.query, topK);
    let targetRank = Number.POSITIVE_INFINITY;
    let distractorRank = Number.POSITIVE_INFINITY;
    let targetScore = 0;
    let distractorScore = 0;
    for (let i = 0; i < scored.length; i++) {
        if (scored[i].id === fixture.targetId) {
            targetRank = i + 1;
            targetScore = scored[i].score;
        }
        if (scored[i].id === fixture.distractorId) {
            distractorRank = i + 1;
            distractorScore = scored[i].score;
        }
    }
    return { targetRank, distractorRank, targetScore, distractorScore };
}

export async function runFlat(
    embedder: EmbeddingAdapter,
    fixtures: ReinstatementFixture[],
): Promise<ReinstatementRun[]> {
    const out: ReinstatementRun[] = [];
    for (const fx of fixtures) {
        const retriever = new FlatRetriever(embedder);
        const r = await runOne(retriever, fx);
        out.push({ fixtureId: fx.id, retriever: "flat", ...r });
    }
    return out;
}

export async function runCmr(
    embedder: EmbeddingAdapter,
    fixtures: ReinstatementFixture[],
    cfg: CmrConfig = DEFAULT_CMR,
): Promise<ReinstatementRun[]> {
    const out: ReinstatementRun[] = [];
    for (const fx of fixtures) {
        const retriever = new CmrRetriever(embedder, cfg);
        const r = await runOne(retriever, fx);
        out.push({ fixtureId: fx.id, retriever: "cmr", ...r });
    }
    return out;
}

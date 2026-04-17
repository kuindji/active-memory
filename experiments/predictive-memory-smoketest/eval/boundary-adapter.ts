import type { EmbeddingAdapter } from "../../../src/core/types.js";
import {
    cosineChangeSegmentation,
    DEFAULT_COSINE_CHANGE,
    type CosineChangeConfig,
} from "../src/cosine-change.js";
import {
    hmmSegmentation,
    hmmSegmentationSweep,
    DEFAULT_HMM,
    type HmmSegmenterConfig,
} from "../src/hmm-segmenter.js";
import type { Segmentation } from "../src/types.js";
import type { BoundaryFixture } from "../data/boundary-fixtures.js";

export type BoundaryRun = {
    fixtureId: string;
    method: string;
    predicted: number[];
    gold: number[];
    k: number;
};

async function embedStream(
    embedder: EmbeddingAdapter,
    fixture: BoundaryFixture,
): Promise<number[][]> {
    const out: number[][] = [];
    for (const turn of fixture.turns) {
        out.push(await embedder.embed(turn.text));
    }
    return out;
}

export async function runCosineChange(
    embedder: EmbeddingAdapter,
    fixtures: BoundaryFixture[],
    cfg: CosineChangeConfig = DEFAULT_COSINE_CHANGE,
): Promise<BoundaryRun[]> {
    const out: BoundaryRun[] = [];
    for (const fx of fixtures) {
        const emb = await embedStream(embedder, fx);
        const seg = cosineChangeSegmentation(emb, cfg);
        out.push({
            fixtureId: fx.id,
            method: `cosine-change(z=${cfg.zThreshold})`,
            predicted: seg.boundaries,
            gold: fx.goldBoundaries,
            k: seg.k,
        });
    }
    return out;
}

export async function runHmmOracleK(
    embedder: EmbeddingAdapter,
    fixtures: BoundaryFixture[],
): Promise<BoundaryRun[]> {
    const out: BoundaryRun[] = [];
    for (const fx of fixtures) {
        const emb = await embedStream(embedder, fx);
        const seg: Segmentation = hmmSegmentation(emb, fx.segmentCount);
        out.push({
            fixtureId: fx.id,
            method: `hmm(k=oracle=${fx.segmentCount})`,
            predicted: seg.boundaries,
            gold: fx.goldBoundaries,
            k: seg.k,
        });
    }
    return out;
}

export async function runHmmSweep(
    embedder: EmbeddingAdapter,
    fixtures: BoundaryFixture[],
    cfg: HmmSegmenterConfig = DEFAULT_HMM,
): Promise<{ best: BoundaryRun[]; perK: Map<number, BoundaryRun[]> }> {
    const best: BoundaryRun[] = [];
    const perK = new Map<number, BoundaryRun[]>();
    for (const k of cfg.kCandidates) perK.set(k, []);
    for (const fx of fixtures) {
        const emb = await embedStream(embedder, fx);
        const sweep = hmmSegmentationSweep(emb, cfg);
        for (const seg of sweep.perK) {
            perK.get(seg.k)?.push({
                fixtureId: fx.id,
                method: `hmm(k=${seg.k})`,
                predicted: seg.boundaries,
                gold: fx.goldBoundaries,
                k: seg.k,
            });
        }
        best.push({
            fixtureId: fx.id,
            method: `hmm(k=${sweep.best.k}, bic-selected)`,
            predicted: sweep.best.boundaries,
            gold: fx.goldBoundaries,
            k: sweep.best.k,
        });
    }
    return { best, perK };
}

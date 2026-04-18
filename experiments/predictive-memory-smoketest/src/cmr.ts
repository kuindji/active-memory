import type { EmbeddingAdapter } from "../../../src/core/types.js";
import { cosineSimilarity } from "../../../src/core/scoring.js";
import type { ContextMemory, ScoredMemory } from "./types.js";

export type CmrConfig = {
    rho: number;
    beta: number;
    w: number;
};

export const DEFAULT_CMR: CmrConfig = { rho: 0.85, beta: 0.5, w: 0.5 };

function l2norm(v: number[]): number[] {
    let s = 0;
    for (const x of v) s += x * x;
    const n = Math.sqrt(s);
    if (n === 0) return v.slice();
    const out = new Array<number>(v.length);
    for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
    return out;
}

function advance(prev: number[], item: number[], rho: number, beta: number): number[] {
    const d = item.length;
    const next = new Array<number>(d);
    for (let i = 0; i < d; i++) next[i] = rho * prev[i] + beta * item[i];
    return l2norm(next);
}

export class CmrRetriever {
    private readonly memories: ContextMemory[] = [];
    private ctx: number[];

    constructor(
        private readonly embedder: EmbeddingAdapter,
        private readonly cfg: CmrConfig = DEFAULT_CMR,
    ) {
        this.ctx = new Array<number>(embedder.dimension).fill(0);
    }

    get context(): number[] {
        return this.ctx;
    }

    resetContext(): void {
        this.ctx = new Array<number>(this.embedder.dimension).fill(0);
    }

    async ingest(
        id: string,
        text: string,
        ts: number = this.memories.length,
    ): Promise<ContextMemory> {
        const content = await this.embedder.embed(text);
        this.ctx = advance(this.ctx, content, this.cfg.rho, this.cfg.beta);
        const memory: ContextMemory = {
            id,
            text,
            content: content.slice(),
            context: this.ctx.slice(),
            ts,
        };
        this.memories.push(memory);
        return memory;
    }

    async ingestMany(turns: Array<{ id: string; text: string }>): Promise<void> {
        for (let i = 0; i < turns.length; i++) {
            await this.ingest(turns[i].id, turns[i].text, i);
        }
    }

    async query(
        text: string,
        topK = 5,
        opts: { mode?: "cue" | "continue" } = {},
    ): Promise<ScoredMemory[]> {
        const mode = opts.mode ?? "cue";
        const qContent = await this.embedder.embed(text);
        // "cue" — cued-recall regime: probe stored contexts with the query item
        // itself (item-to-context similarity, Polyn/Kahana). Appropriate for
        // retrospective queries that don't continue the running stream.
        // "continue" — free-recall regime: advance the running context with the
        // query item. Carries recency bias, which is what the classic CMR
        // serial-position fits require.
        const qContext =
            mode === "continue"
                ? advance(this.ctx, qContent, this.cfg.rho, this.cfg.beta)
                : qContent;
        const { w } = this.cfg;
        const scored = this.memories.map((m) => {
            const cScore = cosineSimilarity(qContent, m.content);
            const ctxScore = cosineSimilarity(qContext, m.context);
            return {
                id: m.id,
                text: m.text,
                contentScore: cScore,
                contextScore: ctxScore,
                score: w * cScore + (1 - w) * ctxScore,
            };
        });
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, topK);
    }

    snapshot(): ContextMemory[] {
        return this.memories.slice();
    }
}

export class FlatRetriever {
    private readonly memories: ContextMemory[] = [];

    constructor(private readonly embedder: EmbeddingAdapter) {}

    async ingest(id: string, text: string, ts: number = this.memories.length): Promise<void> {
        const content = await this.embedder.embed(text);
        this.memories.push({
            id,
            text,
            content: content.slice(),
            context: new Array<number>(content.length).fill(0),
            ts,
        });
    }

    async ingestMany(turns: Array<{ id: string; text: string }>): Promise<void> {
        for (let i = 0; i < turns.length; i++) {
            await this.ingest(turns[i].id, turns[i].text, i);
        }
    }

    async query(text: string, topK = 5): Promise<ScoredMemory[]> {
        const qContent = await this.embedder.embed(text);
        const scored = this.memories.map((m) => {
            const s = cosineSimilarity(qContent, m.content);
            return {
                id: m.id,
                text: m.text,
                contentScore: s,
                contextScore: 0,
                score: s,
            };
        });
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, topK);
    }
}

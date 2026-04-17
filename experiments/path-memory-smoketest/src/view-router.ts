import type { EdgeType, Probe } from "./types.js";

/**
 * Phase 2.11 — MAGMA-inspired per-view router (Option P).
 *
 * Maps a probe set to a `ViewWeights` distribution over the three edge
 * types `temporal | lexical | semantic`. The retriever then uses these
 * weights inside Dijkstra to scale per-edge traversal cost — preferred
 * views become cheaper. See `notes/phase-2.11-reading.md` and the plan
 * file `~/.claude/plans/curried-toasting-sprout.md`.
 *
 * Design notes:
 *  - Deterministic, LLM-free. Features are extracted from the probe
 *    text directly (year regex + keyword match) and from a per-probe
 *    IDF lookup against the graph's IDF table.
 *  - Temporal keywords must be matched on raw text, not on the
 *    project tokenizer's output — the tokenizer's stopword list
 *    strips `when/before/after/since/until/during`.
 *  - Output is normalized so `temporal + lexical + semantic = 1`.
 *    A `semanticFloor` guarantees semantic retains a baseline share
 *    so Dijkstra can still bridge via semantic edges when temporal
 *    and lexical signals dominate.
 */

export type ViewWeights = { [K in EdgeType]: number };

export type ViewRouterConfig = {
    temporalKeywords: string[];
    yearTokenRegex: RegExp;
    lexicalIdfThreshold: number;
    temporalBoost: number;
    lexicalBoost: number;
    semanticFloor: number;
};

export const DEFAULT_VIEW_ROUTER_CONFIG: ViewRouterConfig = {
    temporalKeywords: [
        "when",
        "before",
        "after",
        "during",
        "since",
        "until",
        "ago",
        "year",
        "years",
        "earlier",
        "later",
        "century",
        "era",
    ],
    yearTokenRegex: /\b(1[6-9]\d{2}|20\d{2}|21\d{2}|\d{1,4}\s?(?:bce|bc|ce|ad))\b/i,
    lexicalIdfThreshold: 2.0,
    temporalBoost: 0.5,
    lexicalBoost: 0.3,
    semanticFloor: 0.2,
};

const UNIFORM_WEIGHTS: ViewWeights = {
    temporal: 1 / 3,
    lexical: 1 / 3,
    semantic: 1 / 3,
};

export function uniformViewWeights(): ViewWeights {
    return { ...UNIFORM_WEIGHTS };
}

type RouterDeps = {
    tokenize: (text: string) => string[];
    idfOf: (token: string) => number;
    cfg?: Partial<ViewRouterConfig>;
};

/**
 * Route a probe set to per-view weights. Rules (per probe, mean-pooled
 * across probes at the end):
 *  - If raw text matches `yearTokenRegex` OR contains any
 *    `temporalKeyword` (word-boundary match) → add `temporalBoost` to
 *    the temporal channel.
 *  - If any probe token has IDF ≥ `lexicalIdfThreshold` → add
 *    `lexicalBoost` to the lexical channel.
 *  - Seed `semanticFloor` on the semantic channel. After the above,
 *    the remaining mass to 1 is added to semantic.
 *  - Normalize so channels sum to 1.
 *
 * Empty probe list returns uniform weights.
 */
export function routeProbes(probes: Probe[], deps: RouterDeps): ViewWeights {
    if (probes.length === 0) return uniformViewWeights();
    const cfg: ViewRouterConfig = { ...DEFAULT_VIEW_ROUTER_CONFIG, ...deps.cfg };

    const acc: ViewWeights = { temporal: 0, lexical: 0, semantic: 0 };

    for (const probe of probes) {
        acc.semantic += cfg.semanticFloor;

        const text = probe.text ?? "";
        if (hasTemporalSignal(text, cfg)) {
            acc.temporal += cfg.temporalBoost;
        }

        const tokens = deps.tokenize(text);
        if (hasLexicalSignal(tokens, deps.idfOf, cfg.lexicalIdfThreshold)) {
            acc.lexical += cfg.lexicalBoost;
        }

        // Residual semantic mass — keep each probe's row summing to
        // (temporalBoost + lexicalBoost + semanticFloor) at most;
        // fill to 1.0 with additional semantic weight so no probe
        // can zero out a channel on its own.
        const probeMass =
            cfg.semanticFloor +
            (hasTemporalSignal(text, cfg) ? cfg.temporalBoost : 0) +
            (hasLexicalSignal(tokens, deps.idfOf, cfg.lexicalIdfThreshold) ? cfg.lexicalBoost : 0);
        if (probeMass < 1) {
            acc.semantic += 1 - probeMass;
        }
    }

    return normalize(acc);
}

function hasTemporalSignal(text: string, cfg: ViewRouterConfig): boolean {
    if (!text) return false;
    if (cfg.yearTokenRegex.test(text)) return true;
    const lower = text.toLowerCase();
    for (const kw of cfg.temporalKeywords) {
        const re = new RegExp(`\\b${escapeRegex(kw)}\\b`);
        if (re.test(lower)) return true;
    }
    return false;
}

function hasLexicalSignal(
    tokens: string[],
    idfOf: (token: string) => number,
    threshold: number,
): boolean {
    for (const t of tokens) {
        if (idfOf(t) >= threshold) return true;
    }
    return false;
}

function normalize(w: ViewWeights): ViewWeights {
    const sum = w.temporal + w.lexical + w.semantic;
    if (sum <= 0) return uniformViewWeights();
    return {
        temporal: w.temporal / sum,
        lexical: w.lexical / sum,
        semantic: w.semantic / sum,
    };
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

import { getEmbedder } from "../src/embedder.js";
import { PathMemory } from "../src/interfaces.js";
import { tier2Greek } from "../data/tier2-greek.js";
import { tracesRepeatUser, type RepeatUserTrace } from "./traces-repeat-user.js";
import type { ClaimId, RetrievalOptions, ScoredPath } from "../src/types.js";

// Phase 2.9 — eval-C: repeat-user access-concentration measurement.
// Phase 4a — extended to compare Phase-2.8-default vs edge-hotness gate.
//
// Runs multi-session "repeat user" traces under each `VARIANTS` config and
// reports per-trace access concentration, wall-clock latency, and per-turn
// coverage (overlap between ideal claims and top-K returned paths). Phase 2.9
// pass criterion stays:
//   top-5 edge share >= 5x uniform baseline on at least half of traces.
// Phase 4a adds a latency/accuracy comparison across variants.

const PHASE_2_8_DEFAULT: RetrievalOptions = {
    traversal: "dijkstra",
    temporalHopCost: 0.5,
    probeComposition: "weighted-fusion",
    weightedFusionTau: 0.2,
    anchorTopK: 5,
    resultTopN: 10,
    accessTracking: true,
};

type Variant = {
    label: string;
    options: RetrievalOptions;
};

// Phase 4a — compare baseline against a representative (K, penalty) grid.
// Kept small (baseline + 2 gated variants) to hold per-run cost down while
// covering both a mild penalty and a stronger one at the recommended K=100.
const VARIANTS: Variant[] = [
    { label: "baseline (2.8 default)", options: { ...PHASE_2_8_DEFAULT } },
    {
        label: "4a hotK=100 penalty=1.5",
        options: { ...PHASE_2_8_DEFAULT, hotEdgeTopK: 100, hotEdgeColdPenalty: 1.5 },
    },
    {
        label: "4a hotK=100 penalty=2.0",
        options: { ...PHASE_2_8_DEFAULT, hotEdgeTopK: 100, hotEdgeColdPenalty: 2.0 },
    },
];

const EDGE_RATIO_PASS_THRESHOLD = 5.0;

type TraceResult = {
    name: string;
    variantLabel: string;
    sessions: number;
    turns: number;
    distinctNodes: number;
    distinctEdges: number;
    nodeBumps: number;
    edgeBumps: number;
    top5NodeShare: number;
    top5EdgeShare: number;
    nodeRatio: number;
    edgeRatio: number;
    repeatingPathSets: number;
    sessionPathSetSignatures: string[];
    totalRetrieveMs: number;
    meanCoverage: number;
};

function coverage(ideal: ClaimId[], paths: ScoredPath[], topN: number): number {
    if (ideal.length === 0) return 0;
    const idealSet = new Set(ideal);
    const seen = new Set<ClaimId>();
    const sorted = [...paths].sort((a, b) => b.score - a.score).slice(0, topN);
    for (const p of sorted) for (const id of p.path.nodeIds) seen.add(id);
    let hits = 0;
    for (const id of idealSet) if (seen.has(id)) hits++;
    return hits / idealSet.size;
}

function pathSignature(paths: ScoredPath[], topN: number): string {
    const sorted = [...paths].sort((a, b) => b.score - a.score).slice(0, topN);
    const sets = sorted.map((p) => [...p.path.nodeIds].sort().join(","));
    return sets.join("|");
}

async function runTrace(trace: RepeatUserTrace, variant: Variant): Promise<TraceResult> {
    const embedder = await getEmbedder();
    const memory = new PathMemory({ embedder });
    for (const c of tier2Greek) {
        await memory.ingest({
            id: c.id,
            text: c.text,
            validFrom: c.validFrom,
            supersedes: c.supersedes,
        });
    }

    let turnCount = 0;
    let totalRetrieveMs = 0;
    let coverageSum = 0;
    let coverageTurns = 0;
    const sessionSignatures: string[] = [];

    for (const sessionBlock of trace.sessions) {
        const session = memory.createSession();
        const sessionPaths: ScoredPath[] = [];
        for (const turn of sessionBlock.turns) {
            await session.addProbeSentences(turn.probes);
            const start = performance.now();
            const results = session.retrieve({
                mode: trace.mode,
                ...variant.options,
            });
            totalRetrieveMs += performance.now() - start;
            turnCount++;
            sessionPaths.length = 0;
            sessionPaths.push(...results);
            if (turn.expectedClaimsAfterThisTurn.length > 0) {
                coverageSum += coverage(turn.expectedClaimsAfterThisTurn, results, 5);
                coverageTurns++;
            }
        }
        sessionSignatures.push(pathSignature(sessionPaths, 3));
    }

    const signatureCounts = new Map<string, number>();
    for (const sig of sessionSignatures) {
        if (sig.length === 0) continue;
        signatureCounts.set(sig, (signatureCounts.get(sig) ?? 0) + 1);
    }
    let repeatingPathSets = 0;
    for (const count of signatureCounts.values()) {
        if (count >= 2) repeatingPathSets += count;
    }

    const snap = memory.graph.accessStatsSnapshot();
    const top5NodeCount = snap.nodes.slice(0, 5).reduce((s, n) => s + n.count, 0);
    const top5EdgeCount = snap.edges.slice(0, 5).reduce((s, e) => s + e.count, 0);
    const top5NodeShare = snap.totals.nodeBumps > 0 ? top5NodeCount / snap.totals.nodeBumps : 0;
    const top5EdgeShare = snap.totals.edgeBumps > 0 ? top5EdgeCount / snap.totals.edgeBumps : 0;
    const uniformNodeBase = snap.totals.distinctNodes > 0 ? 5 / snap.totals.distinctNodes : 0;
    const uniformEdgeBase = snap.totals.distinctEdges > 0 ? 5 / snap.totals.distinctEdges : 0;
    const nodeRatio = uniformNodeBase > 0 ? top5NodeShare / uniformNodeBase : 0;
    const edgeRatio = uniformEdgeBase > 0 ? top5EdgeShare / uniformEdgeBase : 0;

    return {
        name: trace.name,
        variantLabel: variant.label,
        sessions: trace.sessions.length,
        turns: turnCount,
        distinctNodes: snap.totals.distinctNodes,
        distinctEdges: snap.totals.distinctEdges,
        nodeBumps: snap.totals.nodeBumps,
        edgeBumps: snap.totals.edgeBumps,
        top5NodeShare,
        top5EdgeShare,
        nodeRatio,
        edgeRatio,
        repeatingPathSets,
        sessionPathSetSignatures: sessionSignatures,
        totalRetrieveMs,
        meanCoverage: coverageTurns > 0 ? coverageSum / coverageTurns : 0,
    };
}

function fmt(n: number, digits = 3): string {
    return n.toFixed(digits);
}

async function main(): Promise<void> {
    console.log("# eval-C repeat-user access concentration + Phase-4a variant comparison (tier2)");

    const byVariant = new Map<string, TraceResult[]>();

    for (const variant of VARIANTS) {
        console.log("");
        console.log(`## variant: ${variant.label}`);
        console.log(
            "trace | sessions | turns | distinctNodes | distinctEdges | top5NodeShare | nodeRatio | top5EdgeShare | edgeRatio | repeatingPaths | retrieveMs | coverage@5",
        );
        const results: TraceResult[] = [];
        for (const trace of tracesRepeatUser) {
            const r = await runTrace(trace, variant);
            results.push(r);
            console.log(
                [
                    r.name.padEnd(40),
                    r.sessions,
                    r.turns,
                    r.distinctNodes,
                    r.distinctEdges,
                    fmt(r.top5NodeShare),
                    fmt(r.nodeRatio, 2),
                    fmt(r.top5EdgeShare),
                    fmt(r.edgeRatio, 2),
                    r.repeatingPathSets,
                    r.totalRetrieveMs.toFixed(1),
                    fmt(r.meanCoverage),
                ].join(" | "),
            );
        }
        byVariant.set(variant.label, results);

        const passing = results.filter((r) => r.edgeRatio >= EDGE_RATIO_PASS_THRESHOLD).length;
        const half = Math.ceil(results.length / 2);
        const verdict = passing >= half ? "PASS" : "FAIL";
        console.log(
            `Pass count: ${passing}/${results.length} traces with edgeRatio >= ${EDGE_RATIO_PASS_THRESHOLD.toFixed(1)} (threshold: >= ${half})`,
        );
        console.log(`Verdict: ${verdict}`);

        const meanNodeRatio =
            results.reduce((s, r) => s + r.nodeRatio, 0) / Math.max(1, results.length);
        const meanEdgeRatio =
            results.reduce((s, r) => s + r.edgeRatio, 0) / Math.max(1, results.length);
        const meanRetrieveMs =
            results.reduce((s, r) => s + r.totalRetrieveMs, 0) / Math.max(1, results.length);
        const meanCoverage =
            results.reduce((s, r) => s + r.meanCoverage, 0) / Math.max(1, results.length);
        console.log(
            `Mean across traces: nodeRatio=${fmt(meanNodeRatio, 2)}, edgeRatio=${fmt(meanEdgeRatio, 2)}, retrieveMs=${meanRetrieveMs.toFixed(1)}, coverage@5=${fmt(meanCoverage)}`,
        );
    }

    // Phase 4a comparison: delta of 4a variants vs baseline on latency + coverage.
    const baseline = byVariant.get(VARIANTS[0].label);
    if (baseline) {
        console.log("");
        console.log("## Phase 4a comparison vs baseline (per-trace)");
        console.log(
            "variant | mean Δlatency | mean Δcoverage@5 | any latency regression | any coverage regression",
        );
        for (let i = 1; i < VARIANTS.length; i++) {
            const label = VARIANTS[i].label;
            const results = byVariant.get(label);
            if (!results) continue;
            let latencySum = 0;
            let coverageSum = 0;
            let latencyRegress = 0;
            let coverageRegress = 0;
            for (let t = 0; t < results.length; t++) {
                const b = baseline[t];
                const v = results[t];
                latencySum += v.totalRetrieveMs - b.totalRetrieveMs;
                coverageSum += v.meanCoverage - b.meanCoverage;
                if (v.totalRetrieveMs > b.totalRetrieveMs * 1.05) latencyRegress++;
                if (v.meanCoverage < b.meanCoverage - 0.02) coverageRegress++;
            }
            const meanDLatency = latencySum / Math.max(1, results.length);
            const meanDCoverage = coverageSum / Math.max(1, results.length);
            console.log(
                [
                    label.padEnd(30),
                    `${meanDLatency >= 0 ? "+" : ""}${meanDLatency.toFixed(1)}ms`,
                    `${meanDCoverage >= 0 ? "+" : ""}${fmt(meanDCoverage)}`,
                    `${latencyRegress}/${results.length}`,
                    `${coverageRegress}/${results.length}`,
                ].join(" | "),
            );
        }
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

/**
 * Phase 2.11 router dry-run (step 2 of plan verification).
 *
 * Prints the ViewWeights distribution produced by `routeProbes` for every
 * eval-A tier-2 query probe. The phase is gated on this — if ≥ 80% of
 * probes land within ±0.05 of uniform {1/3, 1/3, 1/3}, stop and tune
 * thresholds (or bail to opt-in-only).
 *
 * Run: TIER=tier2 bun scripts/phase-2.11-router-dryrun.ts
 */

import { GraphIndex } from "../src/graph.js";
import { tokenize } from "../src/tokenize.js";
import { routeProbes, type ViewWeights } from "../src/view-router.js";
import { tier2Greek } from "../data/tier2-greek.js";
import { tier1Alex } from "../data/tier1-alex.js";
import { queriesTier2 } from "../eval/queries-tier2.js";
import { queriesTier1 } from "../eval/queries-tier1.js";
import type { Claim } from "../src/types.js";

const TIER = (process.env.TIER ?? "tier2").toLowerCase();
const DATASET =
    TIER === "tier1"
        ? { claims: tier1Alex, queries: queriesTier1 }
        : { claims: tier2Greek, queries: queriesTier2 };

// Build a minimal graph for IDF. Embeddings aren't needed — the router
// only reads idfOf() and raw probe text. We pass a zero vector so
// semantic edges never form (they'd be cosine 0 vs 0, NaN-guarded).
const graph = new GraphIndex({ semanticThreshold: 2 }); // impossible to clear → no semantic edges
const zeroVec: number[] = Array.from({ length: 8 }, () => 0);
for (const c of DATASET.claims) {
    const tokens = tokenize(c.text);
    const claim: Claim = {
        id: c.id,
        text: c.text,
        embedding: zeroVec,
        tokens,
        validFrom: c.validFrom,
        validUntil: Number.POSITIVE_INFINITY,
        supersedes: c.supersedes,
    };
    graph.addClaim(claim);
}

const UNIFORM = 1 / 3;
const EPS = 0.05;
const isUniform = (w: ViewWeights): boolean =>
    Math.abs(w.temporal - UNIFORM) < EPS &&
    Math.abs(w.lexical - UNIFORM) < EPS &&
    Math.abs(w.semantic - UNIFORM) < EPS;

function fmt(x: number): string {
    return x.toFixed(3);
}

let totalProbes = 0;
let uniformProbes = 0;
const perQueryRows: string[] = [];

for (const q of DATASET.queries) {
    for (let i = 0; i < q.probes.length; i++) {
        const probeText = q.probes[i];
        const weights = routeProbes([{ text: probeText, embedding: [] }], {
            tokenize,
            idfOf: (t) => graph.idf(t),
        });
        totalProbes++;
        const uniform = isUniform(weights);
        if (uniform) uniformProbes++;
        perQueryRows.push(
            [
                q.name.slice(0, 32).padEnd(32),
                `#${i}`,
                fmt(weights.temporal),
                fmt(weights.lexical),
                fmt(weights.semantic),
                uniform ? "UNIFORM" : "",
                `"${probeText.slice(0, 64)}"`,
            ].join(" | "),
        );
    }
}

console.log(`# Phase 2.11 router dry-run  tier=${TIER}`);
console.log(
    `# claims=${DATASET.claims.length}  queries=${DATASET.queries.length}  probes=${totalProbes}`,
);
console.log(
    `# idf range (sample): the=${fmt(graph.idf("the"))} peloponnesian=${fmt(graph.idf("peloponnesian"))}`,
);
console.log();
console.log(
    `query                            | #  | temporal | lexical | semantic | flag    | text`,
);
console.log("-".repeat(120));
for (const row of perQueryRows) console.log(row);
console.log();

const uniformShare = uniformProbes / totalProbes;
console.log(`# SUMMARY`);
console.log(`#   probes      ${totalProbes}`);
console.log(`#   uniform     ${uniformProbes}  (${(uniformShare * 100).toFixed(1)}%)`);
console.log(
    `#   gate:       ${uniformShare >= 0.8 ? "FAIL — router is flat on this corpus; bail to opt-in" : "PASS — router partitions probes; proceed to integration"}`,
);

// Channel summaries
const sums = { temporal: 0, lexical: 0, semantic: 0 };
for (const q of DATASET.queries) {
    for (const probeText of q.probes) {
        const w = routeProbes([{ text: probeText, embedding: [] }], {
            tokenize,
            idfOf: (t) => graph.idf(t),
        });
        sums.temporal += w.temporal;
        sums.lexical += w.lexical;
        sums.semantic += w.semantic;
    }
}
console.log(
    `#   mean weights: temporal=${fmt(sums.temporal / totalProbes)} lexical=${fmt(sums.lexical / totalProbes)} semantic=${fmt(sums.semantic / totalProbes)}`,
);

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClaimSpec } from "./tier1-alex.js";

// Tier 3 — Wikipedia corpus (~5000 atomic claims across disparate domains).
//
// Claims are produced offline by `scripts/tier3-fetch.ts` + `scripts/tier3-split.ts`
// and serialized to `tier3-wikipedia.jsonl`. This module parses that file lazily
// at import time and re-exports the claims as a `ClaimSpec[]` matching the
// tier-1 / tier-2 shape.
//
// `validFrom` is a monotonic integer assigned at split time, starting at 0 and
// incrementing globally across the corpus. This matches the tier-2 "years since
// 800 BCE" convention — the retriever only cares about monotonicity.
//
// ID prefix convention is whatever `tier3-articles.json` assigned per article
// (e.g. `bio_photosynthesis_000`, `astro_jupiter_042`).

const here = dirname(fileURLToPath(import.meta.url));
const JSONL_PATH = resolve(here, "tier3-wikipedia.jsonl");

function loadClaims(): ClaimSpec[] {
    const raw = readFileSync(JSONL_PATH, "utf8");
    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    const claims: ClaimSpec[] = [];
    for (const line of lines) {
        const parsed = JSON.parse(line) as ClaimSpec;
        claims.push(parsed);
    }
    return claims;
}

export const tier3Wikipedia: ClaimSpec[] = loadClaims();

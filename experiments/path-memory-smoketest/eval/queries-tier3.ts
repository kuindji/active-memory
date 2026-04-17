import type { ClaimId, RetrievalMode } from "../src/types.js";

// Tier 3 stub queries — hand-authored against the 5-article stub corpus
// (~393 claims spanning biology, architecture, astronomy, music, geography).
//
// Categories:
//   within-cluster recall     (1-6) — ideal claims all share the same id
//                                      prefix; tests single-domain recall.
//   multi-form within-cluster (7-8) — same topic stated in multiple claims
//                                      across an article's chunks; tests
//                                      redundancy-aware ranking.
//   strong-literal-cue        (9)   — high-specificity query that the
//                                      baseline should handle well.
//   cross-cluster multi-probe (10)  — ideal claims live in different id
//                                      prefixes; exercises A2/A3-style
//                                      scoring.
//
// validFrom numbers (from the generated JSONL) are not referenced here —
// mode defaults to current-time queries. If we later add as-of queries
// for the stub, they can set `mode: { kind: "as-of", at: N }`.

export type EvalQueryTier3 = {
    name: string;
    probes: string[];
    naturalQuery: string;
    ideal: ClaimId[];
    mode?: RetrievalMode;
};

export const queriesTier3: EvalQueryTier3[] = [
    // --- within-cluster recall ----------------------------------------
    {
        name: "Calvin cycle",
        probes: ["Calvin cycle carbon fixation", "light-independent reactions photosynthesis"],
        naturalQuery: "What happens in the Calvin cycle?",
        ideal: [
            "bio_photosynthesis_004",
            "bio_photosynthesis_020",
            "bio_photosynthesis_021",
            "bio_photosynthesis_022",
            "bio_photosynthesis_023",
        ],
    },
    {
        name: "Eiffel Tower construction",
        probes: ["who built the Eiffel Tower", "when was the Eiffel Tower built"],
        naturalQuery: "Who built the Eiffel Tower and when?",
        ideal: ["arch_eiffel-tower_001", "arch_eiffel-tower_002"],
    },
    {
        name: "Jupiter moons",
        probes: ["moons of Jupiter", "Jupiter satellite system"],
        naturalQuery: "How many moons does Jupiter have?",
        ideal: ["astro_jupiter_004"],
    },
    {
        name: "Bach birth and death",
        probes: ["when was Bach born", "Bach life dates"],
        naturalQuery: "When did Bach live?",
        ideal: ["music_johann-sebastian-bach_000"],
    },
    {
        name: "first ascent of Everest",
        probes: ["who first climbed Mount Everest", "1953 Everest expedition"],
        naturalQuery: "Who first summited Mount Everest?",
        ideal: ["geo_mount-everest_005"],
    },
    {
        name: "Bach marriages",
        probes: ["Bach wives", "Bach marriage spouse"],
        naturalQuery: "Whom did Bach marry?",
        ideal: [
            "music_johann-sebastian-bach_013",
            "music_johann-sebastian-bach_014",
            "music_johann-sebastian-bach_015",
        ],
    },

    // --- multi-form within-cluster ------------------------------------
    {
        name: "oxygen production in photosynthesis",
        probes: ["how plants produce oxygen", "water splitting photosynthesis"],
        naturalQuery: "How does photosynthesis produce oxygen?",
        ideal: ["bio_photosynthesis_001", "bio_photosynthesis_010", "bio_photosynthesis_018"],
    },
    {
        name: "Mount Everest height",
        probes: ["how tall is Mount Everest", "Everest elevation meters"],
        naturalQuery: "How tall is Mount Everest?",
        ideal: ["geo_mount-everest_002", "geo_mount-everest_011", "geo_mount-everest_014"],
    },

    // --- strong-literal-cue control -----------------------------------
    {
        name: "Great Red Spot",
        probes: ["Great Red Spot Jupiter", "Jupiter's largest storm"],
        naturalQuery: "What is Jupiter's Great Red Spot?",
        ideal: ["astro_jupiter_003"],
    },

    // --- cross-cluster multi-probe ------------------------------------
    {
        name: "Mendelssohn revives Bach",
        probes: ["who revived Bach's music", "Bach Revival 19th century performance"],
        naturalQuery: "Who revived Bach's music in the 19th century?",
        ideal: ["music_johann-sebastian-bach_003", "music_johann-sebastian-bach_063"],
    },
];

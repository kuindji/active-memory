import type { ConversationTrace } from "./conversation-traces-tier2.js";

// Tier 3 stub arcs — 3 multi-turn conversation traces on the 5-article stub
// (bio / arch / astro / music / geo, ~393 claims). Each arc progressively
// narrows toward a specific cluster of target claims in a single domain.
// The within-domain narrowing is the regime Option M's IDF-specificity lift
// is designed for (Phase 2.6 bottleneck: within-cluster granularity).
//
// When the full ~5000-claim corpus lands, these three arcs are kept + an
// additional 1-3 arcs are added to reach the 4-6-arc target from the plan.

export const tracesTier3: ConversationTrace[] = [
    {
        name: "photosynthesis narrowing",
        description:
            "Narrows from photosynthesis broadly, through light-dependent reactions, to water photolysis in photosystem II — within-cluster granularity stress on bio_.",
        turns: [
            {
                probes: [
                    "what is photosynthesis",
                    "how plants convert sunlight to chemical energy",
                ],
                naturalQuery: "What is photosynthesis?",
                expectedClaimsAfterThisTurn: [
                    "bio_photosynthesis_000",
                    "bio_photosynthesis_001",
                    "bio_photosynthesis_002",
                ],
            },
            {
                probes: [
                    "light-dependent reactions in photosynthesis",
                    "thylakoid membrane reactions",
                ],
                naturalQuery: "What happens in the light-dependent reactions?",
                expectedClaimsAfterThisTurn: [
                    "bio_photosynthesis_008",
                    "bio_photosynthesis_009",
                    "bio_photosynthesis_015",
                    "bio_photosynthesis_017",
                ],
            },
            {
                probes: [
                    "water oxidation in photosystem II",
                    "how water photolysis releases oxygen",
                ],
                naturalQuery: "How exactly does photosystem II split water?",
                expectedClaimsAfterThisTurn: ["bio_photosynthesis_010", "bio_photosynthesis_018"],
            },
        ],
    },
    {
        name: "Bach Leipzig career arc",
        description:
            "Narrows from Bach's life broadly, through his German composer career, to his specific Leipzig Thomaskantor tenure — within-cluster granularity stress on music_.",
        turns: [
            {
                probes: ["who was Johann Sebastian Bach", "Bach's life and career"],
                naturalQuery: "Who was Bach?",
                expectedClaimsAfterThisTurn: [
                    "music_johann-sebastian-bach_000",
                    "music_johann-sebastian-bach_001",
                    "music_johann-sebastian-bach_002",
                ],
            },
            {
                probes: ["Bach's posts as a church musician", "Bach's positions in German cities"],
                naturalQuery: "Where did Bach work?",
                expectedClaimsAfterThisTurn: [
                    "music_johann-sebastian-bach_005",
                    "music_johann-sebastian-bach_023",
                ],
            },
            {
                probes: ["Bach as Thomaskantor in Leipzig", "Bach's Leipzig tenure 1723"],
                naturalQuery: "What was Bach's role in Leipzig?",
                expectedClaimsAfterThisTurn: [
                    "music_johann-sebastian-bach_005",
                    "music_johann-sebastian-bach_023",
                ],
            },
        ],
    },
    {
        name: "Everest height resolution arc",
        description:
            "Narrows from Everest's height broadly, through the rock-vs-snow dispute, to the 2020 joint China-Nepal announcement — within-cluster granularity stress on geo_.",
        turns: [
            {
                probes: ["how tall is Mount Everest", "Everest elevation measurements"],
                naturalQuery: "How tall is Mount Everest?",
                expectedClaimsAfterThisTurn: [
                    "geo_mount-everest_002",
                    "geo_mount-everest_011",
                    "geo_mount-everest_014",
                ],
            },
            {
                probes: [
                    "dispute over Everest's official height",
                    "rock versus snow height controversy Everest",
                ],
                naturalQuery: "Why was Everest's official height disputed?",
                expectedClaimsAfterThisTurn: ["geo_mount-everest_012", "geo_mount-everest_013"],
            },
            {
                probes: [
                    "2020 joint announcement of Everest's height",
                    "China and Nepal agree on Everest height",
                ],
                naturalQuery: "How was the height dispute resolved?",
                expectedClaimsAfterThisTurn: ["geo_mount-everest_014"],
            },
        ],
    },
];

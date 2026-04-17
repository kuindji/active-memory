import type { Turn } from "../src/types.js";

export type BoundaryFixture = {
    id: string;
    turns: Turn[];
    goldBoundaries: number[]; // indices at which a new segment begins (>0)
    segmentCount: number;
};

/**
 * Seeded synthetic topic-switch streams. Each fixture concatenates segments
 * drawn from a pool of distinct topics; gold boundaries sit at the junction
 * points. Deterministic — no RNG at test time.
 */

type Topic = {
    name: string;
    sentences: string[];
};

const TOPICS: Topic[] = [
    {
        name: "cooking",
        sentences: [
            "I chopped the onions and sweated them in olive oil.",
            "The garlic went in next, just until fragrant.",
            "I deglazed the pan with a splash of white wine.",
            "The tomatoes broke down after twenty minutes of simmering.",
            "Fresh basil went in at the very end.",
            "I tasted the sauce and added a pinch of salt.",
            "The pasta water was salty enough to taste of the sea.",
            "I reserved a cup of starchy water before draining.",
            "Everything came together on the plate with a drizzle of oil.",
            "Dinner was on the table by eight.",
        ],
    },
    {
        name: "programming",
        sentences: [
            "I pulled the latest changes from main before starting.",
            "The failing test pointed to a missing null check.",
            "I added a guard clause and re-ran the suite.",
            "All the unit tests came back green.",
            "I opened a PR with a short description.",
            "The linter flagged three unused imports.",
            "I cleaned those up and pushed a new commit.",
            "Reviewer asked for a better variable name.",
            "I renamed it and updated the tests accordingly.",
            "CI finally turned green after the third try.",
        ],
    },
    {
        name: "hiking",
        sentences: [
            "We parked at the trailhead just after sunrise.",
            "The first mile climbed steeply through pine forest.",
            "The ridge opened up to a sweeping valley view.",
            "We stopped for water and trail mix at the overlook.",
            "The descent was rocky and slow on tired legs.",
            "A marmot whistled from the talus slope.",
            "Our boots were caked in dust by noon.",
            "We filtered water from a clear creek.",
            "The final switchbacks felt endless in the heat.",
            "We reached the car exhausted but happy.",
        ],
    },
    {
        name: "music",
        sentences: [
            "The piano was slightly out of tune in the upper register.",
            "I worked through the first movement slowly.",
            "The trickiest passage has irregular accents.",
            "My teacher marked fingerings in the score.",
            "I recorded myself to catch the rushed bars.",
            "The left hand still drags behind the right.",
            "I practiced with the metronome at sixty.",
            "Gradually nudged the tempo up to performance speed.",
            "The pedaling needs to be more sparing.",
            "I'll play it for my teacher on Thursday.",
        ],
    },
    {
        name: "gardening",
        sentences: [
            "I planted the tomato seedlings after the last frost.",
            "The basil went in between them as a companion.",
            "I staked each plant with bamboo and twine.",
            "Compost went around the base and was watered in.",
            "The zucchini seeds sprouted in three days.",
            "I thinned the seedlings to one per hill.",
            "Slugs found the lettuce overnight.",
            "I set out beer traps around the bed.",
            "The peppers took longer than expected to germinate.",
            "Everything is finally looking established.",
        ],
    },
    {
        name: "cycling",
        sentences: [
            "I pumped the tires to ninety psi before leaving.",
            "The first climb settled my legs in.",
            "I shifted into the small ring for the steep section.",
            "The descent curved through shaded switchbacks.",
            "My cadence hovered around ninety on the flats.",
            "A headwind picked up by mile twenty.",
            "I tucked low over the bars and pushed through.",
            "The route looped back past an old dairy.",
            "I refilled bottles at a gas station.",
            "Finished the ride in under three hours.",
        ],
    },
    {
        name: "astronomy",
        sentences: [
            "The sky was clear and dark out past the reservoir.",
            "I set up the telescope and let it cool.",
            "Jupiter was rising just above the trees.",
            "Four moons lined up neatly beside it.",
            "I swapped eyepieces for more magnification.",
            "The cloud bands were crisp in the eyepiece.",
            "Later, I tracked down the Orion nebula.",
            "The trapezium stars were razor sharp.",
            "I took a few afocal photos with my phone.",
            "Packed up around two in the morning.",
        ],
    },
    {
        name: "finance",
        sentences: [
            "Quarterly earnings came in above the consensus estimate.",
            "Revenue grew twelve percent year over year.",
            "Operating margin expanded by sixty basis points.",
            "Guidance for next quarter was raised modestly.",
            "The stock jumped on the conference call.",
            "Management flagged supply-chain risk going forward.",
            "Capex was slightly higher than analysts expected.",
            "Free cash flow conversion remained strong.",
            "The balance sheet is healthier than it's been in years.",
            "I updated my model with the new figures.",
        ],
    },
];

function buildFixture(
    id: string,
    topicOrder: Array<{ topic: string; count: number; startAt: number }>,
): BoundaryFixture {
    const turns: Turn[] = [];
    const boundaries: number[] = [];
    let cursor = 0;
    for (let segmentIdx = 0; segmentIdx < topicOrder.length; segmentIdx++) {
        const { topic, count, startAt } = topicOrder[segmentIdx];
        const pool = TOPICS.find((t) => t.name === topic);
        if (!pool) throw new Error(`Unknown topic: ${topic}`);
        if (segmentIdx > 0) boundaries.push(cursor);
        for (let i = 0; i < count; i++) {
            const s = pool.sentences[(startAt + i) % pool.sentences.length];
            turns.push({ id: `${id}-${cursor}`, text: s });
            cursor += 1;
        }
    }
    return {
        id,
        turns,
        goldBoundaries: boundaries,
        segmentCount: topicOrder.length,
    };
}

export const BOUNDARY_FIXTURES: BoundaryFixture[] = [
    buildFixture("two-topic-short", [
        { topic: "cooking", count: 8, startAt: 0 },
        { topic: "programming", count: 8, startAt: 0 },
    ]),
    buildFixture("three-topic-even", [
        { topic: "hiking", count: 7, startAt: 0 },
        { topic: "music", count: 7, startAt: 0 },
        { topic: "gardening", count: 7, startAt: 0 },
    ]),
    buildFixture("four-topic-mixed-length", [
        { topic: "cooking", count: 6, startAt: 2 },
        { topic: "astronomy", count: 9, startAt: 0 },
        { topic: "finance", count: 5, startAt: 0 },
        { topic: "cycling", count: 8, startAt: 1 },
    ]),
    buildFixture("five-topic-varied", [
        { topic: "programming", count: 5, startAt: 0 },
        { topic: "hiking", count: 6, startAt: 3 },
        { topic: "astronomy", count: 5, startAt: 0 },
        { topic: "gardening", count: 7, startAt: 2 },
        { topic: "music", count: 6, startAt: 0 },
    ]),
    buildFixture("six-topic-stress", [
        { topic: "cooking", count: 4, startAt: 0 },
        { topic: "programming", count: 5, startAt: 3 },
        { topic: "finance", count: 4, startAt: 5 },
        { topic: "cycling", count: 5, startAt: 2 },
        { topic: "astronomy", count: 5, startAt: 4 },
        { topic: "gardening", count: 5, startAt: 6 },
    ]),
];

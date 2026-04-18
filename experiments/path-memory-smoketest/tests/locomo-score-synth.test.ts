import { describe, test, expect } from "bun:test";
import {
    scoreLocomoResult,
    aggregateLocomoOverall,
    aggregateLocomoByCategory,
} from "../eval/locomo-score.js";
import type { LocomoQuestionResult } from "../eval/locomo-adapter.js";

function base(overrides: Partial<LocomoQuestionResult>): LocomoQuestionResult {
    return {
        sampleId: "s1",
        questionIndex: 0,
        category: "cat-1",
        questionText: "q?",
        goldAnswer: "Boston",
        adversarial: false,
        evidenceDiaIds: ["d1"],
        ingestedClaimCount: 0,
        topPaths: [],
        retrievedClaimIds: [],
        retrievedClaimTexts: ["Alice moved to Boston in 2023."],
        retrievedDiaIds: ["d1"],
        ingestMs: 0,
        retrieveMs: 0,
        ...overrides,
    };
}

describe("scoreLocomoResult — synth bundle", () => {
    test("synthMetrics is undefined when no synthesizedAnswer", () => {
        const s = scoreLocomoResult(base({}));
        expect(s.synthMetrics).toBeUndefined();
    });

    test("synth contain hits when gold appears in synthesizedAnswer", () => {
        const s = scoreLocomoResult(
            base({ synthesizedAnswer: "Boston", synthAbstained: false, synthMs: 1 }),
        );
        expect(s.synthMetrics).toBeDefined();
        expect(s.synthMetrics!.substringContainment).toBe(true);
        expect(s.synthMetrics!.abstained).toBe(false);
        expect(s.synthMetrics!.falseAbstention).toBe(false);
    });

    test("synth contain misses when synthesizer rephrases away from gold", () => {
        const s = scoreLocomoResult(
            base({
                synthesizedAnswer: "Massachusetts",
                synthAbstained: false,
                synthMs: 1,
            }),
        );
        expect(s.synthMetrics!.substringContainment).toBe(false);
    });

    test("abstention on answerable question is flagged as falseAbstention", () => {
        const s = scoreLocomoResult(
            base({
                synthesizedAnswer: "Not mentioned",
                synthAbstained: true,
                synthMs: 1,
            }),
        );
        expect(s.synthMetrics!.abstained).toBe(true);
        expect(s.synthMetrics!.falseAbstention).toBe(true);
    });

    test("abstention on adversarial question is not falseAbstention", () => {
        const s = scoreLocomoResult(
            base({
                adversarial: true,
                evidenceDiaIds: [],
                synthesizedAnswer: "Not mentioned",
                synthAbstained: true,
                synthMs: 1,
            }),
        );
        expect(s.synthMetrics!.abstained).toBe(true);
        expect(s.synthMetrics!.falseAbstention).toBe(false);
    });
});

describe("aggregateLocomoOverall — synth fields", () => {
    test("synth aggregates computed when at least one score has synthMetrics", () => {
        const scores = [
            scoreLocomoResult(
                base({
                    questionIndex: 0,
                    goldAnswer: "Boston",
                    retrievedClaimTexts: ["Alice moved to Boston."],
                    synthesizedAnswer: "Boston",
                    synthAbstained: false,
                    synthMs: 5,
                }),
            ),
            scoreLocomoResult(
                base({
                    questionIndex: 1,
                    goldAnswer: "Paris",
                    retrievedClaimTexts: ["She lives abroad."],
                    synthesizedAnswer: "Not mentioned",
                    synthAbstained: true,
                    synthMs: 4,
                }),
            ),
        ];
        const agg = aggregateLocomoOverall(scores);
        expect(agg.synthScoredCount).toBe(2);
        expect(agg.synthSubstringContainmentRate).toBeCloseTo(0.5, 5);
        expect(agg.falseAbstentionCount).toBe(1);
        expect(agg.abstentionCount).toBe(1);
        expect(agg.synthMeanMs).toBeCloseTo(4.5, 5);
    });

    test("synth aggregates absent when no score has synthMetrics", () => {
        const scores = [scoreLocomoResult(base({}))];
        const agg = aggregateLocomoOverall(scores);
        expect(agg.synthScoredCount).toBe(0);
        expect(agg.synthSubstringContainmentRate).toBe(0);
        expect(agg.falseAbstentionCount).toBe(0);
    });

    test("adversarial abstention counted in abstentionCount but not falseAbstention", () => {
        const scores = [
            scoreLocomoResult(
                base({
                    adversarial: true,
                    evidenceDiaIds: [],
                    synthesizedAnswer: "Not mentioned",
                    synthAbstained: true,
                    synthMs: 3,
                }),
            ),
        ];
        const agg = aggregateLocomoOverall(scores);
        expect(agg.abstentionCount).toBe(1);
        expect(agg.falseAbstentionCount).toBe(0);
    });
});

describe("aggregateLocomoByCategory — synth fields", () => {
    test("per-category synth containment rate is computed across answerables", () => {
        const scores = [
            scoreLocomoResult(
                base({
                    category: "cat-A",
                    questionIndex: 0,
                    goldAnswer: "Boston",
                    synthesizedAnswer: "Boston",
                    synthAbstained: false,
                    synthMs: 1,
                }),
            ),
            scoreLocomoResult(
                base({
                    category: "cat-A",
                    questionIndex: 1,
                    goldAnswer: "Paris",
                    synthesizedAnswer: "London",
                    synthAbstained: false,
                    synthMs: 1,
                }),
            ),
        ];
        const aggs = aggregateLocomoByCategory(scores);
        const catA = aggs.find((a) => a.category === "cat-A");
        expect(catA).toBeDefined();
        expect(catA!.synthScoredCount).toBe(2);
        expect(catA!.synthSubstringContainmentRate).toBeCloseTo(0.5, 5);
    });
});

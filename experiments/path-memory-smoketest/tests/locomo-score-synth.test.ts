import { describe, test, expect } from "bun:test";
import { scoreLocomoResult } from "../eval/locomo-score.js";
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

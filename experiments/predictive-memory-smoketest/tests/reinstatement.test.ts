import { describe, test, expect } from "bun:test";
import { getEmbedder } from "../src/embedder.js";
import { REINSTATEMENT_FIXTURES } from "../data/reinstatement-fixtures.js";
import { runFlat, runCmr } from "../eval/reinstatement-adapter.js";
import { scoreReinstatement } from "../eval/reinstatement-score.js";

describe("reinstatement end-to-end (smoke)", () => {
    test("runs the cooking-vs-debug fixture through flat and cmr without crashing", async () => {
        const emb = await getEmbedder();
        const fx = REINSTATEMENT_FIXTURES.find((f) => f.id === "cooking-vs-debug")!;
        expect(fx).toBeDefined();

        const flat = await runFlat(emb, [fx]);
        const cmr = await runCmr(emb, [fx]);

        expect(flat.length).toBe(1);
        expect(cmr.length).toBe(1);
        expect(Number.isFinite(flat[0].targetRank)).toBe(true);
        expect(Number.isFinite(cmr[0].targetRank)).toBe(true);

        const flatSummary = scoreReinstatement(flat);
        const cmrSummary = scoreReinstatement(cmr);
        expect(flatSummary.n).toBe(1);
        expect(cmrSummary.n).toBe(1);
    }, 60_000);
});

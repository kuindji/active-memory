import { describe, test, expect } from "bun:test";
import { CmrRetriever, FlatRetriever, DEFAULT_CMR } from "../src/cmr.js";
import { getEmbedder } from "../src/embedder.js";

describe("CMR retriever", () => {
    test("context vector is unit-norm after first ingest and stays bounded", async () => {
        const emb = await getEmbedder();
        const r = new CmrRetriever(emb);
        await r.ingest("a", "The first sentence establishes some context.");
        const c1 = r.context;
        const n1 = Math.sqrt(c1.reduce((s, x) => s + x * x, 0));
        expect(n1).toBeGreaterThan(0.99);
        expect(n1).toBeLessThan(1.01);

        await r.ingest("b", "A completely unrelated second sentence follows.");
        const c2 = r.context;
        const n2 = Math.sqrt(c2.reduce((s, x) => s + x * x, 0));
        expect(n2).toBeGreaterThan(0.99);
        expect(n2).toBeLessThan(1.01);
    });

    test("CMR breaks ties that flat retrieval cannot, on identical-content pair", async () => {
        const emb = await getEmbedder();
        const stream = [
            { id: "a1", text: "I'm cooking pasta tonight." },
            { id: "a2", text: "The sauce is simmering happily." },
            { id: "target", text: "I burned it." },
            { id: "a3", text: "The kitchen smells awful." },
            { id: "b1", text: "Debugging the payments service at work." },
            { id: "b2", text: "Tracing a retry loop in the logs." },
            { id: "distractor", text: "I burned it." },
            { id: "b3", text: "Going to rewrite the handler." },
        ];

        const flat = new FlatRetriever(emb);
        await flat.ingestMany(stream);
        const flatScored = await flat.query("what went wrong while cooking?", stream.length);

        const cmr = new CmrRetriever(emb, DEFAULT_CMR);
        await cmr.ingestMany(stream);
        const cmrScored = await cmr.query("what went wrong while cooking?", stream.length);

        // Flat: identical content => identical scores.
        const flatTarget = flatScored.find((x) => x.id === "target")!;
        const flatDist = flatScored.find((x) => x.id === "distractor")!;
        expect(Math.abs(flatTarget.score - flatDist.score)).toBeLessThan(1e-6);

        // CMR: stored contexts differ, so the combined scores differ
        // meaningfully — we just require a material gap, not a direction
        // (the direction depends on scene content vs. the query's lexical
        // overlap, which varies by fixture; the dry-run aggregates over 15
        // fixtures and checks direction there).
        const cmrTarget = cmrScored.find((x) => x.id === "target")!;
        const cmrDist = cmrScored.find((x) => x.id === "distractor")!;
        expect(Math.abs(cmrTarget.score - cmrDist.score)).toBeGreaterThan(1e-3);
        expect(Math.abs(cmrTarget.contextScore - cmrDist.contextScore)).toBeGreaterThan(1e-3);
        // Content scores should still be equal (identical content).
        expect(Math.abs(cmrTarget.contentScore - cmrDist.contentScore)).toBeLessThan(1e-6);
    });
});

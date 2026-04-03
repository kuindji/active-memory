import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { MemoryEngine } from "../src/core/engine.js";
import { MockLLMAdapter } from "./helpers.js";

describe("MemoryEngine.ask", () => {
    let engine: MemoryEngine;
    let llm: MockLLMAdapter;

    beforeEach(async () => {
        llm = new MockLLMAdapter();
        engine = new MemoryEngine();
        await engine.initialize({
            connection: "mem://",
            namespace: "test",
            database: `test_ask_${Date.now()}`,
            llm,
        });
        await engine.registerDomain({
            id: "test",
            name: "Test",
            async processInboxBatch() {},
        });
    });

    afterEach(async () => {
        await engine.close();
    });

    test("returns answer and memories", async () => {
        await engine.ingest("TypeScript is a typed superset of JavaScript", { domains: ["test"] });
        await engine.processInbox();

        // Mock LLM: first call returns a final answer immediately
        llm.generateResult = '{ "answer": "TypeScript adds types to JavaScript" }';
        llm.synthesizeResult = "TypeScript adds static types to JavaScript.";

        const result = await engine.ask("What is TypeScript?");
        expect(typeof result.answer).toBe("string");
        expect(result.answer.length).toBeGreaterThan(0);
        expect(Array.isArray(result.memories)).toBe(true);
        expect(typeof result.rounds).toBe("number");
        expect(result.rounds).toBeGreaterThanOrEqual(1);
    });

    test("uses buildContext for memory retrieval", async () => {
        await engine.ingest("Cats are domestic animals", { domains: ["test"] });
        await engine.ingest("Dogs are loyal pets", { domains: ["test"] });
        await engine.processInbox();
        await engine.processInbox();

        llm.synthesizeResult = "Cats and dogs are common domestic pets.";

        const result = await engine.ask("What are common pets?");
        expect(result.answer).toBe("Cats and dogs are common domestic pets.");
        // ask() now uses buildContext (single pass), so rounds is always 1
        expect(result.rounds).toBe(1);
    });

    test("deduplicates memories", async () => {
        await engine.ingest("Unique fact about planets", { domains: ["test"] });
        await engine.processInbox();

        llm.synthesizeResult = "Answer about planets.";

        const result = await engine.ask("Tell me about planets");
        const ids = result.memories.map((m) => m.id);
        const uniqueIds = new Set(ids);
        expect(ids.length).toBe(uniqueIds.size);
    });

    test("respects domain filtering", async () => {
        await engine.registerDomain({
            id: "science",
            name: "Science",
            async processInboxBatch() {},
        });

        await engine.ingest("Physics is fundamental", { domains: ["science"] });
        await engine.processInbox();

        llm.generateResult = '{ "answer": "Physics" }';
        llm.synthesizeResult = "Physics is a fundamental science.";

        const result = await engine.ask("What is physics?", { domains: ["science"] });
        expect(typeof result.answer).toBe("string");
    });
});

import { describe, test, expect } from "bun:test";
import { classifyQueryIntent } from "../src/domains/kb/utils.js";
import type { DomainContext, LLMAdapter } from "../src/core/types.js";

function mockContext(response: string): DomainContext {
    const llm: LLMAdapter = {
        extract: () => Promise.resolve([]),
        consolidate: () => Promise.resolve(""),
        generate: () => Promise.resolve(response),
    };
    return {
        llmAt: () => llm,
        loadPrompt: () => Promise.resolve("Classify the query intent.\n\nQuery: "),
    } as unknown as DomainContext;
}

function mockContextWithLlm(llm: LLMAdapter): DomainContext {
    return {
        llmAt: () => llm,
        loadPrompt: () => Promise.resolve("Classify the query intent.\n\nQuery: "),
    } as unknown as DomainContext;
}

describe("classifyQueryIntent", () => {
    test("parses valid JSON response from LLM", async () => {
        const ctx = mockContext(
            '{"classifications": ["fact", "reference"], "keywords": ["commission", "rate"], "topic": "commissions"}',
        );
        const intent = await classifyQueryIntent("What is the commission rate?", ctx);
        expect(intent.classifications).toEqual(["fact", "reference"]);
        expect(intent.keywords).toEqual(["commission", "rate"]);
        expect(intent.topic).toBe("commissions");
    });

    test("filters out invalid classifications", async () => {
        const ctx = mockContext(
            '{"classifications": ["fact", "invalid", "how-to"], "keywords": ["test"]}',
        );
        const intent = await classifyQueryIntent("test query", ctx);
        expect(intent.classifications).toEqual(["fact", "how-to"]);
    });

    test("returns all classifications on LLM failure", async () => {
        const llm: LLMAdapter = {
            extract: () => Promise.resolve([]),
            consolidate: () => Promise.resolve(""),
            generate: () => Promise.reject(new Error("LLM unavailable")),
        };
        const ctx = mockContextWithLlm(llm);
        const intent = await classifyQueryIntent("test query", ctx);
        expect(intent.classifications).toHaveLength(6);
        expect(intent.keywords.length).toBeGreaterThan(0);
    });

    test("returns all classifications when LLM returns unparseable response", async () => {
        const ctx = mockContext("I don't understand the question");
        const intent = await classifyQueryIntent("test query", ctx);
        expect(intent.classifications).toHaveLength(6);
    });

    test("returns all classifications when generate is not available", async () => {
        const llm: LLMAdapter = {
            extract: () => Promise.resolve([]),
            consolidate: () => Promise.resolve(""),
        };
        const ctx = mockContextWithLlm(llm);
        const intent = await classifyQueryIntent("test query", ctx);
        expect(intent.classifications).toHaveLength(6);
    });
});

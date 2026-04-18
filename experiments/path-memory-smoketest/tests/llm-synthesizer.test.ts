import { describe, test, expect } from "bun:test";
import {
    buildSynthesisPrompt,
    detectAbstention,
    OllamaSynthesizer,
} from "../src/llm-synthesizer.js";

describe("buildSynthesisPrompt", () => {
    test("numbers claims 1..K and embeds the question", () => {
        const { system, user } = buildSynthesisPrompt("Where did Alice move?", [
            "Alice moved to Boston.",
            "Alice bought a dog.",
        ]);
        expect(system).toContain('respond exactly "Not mentioned"');
        expect(system).toContain("≤15 tokens");
        expect(user).toContain("1. Alice moved to Boston.");
        expect(user).toContain("2. Alice bought a dog.");
        expect(user).toContain("Question: Where did Alice move?");
        expect(user.trimEnd().endsWith("Answer:")).toBe(true);
    });

    test("handles empty claim list by emitting an explicit no-memory marker", () => {
        const { user } = buildSynthesisPrompt("Who?", []);
        expect(user).toContain("Memory:\n(none)");
    });
});

describe("detectAbstention", () => {
    test("case-insensitive exact match on 'not mentioned'", () => {
        expect(detectAbstention("Not mentioned")).toBe(true);
        expect(detectAbstention("  not mentioned  ")).toBe(true);
        expect(detectAbstention("NOT MENTIONED")).toBe(true);
    });

    test("partial or decorated answers are not abstentions", () => {
        expect(detectAbstention("Not mentioned in the memory.")).toBe(false);
        expect(detectAbstention("I don't know")).toBe(false);
        expect(detectAbstention("Boston")).toBe(false);
        expect(detectAbstention("")).toBe(false);
    });
});

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

describe("OllamaSynthesizer.synthesize", () => {
    test("POSTs chat messages and extracts trimmed content", async () => {
        const calls: Array<{ url: string; body: unknown }> = [];
        const fakeFetch: FetchFn = (input, init) => {
            const body: Record<string, unknown> | undefined = init?.body
                ? (JSON.parse(init.body as string) as Record<string, unknown>)
                : undefined;
            calls.push({ url: input, body });
            return Promise.resolve(
                new Response(JSON.stringify({ message: { content: "  Boston  " }, done: true }), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                }),
            );
        };

        const s = new OllamaSynthesizer({ model: "qwen2.5:1.5b-instruct", fetchFn: fakeFetch });
        const result = await s.synthesize("Where did Alice move?", ["Alice moved to Boston."]);

        expect(result.answer).toBe("Boston");
        expect(result.abstained).toBe(false);
        expect(result.ms).toBeGreaterThanOrEqual(0);
        expect(calls.length).toBe(1);
        expect(calls[0].url).toContain("/api/chat");
        const sentBody = calls[0].body as { model: string; messages: { role: string }[] };
        expect(sentBody.model).toBe("qwen2.5:1.5b-instruct");
        expect(sentBody.messages.map((m) => m.role)).toEqual(["system", "user"]);
    });

    test("marks abstention when model outputs 'Not mentioned'", async () => {
        const fakeFetch: FetchFn = () =>
            Promise.resolve(
                new Response(
                    JSON.stringify({ message: { content: "Not mentioned" }, done: true }),
                    { status: 200, headers: { "content-type": "application/json" } },
                ),
            );

        const s = new OllamaSynthesizer({ model: "qwen2.5:1.5b-instruct", fetchFn: fakeFetch });
        const result = await s.synthesize("Adversarial?", ["Unrelated fact."]);
        expect(result.abstained).toBe(true);
        expect(result.answer).toBe("Not mentioned");
    });

    test("throws with a descriptive message on non-2xx responses", () => {
        const fakeFetch: FetchFn = () =>
            Promise.resolve(
                new Response("model not found", {
                    status: 404,
                    statusText: "Not Found",
                }),
            );

        const s = new OllamaSynthesizer({ model: "nope:1b", fetchFn: fakeFetch });
        expect(s.synthesize("q", [])).rejects.toThrow(/Ollama \/api\/chat failed: 404/);
    });
});

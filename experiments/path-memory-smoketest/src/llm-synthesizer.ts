// Phase 8.0 — local-LLM answer-synthesis adapter.
//
// Wraps an Ollama sidecar running a small instruction-tuned model
// (qwen2.5:1.5b-instruct by default). Keeps the adapter surface tiny
// so the harness stays testable without a live server.

export type SynthesisPrompt = {
    system: string;
    user: string;
};

const SYSTEM_PROMPT = [
    "You answer questions using only the provided memory snippets.",
    'If the snippets do not support an answer, respond exactly "Not mentioned".',
    "Answer in ≤15 tokens. Do not explain.",
].join("\n");

export function buildSynthesisPrompt(question: string, claimTexts: string[]): SynthesisPrompt {
    const memoryBlock =
        claimTexts.length === 0 ? "(none)" : claimTexts.map((t, i) => `${i + 1}. ${t}`).join("\n");
    const user = `Memory:\n${memoryBlock}\n\nQuestion: ${question}\nAnswer:`;
    return { system: SYSTEM_PROMPT, user };
}

const ABSTENTION_CANONICAL = "not mentioned";

export function detectAbstention(output: string): boolean {
    return output.trim().toLowerCase() === ABSTENTION_CANONICAL;
}

export type SynthesisResult = {
    answer: string;
    abstained: boolean;
    ms: number;
};

export type LlmSynthesizer = {
    synthesize(question: string, claimTexts: string[]): Promise<SynthesisResult>;
    healthCheck(): Promise<void>;
};

export type OllamaOptions = {
    baseUrl?: string;
    model: string;
    maxTokens?: number;
    temperature?: number;
    fetchFn?: (input: string, init?: RequestInit) => Promise<Response>;
};

type ChatResponse = {
    message?: { content?: string };
    done?: boolean;
};

export class OllamaSynthesizer implements LlmSynthesizer {
    private readonly baseUrl: string;
    private readonly model: string;
    private readonly maxTokens: number;
    private readonly temperature: number;
    private readonly fetchFn: (input: string, init?: RequestInit) => Promise<Response>;

    constructor(options: OllamaOptions) {
        this.baseUrl = options.baseUrl ?? "http://127.0.0.1:11434";
        this.model = options.model;
        this.maxTokens = options.maxTokens ?? 30;
        this.temperature = options.temperature ?? 0;
        this.fetchFn = options.fetchFn ?? fetch;
    }

    async healthCheck(): Promise<void> {
        const res = await this.fetchFn(`${this.baseUrl}/api/tags`);
        if (!res.ok) {
            throw new Error(`Ollama health check failed: ${res.status} ${res.statusText}`);
        }
    }

    async synthesize(question: string, claimTexts: string[]): Promise<SynthesisResult> {
        const { system, user } = buildSynthesisPrompt(question, claimTexts);
        const body = {
            model: this.model,
            messages: [
                { role: "system", content: system },
                { role: "user", content: user },
            ],
            stream: false,
            options: {
                temperature: this.temperature,
                num_predict: this.maxTokens,
            },
        };

        const start = performance.now();
        const res = await this.fetchFn(`${this.baseUrl}/api/chat`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(`Ollama /api/chat failed: ${res.status} ${res.statusText} — ${text}`);
        }
        const json = (await res.json()) as ChatResponse;
        const ms = performance.now() - start;
        const answer = (json.message?.content ?? "").trim();
        return { answer, abstained: detectAbstention(answer), ms };
    }
}

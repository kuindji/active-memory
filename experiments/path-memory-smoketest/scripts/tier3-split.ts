/**
 * Tier-3 corpus split — decomposes cached Wikipedia article text into atomic
 * ClaimSpec-shaped units via Claude CLI. Produces
 * `data/tier3-wikipedia.jsonl` with one `{id, text, validFrom}` per line.
 *
 * Run: `bun run experiments/path-memory-smoketest/scripts/tier3-split.ts`
 *
 * Per-chunk LLM responses are cached under `.cache/tier3-split/` keyed by
 * sha256 of the CLI model name + chunk text + target-claims hint, so
 * swapping TIER3_MODEL (sonnet vs haiku) produces a distinct cache entry
 * and re-runs only pay for chunks whose input actually changed.
 */

import { readFile, mkdir, writeFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const EXPERIMENT_ROOT = resolve(here, "..");
const ARTICLES_PATH = process.env.TIER3_ARTICLES
    ? resolve(process.cwd(), process.env.TIER3_ARTICLES)
    : resolve(here, "tier3-articles.json");
const WIKI_CACHE_DIR = resolve(EXPERIMENT_ROOT, ".cache", "wikipedia");
const SPLIT_CACHE_DIR = resolve(EXPERIMENT_ROOT, ".cache", "tier3-split");
const OUTPUT_JSONL = resolve(EXPERIMENT_ROOT, "data", "tier3-wikipedia.jsonl");

const CHUNK_TARGET_CHARS = 6000;
const CLAUDE_TIMEOUT_MS = 180_000;
const CLAUDE_MODEL = process.env.TIER3_MODEL ?? "sonnet";

type ArticleSpec = {
    domain: string;
    title: string;
    targetClaims: number;
};

type ArticlesFile = {
    articles: ArticleSpec[];
};

type ChunkCache = {
    promptHash: string;
    claims: string[];
};

function slugifyTitle(title: string): string {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function sha256(text: string): string {
    return createHash("sha256").update(text).digest("hex");
}

async function fileExists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

function splitIntoChunks(text: string, targetChars: number): string[] {
    const paragraphs = text.split(/\n{1,}/).filter((p) => p.trim().length > 0);
    const chunks: string[] = [];
    let current = "";
    for (const para of paragraphs) {
        if (current.length === 0) {
            current = para;
            continue;
        }
        if (current.length + para.length + 1 <= targetChars) {
            current += "\n" + para;
        } else {
            chunks.push(current);
            current = para;
        }
    }
    if (current.length > 0) chunks.push(current);
    return chunks;
}

function buildPrompt(text: string, targetClaims: number): string {
    return `You are decomposing an encyclopedic text into atomic factual claims for a knowledge-retrieval evaluation.

RULES
- Each claim is a single self-contained factual statement.
- Resolve pronouns fully: write explicit names and nouns, never "it" / "he" / "they" / "this".
- Keep each claim under 25 words.
- No meta-information about the article itself (skip "this article explains...").
- Skip navigational or stub sentences ("See also", "Main article", references).
- Do not invent facts not supported by the text.
- Prefer breadth of facts over repeating the same fact in different words.
- Output STRICTLY a JSON array of strings. No numbering, no prefixes, no markdown fences, no commentary.

TARGET
About ${targetClaims} claims. Producing fewer is fine; do not pad with speculation.

<section>
${text}
</section>

Return ONLY the JSON array.`;
}

function parseJsonArray(text: string): string[] {
    const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    const raw = fenceMatch ? fenceMatch[1] : text;
    const trimmed = raw.trim();
    const first = trimmed.indexOf("[");
    const last = trimmed.lastIndexOf("]");
    if (first === -1 || last === -1 || last < first) {
        throw new Error(`Response does not contain a JSON array: ${trimmed.slice(0, 200)}`);
    }
    const jsonStr = trimmed.slice(first, last + 1);
    const parsed: unknown = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) {
        throw new Error("Response parsed but is not an array");
    }
    const result: string[] = [];
    for (const item of parsed) {
        if (typeof item !== "string") {
            throw new Error(
                `Array contains non-string element: ${JSON.stringify(item).slice(0, 100)}`,
            );
        }
        const s = item.trim();
        if (s.length > 0) result.push(s);
    }
    return result;
}

async function runClaude(prompt: string): Promise<string> {
    return new Promise((resolvePromise, rejectPromise) => {
        const args = ["--print", "--model", CLAUDE_MODEL];
        const proc = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });

        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (chunk: Buffer) => {
            stdout += chunk.toString();
        });
        proc.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
        });

        const timeoutId = setTimeout(() => {
            proc.kill();
            rejectPromise(new Error(`claude CLI timed out after ${CLAUDE_TIMEOUT_MS}ms`));
        }, CLAUDE_TIMEOUT_MS);

        proc.on("error", (err) => {
            clearTimeout(timeoutId);
            rejectPromise(err);
        });

        proc.on("close", (code) => {
            clearTimeout(timeoutId);
            if (code !== 0) {
                rejectPromise(
                    new Error(
                        `claude CLI exited with code ${code}: ${stderr.slice(0, 500) || stdout.slice(0, 500)}`,
                    ),
                );
                return;
            }
            resolvePromise(stdout.trim());
        });

        proc.stdin.end(prompt);
    });
}

async function splitChunk(chunk: string, targetClaims: number): Promise<string[]> {
    const prompt = buildPrompt(chunk, targetClaims);
    const promptHash = sha256(`${CLAUDE_MODEL}\n${prompt}`);
    const cachePath = resolve(SPLIT_CACHE_DIR, `${promptHash}.json`);

    if (await fileExists(cachePath)) {
        const cached = JSON.parse(await readFile(cachePath, "utf8")) as ChunkCache;
        if (cached.promptHash === promptHash) {
            return cached.claims;
        }
    }

    const response = await runClaude(prompt);
    const claims = parseJsonArray(response);

    const cache: ChunkCache = { promptHash, claims };
    await writeFile(cachePath, JSON.stringify(cache, null, 2), "utf8");
    return claims;
}

function buildClaimId(domain: string, slug: string, seq: number): string {
    return `${domain}_${slug}_${seq.toString().padStart(3, "0")}`;
}

async function main(): Promise<void> {
    await mkdir(SPLIT_CACHE_DIR, { recursive: true });
    await mkdir(dirname(OUTPUT_JSONL), { recursive: true });

    const articlesFile = JSON.parse(await readFile(ARTICLES_PATH, "utf8")) as ArticlesFile;

    let globalValidFrom = 0;
    const outputLines: string[] = [];
    const perArticleCounts: Array<{ title: string; claims: number }> = [];

    for (const article of articlesFile.articles) {
        const slug = slugifyTitle(article.title);
        const textPath = resolve(WIKI_CACHE_DIR, `${article.domain}-${slug}.txt`);
        if (!(await fileExists(textPath))) {
            console.error(`[skip]  ${article.title}: cached text not found at ${textPath}`);
            process.exitCode = 1;
            continue;
        }

        const text = await readFile(textPath, "utf8");
        const chunks = splitIntoChunks(text, CHUNK_TARGET_CHARS);
        const targetPerChunk = Math.max(6, Math.round(article.targetClaims / chunks.length));

        console.log(
            `[split] ${article.domain}/${article.title}  ${chunks.length} chunks  target=${article.targetClaims} (${targetPerChunk}/chunk)`,
        );

        let seq = 0;
        let articleClaimCount = 0;
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            if (chunk === undefined) continue;
            let claims: string[];
            try {
                claims = await splitChunk(chunk, targetPerChunk);
            } catch (err) {
                console.error(
                    `         chunk ${i + 1}/${chunks.length} FAIL: ${(err as Error).message}`,
                );
                process.exitCode = 1;
                continue;
            }

            for (const claimText of claims) {
                const entry = {
                    id: buildClaimId(article.domain, slug, seq),
                    text: claimText,
                    validFrom: globalValidFrom,
                };
                outputLines.push(JSON.stringify(entry));
                seq += 1;
                globalValidFrom += 1;
                articleClaimCount += 1;
            }
            console.log(`         chunk ${i + 1}/${chunks.length} -> ${claims.length} claims`);
        }

        perArticleCounts.push({ title: article.title, claims: articleClaimCount });
    }

    await writeFile(OUTPUT_JSONL, outputLines.join("\n") + "\n", "utf8");

    console.log("");
    console.log("Per-article claim counts:");
    for (const entry of perArticleCounts) {
        console.log(`  ${entry.claims.toString().padStart(4)}  ${entry.title}`);
    }
    console.log("");
    console.log(`Total claims: ${outputLines.length}`);
    console.log(`Output: ${OUTPUT_JSONL}`);
}

await main();

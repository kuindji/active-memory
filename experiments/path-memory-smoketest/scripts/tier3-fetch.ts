/**
 * Tier-3 corpus fetch — pulls plaintext Wikipedia article extracts for each
 * title listed in `tier3-articles.json` and caches them under
 * `.cache/wikipedia/{domain}-{slug}.txt`.
 *
 * Run: `bun run experiments/path-memory-smoketest/scripts/tier3-fetch.ts`
 */

import { readFile, mkdir, writeFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const EXPERIMENT_ROOT = resolve(here, "..");
const ARTICLES_PATH = resolve(here, "tier3-articles.json");
const CACHE_DIR = resolve(EXPERIMENT_ROOT, ".cache", "wikipedia");

const WIKI_API = "https://en.wikipedia.org/w/api.php";
const USER_AGENT =
    "memory-domain/path-memory-smoketest (https://github.com/kuindji/memory-domain; tier3-corpus)";

type ArticleSpec = {
    domain: string;
    title: string;
    targetClaims: number;
};

type ArticlesFile = {
    articles: ArticleSpec[];
};

function slugifyTitle(title: string): string {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function cachePath(article: ArticleSpec): string {
    return resolve(CACHE_DIR, `${article.domain}-${slugifyTitle(article.title)}.txt`);
}

async function fileExists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

async function fetchExtract(title: string): Promise<string> {
    const params = new URLSearchParams({
        action: "query",
        format: "json",
        titles: title,
        prop: "extracts",
        explaintext: "1",
        redirects: "1",
        formatversion: "2",
    });
    const url = `${WIKI_API}?${params.toString()}`;

    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) {
        throw new Error(`Wikipedia API ${res.status} for "${title}": ${await res.text()}`);
    }

    const data = (await res.json()) as {
        query?: { pages?: Array<{ title: string; extract?: string; missing?: boolean }> };
    };
    const page = data.query?.pages?.[0];
    if (!page || page.missing || !page.extract) {
        throw new Error(`Wikipedia article not found or has no extract: "${title}"`);
    }

    return page.extract;
}

async function main(): Promise<void> {
    const articlesRaw = await readFile(ARTICLES_PATH, "utf8");
    const articlesFile = JSON.parse(articlesRaw) as ArticlesFile;

    await mkdir(CACHE_DIR, { recursive: true });

    let fetched = 0;
    let cached = 0;
    let totalChars = 0;

    for (const article of articlesFile.articles) {
        const path = cachePath(article);

        if (await fileExists(path)) {
            const existing = await readFile(path, "utf8");
            totalChars += existing.length;
            cached += 1;
            console.log(`[cache]  ${article.domain}/${article.title}  (${existing.length} chars)`);
            continue;
        }

        console.log(`[fetch]  ${article.domain}/${article.title} ...`);
        try {
            const text = await fetchExtract(article.title);
            await writeFile(path, text, "utf8");
            totalChars += text.length;
            fetched += 1;
            console.log(`         ok  (${text.length} chars)`);
        } catch (err) {
            console.error(`         FAIL: ${(err as Error).message}`);
            process.exitCode = 1;
        }
    }

    console.log("");
    console.log(`Articles: ${articlesFile.articles.length}  fetched=${fetched}  cached=${cached}`);
    console.log(`Total characters: ${totalChars.toLocaleString()}`);
    console.log(`Cache dir: ${CACHE_DIR}`);
}

await main();

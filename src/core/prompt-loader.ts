import { readFile } from "node:fs/promises";
import { join } from "node:path";

const cache = new Map<string, string>();

/**
 * Loads a prompt from a domain's skills/ directory.
 * Results are cached — each file is read from disk only once.
 */
async function loadPrompt(baseDir: string, name: string): Promise<string> {
    const key = `${baseDir}/${name}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    const filePath = join(baseDir, "skills", `${name}.md`);
    const content = (await readFile(filePath, "utf-8")).trim();
    cache.set(key, content);
    return content;
}

export { loadPrompt };

import { cpSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const src = "src";
const dist = "dist";

function copyMdFiles(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            copyMdFiles(fullPath);
        } else if (entry.name.endsWith(".md")) {
            const rel = relative(src, fullPath);
            const dest = join(dist, rel);
            cpSync(fullPath, dest, { recursive: true });
        }
    }
}

copyMdFiles(src);

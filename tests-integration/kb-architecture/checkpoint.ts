import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { Checkpoint } from "./types.js";

const BASE_DIR = join(import.meta.dir, "checkpoints");

function checkpointPath(config: string, phase: number): string {
    const phaseNames = [
        "dataset",
        "ingested",
        "processed",
        "consolidated",
        "evaluation",
        "scores",
        "report",
    ];
    const name = phaseNames[phase] ?? `phase-${phase}`;
    return join(BASE_DIR, config, `${name}.json`);
}

export function writeCheckpoint<T>(
    config: string,
    phase: number,
    data: T,
    durationMs: number,
    status: "success" | "failed" | "stopped" = "success",
    failReason?: string,
): void {
    const path = checkpointPath(config, phase);
    mkdirSync(dirname(path), { recursive: true });

    const checkpoint: Checkpoint<T> = {
        phase,
        config,
        timestamp: new Date().toISOString(),
        durationMs,
        status,
        ...(failReason ? { failReason } : {}),
        data,
    };

    writeFileSync(path, JSON.stringify(checkpoint, null, 2));
    console.log(`[checkpoint] Wrote phase ${phase} for "${config}" → ${path}`);
}

export function readCheckpoint<T>(config: string, phase: number): Checkpoint<T> {
    const path = checkpointPath(config, phase);
    if (!existsSync(path)) {
        throw new Error(`Checkpoint not found: ${path}`);
    }
    return JSON.parse(readFileSync(path, "utf-8")) as Checkpoint<T>;
}

export function hasCheckpoint(config: string, phase: number): boolean {
    return existsSync(checkpointPath(config, phase));
}

export function datasetPath(): string {
    return join(BASE_DIR, "dataset.json");
}

export function writeDataset<T>(data: T): void {
    mkdirSync(BASE_DIR, { recursive: true });
    writeFileSync(datasetPath(), JSON.stringify(data, null, 2));
    console.log(`[checkpoint] Wrote dataset → ${datasetPath()}`);
}

export function readDataset<T>(): T {
    const path = datasetPath();
    if (!existsSync(path)) {
        throw new Error(`Dataset not found: ${path}`);
    }
    return JSON.parse(readFileSync(path, "utf-8")) as T;
}

export function listConfigCheckpoints(): string[] {
    if (!existsSync(BASE_DIR)) return [];
    return readdirSync(BASE_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
}

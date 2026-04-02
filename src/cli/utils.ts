function parseMeta(flags: Record<string, unknown>): Record<string, unknown> | undefined {
    const meta = flags["meta"];
    if (meta && typeof meta === "object" && !Array.isArray(meta)) {
        return meta as Record<string, unknown>;
    }
    return undefined;
}

export { parseMeta };

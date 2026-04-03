import { describe, test, expect, beforeEach } from "bun:test";
import { TunableParamRegistry } from "../src/core/tunable-params.js";
import type { TunableParamDefinition } from "../src/core/tunable-params.js";

const sampleParams: TunableParamDefinition[] = [
    { name: "threshold", default: 0.5, min: 0, max: 1, step: 0.1 },
    { name: "maxResults", default: 10, min: 1, max: 100, step: 1 },
];

describe("TunableParamRegistry", () => {
    let registry: TunableParamRegistry;

    beforeEach(() => {
        registry = new TunableParamRegistry();
    });

    test("registers params and returns defaults", () => {
        registry.register("test-domain", sampleParams);
        expect(registry.get("test-domain", "threshold")).toBe(0.5);
        expect(registry.get("test-domain", "maxResults")).toBe(10);
    });

    test("applies overrides from persisted values", () => {
        registry.register("test-domain", sampleParams);
        registry.applyOverrides("test-domain", { threshold: 0.8, maxResults: 50 });
        expect(registry.get("test-domain", "threshold")).toBe(0.8);
        expect(registry.get("test-domain", "maxResults")).toBe(50);
    });

    test("clamps overrides to min/max range", () => {
        registry.register("test-domain", sampleParams);
        registry.applyOverrides("test-domain", { threshold: 5, maxResults: -10 });
        expect(registry.get("test-domain", "threshold")).toBe(1);
        expect(registry.get("test-domain", "maxResults")).toBe(1);
    });

    test("getAllForDomain returns all current values", () => {
        registry.register("test-domain", sampleParams);
        registry.applyOverrides("test-domain", { threshold: 0.7 });
        const all = registry.getAllForDomain("test-domain");
        expect(all).toEqual({ threshold: 0.7, maxResults: 10 });
    });

    test("getDefinitions returns param definitions for a domain", () => {
        registry.register("test-domain", sampleParams);
        const defs = registry.getDefinitions("test-domain");
        expect(defs).toEqual(sampleParams);
    });

    test("get returns undefined for unknown domain or param", () => {
        registry.register("test-domain", sampleParams);
        expect(registry.get("unknown-domain", "threshold")).toBeUndefined();
        expect(registry.get("test-domain", "nonexistent")).toBeUndefined();
    });

    test("getDomainIds returns registered domains", () => {
        registry.register("domain-a", sampleParams);
        registry.register("domain-b", sampleParams);
        expect(registry.getDomainIds()).toEqual(["domain-a", "domain-b"]);
    });

    test("applyOverrides silently skips unknown params", () => {
        registry.register("test-domain", sampleParams);
        registry.applyOverrides("test-domain", { nonexistent: 42 });
        expect(registry.get("test-domain", "threshold")).toBe(0.5);
        expect(registry.get("test-domain", "maxResults")).toBe(10);
    });

    test("applyOverrides is no-op for unknown domain", () => {
        registry.applyOverrides("unknown", { threshold: 0.9 });
        expect(registry.getDomainIds()).toEqual([]);
    });

    test("getAllForDomain returns empty object for unknown domain", () => {
        expect(registry.getAllForDomain("unknown")).toEqual({});
    });

    test("getDefinitions returns empty array for unknown domain", () => {
        expect(registry.getDefinitions("unknown")).toEqual([]);
    });
});

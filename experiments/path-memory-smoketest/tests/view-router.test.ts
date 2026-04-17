import { describe, test, expect } from "bun:test";
import {
    DEFAULT_VIEW_ROUTER_CONFIG,
    routeProbes,
    uniformViewWeights,
    type ViewRouterConfig,
} from "../src/view-router.js";
import { trivialTokenize } from "./helpers.js";

function fixedIdf(table: Record<string, number>, floor = 0): (t: string) => number {
    return (t: string) => table[t] ?? floor;
}

function sum(w: { temporal: number; lexical: number; semantic: number }): number {
    return w.temporal + w.lexical + w.semantic;
}

describe("view-router", () => {
    test("empty probe list returns uniform weights", () => {
        const w = routeProbes([], { tokenize: trivialTokenize, idfOf: () => 0 });
        expect(w).toEqual(uniformViewWeights());
    });

    test("weights always sum to 1 after normalization", () => {
        const probes = [
            { text: "when did the war start", embedding: [] },
            { text: "Peloponnesian historians", embedding: [] },
            { text: "cats and dogs", embedding: [] },
        ];
        const w = routeProbes(probes, {
            tokenize: trivialTokenize,
            idfOf: fixedIdf({ peloponnesian: 4, historians: 3 }),
        });
        expect(Math.abs(sum(w) - 1)).toBeLessThan(1e-9);
    });

    test("temporal keyword bumps temporal channel above semantic floor", () => {
        const probes = [{ text: "what happened before the siege", embedding: [] }];
        const wTemporal = routeProbes(probes, { tokenize: trivialTokenize, idfOf: () => 0 });
        const wNeutral = routeProbes([{ text: "siege narratives", embedding: [] }], {
            tokenize: trivialTokenize,
            idfOf: () => 0,
        });
        expect(wTemporal.temporal).toBeGreaterThan(wNeutral.temporal);
    });

    test("year regex triggers temporal channel", () => {
        const probes = [{ text: "events of 1812 and the fallout", embedding: [] }];
        const w = routeProbes(probes, { tokenize: trivialTokenize, idfOf: () => 0 });
        expect(w.temporal).toBeGreaterThan(w.lexical);
        // Year alone (no high-IDF tokens) should leave lexical at 0 share.
        expect(w.lexical).toBeCloseTo(0, 9);
    });

    test("high-IDF token bumps lexical channel", () => {
        const probes = [{ text: "Peloponnesian historians", embedding: [] }];
        const w = routeProbes(probes, {
            tokenize: trivialTokenize,
            idfOf: fixedIdf({ peloponnesian: 4, historians: 3 }),
        });
        expect(w.lexical).toBeGreaterThan(0);
        // No temporal signal → temporal stays at 0.
        expect(w.temporal).toBeCloseTo(0, 9);
    });

    test("no signals → purely semantic", () => {
        const probes = [{ text: "generic question about stuff", embedding: [] }];
        const w = routeProbes(probes, { tokenize: trivialTokenize, idfOf: () => 0 });
        expect(w.semantic).toBeCloseTo(1, 6);
        expect(w.temporal).toBeCloseTo(0, 9);
        expect(w.lexical).toBeCloseTo(0, 9);
    });

    test("semantic floor holds when every probe has temporal + lexical signals", () => {
        const probes = [
            { text: "when did Peloponnesian war start", embedding: [] },
            { text: "year of Peloponnesian treaty", embedding: [] },
        ];
        const w = routeProbes(probes, {
            tokenize: trivialTokenize,
            idfOf: fixedIdf({ peloponnesian: 4, treaty: 3 }),
        });
        // Floor is 0.2 per probe before normalization; after norm semantic
        // must remain strictly positive.
        expect(w.semantic).toBeGreaterThan(0.1);
    });

    test("custom config overrides defaults", () => {
        const probes = [{ text: "during the reign", embedding: [] }];
        const custom: Partial<ViewRouterConfig> = { temporalBoost: 2.0 };
        const wDefault = routeProbes(probes, { tokenize: trivialTokenize, idfOf: () => 0 });
        const wCustom = routeProbes(probes, {
            tokenize: trivialTokenize,
            idfOf: () => 0,
            cfg: custom,
        });
        expect(wCustom.temporal).toBeGreaterThan(wDefault.temporal);
    });

    test("default config's temporal keywords and threshold are sensible", () => {
        // Sanity: defaults aren't empty.
        expect(DEFAULT_VIEW_ROUTER_CONFIG.temporalKeywords.length).toBeGreaterThan(0);
        expect(DEFAULT_VIEW_ROUTER_CONFIG.lexicalIdfThreshold).toBeGreaterThan(0);
        expect(DEFAULT_VIEW_ROUTER_CONFIG.semanticFloor).toBeGreaterThan(0);
    });

    test("mean-pool across probes: mixed signals partition weight", () => {
        const probes = [
            { text: "when did it start", embedding: [] }, // temporal
            { text: "Peloponnesian historians", embedding: [] }, // lexical
            { text: "general discussion", embedding: [] }, // semantic-only
        ];
        const w = routeProbes(probes, {
            tokenize: trivialTokenize,
            idfOf: fixedIdf({ peloponnesian: 4, historians: 3 }),
        });
        // All three channels should carry meaningful mass.
        expect(w.temporal).toBeGreaterThan(0.05);
        expect(w.lexical).toBeGreaterThan(0.05);
        expect(w.semantic).toBeGreaterThan(0.05);
        expect(Math.abs(sum(w) - 1)).toBeLessThan(1e-9);
    });
});

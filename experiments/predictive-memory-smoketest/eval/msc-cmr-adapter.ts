import type { EmbeddingAdapter } from "../../../src/core/types.js";
import {
    finalSessionPersonas,
    type MscDialogue,
} from "../../path-memory-smoketest/data/msc-loader.js";
import { tokenize } from "../../path-memory-smoketest/src/tokenize.js";
import { CmrRetriever, FlatRetriever, type CmrConfig } from "../src/cmr.js";

// Phase 1 — MSC persona-recall adapter for CMR / Flat retrievers.
//
// Reuses MSC dataset loader + persona-probe shape from path-memory-smoketest
// Phase 7.5, but substitutes CmrRetriever / FlatRetriever for PathMemory.
// Scoring is rule-based (persona-string containment + persona token recall),
// computed locally to stay decoupled from PathMemory-specific types.

export type CmrVariant = {
    name: string;
    rho: number;
    beta: number;
    w: number;
    // When true, the running context vector is zeroed between MSC sessions
    // within a single dialogue. Item memories are preserved across resets.
    resetAtSession: boolean;
};

export type ProbeMetrics = {
    personaTokenRecall: number;
    personaStringContainmentRate: number;
    goldTokenCount: number;
    contextTokenCount: number;
    personaCount: number;
    personaContainmentHits: number;
};

export type ProbeResult = {
    speaker: "Speaker 1" | "Speaker 2";
    probeText: string;
    goldPersona: string[];
    retrievedClaimTexts: string[];
    retrieveMs: number;
    metrics: ProbeMetrics;
};

export type DialogueResult = {
    dialogueId: number;
    retrieverKind: "cmr" | "flat";
    variantName: string;
    topK: number;
    ingestedTurnCount: number;
    sessionCount: number;
    ingestMs: number;
    speaker1: ProbeResult;
    speaker2: ProbeResult;
};

export type MscProbes = {
    speaker1: string;
    speaker2: string;
};

export const DEFAULT_MSC_PROBES: MscProbes = {
    speaker1: "What do we know about Speaker 1?",
    speaker2: "What do we know about Speaker 2?",
};

function toCmrConfig(variant: CmrVariant): CmrConfig {
    return { rho: variant.rho, beta: variant.beta, w: variant.w };
}

function scoreProbe(goldPersona: string[], retrievedTexts: string[]): ProbeMetrics {
    const goldJoined = goldPersona.join(" ");
    const goldTokens = tokenize(goldJoined);
    const context = retrievedTexts.join(" \n ");
    const contextTokens = tokenize(context);
    const contextTokenSet = new Set(contextTokens);

    let tokenHits = 0;
    for (const t of goldTokens) if (contextTokenSet.has(t)) tokenHits += 1;
    const personaTokenRecall = goldTokens.length > 0 ? tokenHits / goldTokens.length : 0;

    const contextLower = context.toLowerCase();
    let personaContainmentHits = 0;
    for (const p of goldPersona) {
        const lower = p.toLowerCase().trim();
        if (lower.length > 0 && contextLower.includes(lower)) personaContainmentHits += 1;
    }
    const personaStringContainmentRate =
        goldPersona.length > 0 ? personaContainmentHits / goldPersona.length : 0;

    return {
        personaTokenRecall,
        personaStringContainmentRate,
        goldTokenCount: goldTokens.length,
        contextTokenCount: contextTokens.length,
        personaCount: goldPersona.length,
        personaContainmentHits,
    };
}

async function ingestCmr(
    retriever: CmrRetriever,
    dialogue: MscDialogue,
    resetAtSession: boolean,
): Promise<number> {
    let count = 0;
    for (const session of dialogue.sessions) {
        if (resetAtSession) retriever.resetContext();
        for (let i = 0; i < session.turns.length; i++) {
            const turn = session.turns[i];
            const id = `${dialogue.dialogueId}-s${session.sessionId}-t${i}`;
            const text = `${turn.speaker}: ${turn.text}`;
            await retriever.ingest(id, text);
            count += 1;
        }
    }
    return count;
}

async function ingestFlat(retriever: FlatRetriever, dialogue: MscDialogue): Promise<number> {
    let count = 0;
    for (const session of dialogue.sessions) {
        for (let i = 0; i < session.turns.length; i++) {
            const turn = session.turns[i];
            const id = `${dialogue.dialogueId}-s${session.sessionId}-t${i}`;
            const text = `${turn.speaker}: ${turn.text}`;
            await retriever.ingest(id, text);
            count += 1;
        }
    }
    return count;
}

async function runCmrProbe(
    retriever: CmrRetriever,
    speaker: "Speaker 1" | "Speaker 2",
    probeText: string,
    goldPersona: string[],
    topK: number,
): Promise<ProbeResult> {
    const start = performance.now();
    const scored = await retriever.query(probeText, topK, { mode: "cue" });
    const retrieveMs = performance.now() - start;
    const retrievedTexts = scored.map((s) => s.text);
    const metrics = scoreProbe(goldPersona, retrievedTexts);
    return {
        speaker,
        probeText,
        goldPersona,
        retrievedClaimTexts: retrievedTexts,
        retrieveMs,
        metrics,
    };
}

async function runFlatProbe(
    retriever: FlatRetriever,
    speaker: "Speaker 1" | "Speaker 2",
    probeText: string,
    goldPersona: string[],
    topK: number,
): Promise<ProbeResult> {
    const start = performance.now();
    const scored = await retriever.query(probeText, topK);
    const retrieveMs = performance.now() - start;
    const retrievedTexts = scored.map((s) => s.text);
    const metrics = scoreProbe(goldPersona, retrievedTexts);
    return {
        speaker,
        probeText,
        goldPersona,
        retrievedClaimTexts: retrievedTexts,
        retrieveMs,
        metrics,
    };
}

export type CmrRunOptions = {
    embedder: EmbeddingAdapter;
    variant: CmrVariant;
    topK: number;
    probes?: MscProbes;
};

export type FlatRunOptions = {
    embedder: EmbeddingAdapter;
    topK: number;
    probes?: MscProbes;
};

export async function runMscDialogueCmr(
    dialogue: MscDialogue,
    opts: CmrRunOptions,
): Promise<DialogueResult> {
    const retriever = new CmrRetriever(opts.embedder, toCmrConfig(opts.variant));
    const probes = opts.probes ?? DEFAULT_MSC_PROBES;

    const ingestStart = performance.now();
    const count = await ingestCmr(retriever, dialogue, opts.variant.resetAtSession);
    const ingestMs = performance.now() - ingestStart;

    const { persona1, persona2 } = finalSessionPersonas(dialogue);
    const speaker1 = await runCmrProbe(
        retriever,
        "Speaker 1",
        probes.speaker1,
        persona1,
        opts.topK,
    );
    const speaker2 = await runCmrProbe(
        retriever,
        "Speaker 2",
        probes.speaker2,
        persona2,
        opts.topK,
    );

    return {
        dialogueId: dialogue.dialogueId,
        retrieverKind: "cmr",
        variantName: opts.variant.name,
        topK: opts.topK,
        ingestedTurnCount: count,
        sessionCount: dialogue.sessions.length,
        ingestMs,
        speaker1,
        speaker2,
    };
}

export async function runMscDialogueFlat(
    dialogue: MscDialogue,
    opts: FlatRunOptions,
): Promise<DialogueResult> {
    const retriever = new FlatRetriever(opts.embedder);
    const probes = opts.probes ?? DEFAULT_MSC_PROBES;

    const ingestStart = performance.now();
    const count = await ingestFlat(retriever, dialogue);
    const ingestMs = performance.now() - ingestStart;

    const { persona1, persona2 } = finalSessionPersonas(dialogue);
    const speaker1 = await runFlatProbe(
        retriever,
        "Speaker 1",
        probes.speaker1,
        persona1,
        opts.topK,
    );
    const speaker2 = await runFlatProbe(
        retriever,
        "Speaker 2",
        probes.speaker2,
        persona2,
        opts.topK,
    );

    return {
        dialogueId: dialogue.dialogueId,
        retrieverKind: "flat",
        variantName: "flat",
        topK: opts.topK,
        ingestedTurnCount: count,
        sessionCount: dialogue.sessions.length,
        ingestMs,
        speaker1,
        speaker2,
    };
}

export type Aggregate = {
    probeCount: number;
    meanPersonaStringContainmentRate: number;
    meanPersonaTokenRecall: number;
    fractionContainmentAbove50: number;
};

export function aggregate(results: DialogueResult[]): Aggregate {
    const probes: ProbeMetrics[] = [];
    for (const r of results) {
        probes.push(r.speaker1.metrics, r.speaker2.metrics);
    }
    if (probes.length === 0) {
        return {
            probeCount: 0,
            meanPersonaStringContainmentRate: 0,
            meanPersonaTokenRecall: 0,
            fractionContainmentAbove50: 0,
        };
    }
    let contSum = 0;
    let recSum = 0;
    let above50 = 0;
    for (const p of probes) {
        contSum += p.personaStringContainmentRate;
        recSum += p.personaTokenRecall;
        if (p.personaStringContainmentRate >= 0.5) above50 += 1;
    }
    return {
        probeCount: probes.length,
        meanPersonaStringContainmentRate: contSum / probes.length,
        meanPersonaTokenRecall: recSum / probes.length,
        fractionContainmentAbove50: above50 / probes.length,
    };
}

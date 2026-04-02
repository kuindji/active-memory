export type KbClassification =
    | "fact"
    | "definition"
    | "how-to"
    | "reference"
    | "concept"
    | "insight";

export interface KbAttributes {
    classification: KbClassification;
    superseded: boolean;
    source?: string;
}

export interface KbDomainOptions {
    consolidateSchedule?: {
        enabled?: boolean;
        intervalMs?: number;
    };
}

export const KB_DOMAIN_ID = "kb";
export const KB_TAG = "kb";
export const KB_FACT_TAG = "kb/fact";
export const KB_DEFINITION_TAG = "kb/definition";
export const KB_HOWTO_TAG = "kb/how-to";
export const KB_REFERENCE_TAG = "kb/reference";
export const KB_CONCEPT_TAG = "kb/concept";
export const KB_INSIGHT_TAG = "kb/insight";

export const DEFAULT_CONSOLIDATE_INTERVAL_MS = 21_600_000; // 6 hours

export const CLASSIFICATION_TAGS: Record<KbClassification, string> = {
    fact: KB_FACT_TAG,
    definition: KB_DEFINITION_TAG,
    "how-to": KB_HOWTO_TAG,
    reference: KB_REFERENCE_TAG,
    concept: KB_CONCEPT_TAG,
    insight: KB_INSIGHT_TAG,
};

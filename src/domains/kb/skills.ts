import type { DomainSkill } from "../../core/types.js";

const kbCapture: DomainSkill = {
    id: "kb-capture",
    name: "How to store knowledge entries",
    description:
        "Tells external agents how to ingest general knowledge — facts, definitions, how-tos, references, concepts, and insights — with classification metadata and optional source attribution",
    scope: "external",
    writes: true,
};

const kbQuery: DomainSkill = {
    id: "kb-query",
    name: "How to retrieve knowledge",
    description:
        "Tells external agents how to search knowledge by classification, topic, and similarity, and how to use buildContext for knowledge retrieval",
    scope: "external",
};

const kbInbox: DomainSkill = {
    id: "kb-inbox",
    name: "Inbox processing for knowledge entries",
    description:
        "System prompt for the LLM that classifies knowledge, extracts topics, and detects supersession during inbox processing",
    scope: "internal",
};

export const kbSkills: DomainSkill[] = [kbCapture, kbQuery, kbInbox];

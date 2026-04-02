import type { DomainSkill } from "../../core/types.ts";

const codeRepoCapture: DomainSkill = {
    id: "code-repo-capture",
    name: "How to record code repo knowledge",
    description:
        "Tells external agents how to write curated code repo knowledge — decisions, rationale, clarifications, direction — with classification metadata and audience tags (technical/business)",
    scope: "external",
    writes: true,
};

const codeRepoQuery: DomainSkill = {
    id: "code-repo-query",
    name: "How to retrieve code repo knowledge",
    description:
        "Tells external agents how to search code repo knowledge by classification, audience, and entity, traverse the architecture graph, and use buildContext with audience filtering",
    scope: "external",
};

const codeRepoInbox: DomainSkill = {
    id: "code-repo-inbox",
    name: "Inbox processing for unstructured knowledge",
    description:
        "System prompt for the LLM that classifies unstructured knowledge, extracts entities, and detects contradictions during inbox processing",
    scope: "internal",
};

export const codeRepoSkills: DomainSkill[] = [codeRepoCapture, codeRepoQuery, codeRepoInbox];

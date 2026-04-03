import type { DomainSkill } from "../../core/types.js";

const topicManagement: DomainSkill = {
    id: "topic-management",
    name: "How to create and manage topics",
    description:
        "Tells external agents how to create topics, link memories to topics, set parent topics, and track mention counts",
    scope: "external",
    writes: true,
};

const topicQuery: DomainSkill = {
    id: "topic-query",
    name: "How to query topics",
    description:
        "Tells external agents how to find topics, list active topics, and traverse topic relationships",
    scope: "external",
};

export const topicSkills: DomainSkill[] = [topicManagement, topicQuery];

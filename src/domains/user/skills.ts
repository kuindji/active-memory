import type { DomainSkill } from "../../core/types.js";

const userData: DomainSkill = {
    id: "user-data",
    name: "How to store user facts",
    description:
        "Tells external agents how to find or create a user node, store user facts, and link existing memories to a user",
    scope: "external",
    writes: true,
};

const userQuery: DomainSkill = {
    id: "user-query",
    name: "How to query user data",
    description:
        "Tells external agents how to find user facts by category, retrieve all data linked to a user, and get a profile summary",
    scope: "external",
};

const userProfile: DomainSkill = {
    id: "user-profile",
    name: "Internal user profile consolidation",
    description:
        "Internal skill describing how user profile summaries are synthesised from accumulated user facts",
    scope: "internal",
};

export const userSkills: DomainSkill[] = [userData, userQuery, userProfile];

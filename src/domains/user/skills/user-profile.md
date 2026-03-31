# User Profile Consolidation (Internal)

This skill describes the consolidation logic run by the user domain schedule.

## Finding All User Nodes

Search for all user records in the graph:
`node active-memory search "" --domains user --tags user/profile-summary`

## Collecting Linked Data
For each user node, retrieve all incoming edges and resolve the linked memories:
`node active-memory graph edges user:<userId> --direction in`

Then read each linked memory:
`active-memory memory <memory-id>`

## LLM Synthesis

The schedule passes all collected memory contents to an LLM consolidation step that produces a unified profile summary.

## Summary Update Strategy

- If a profile summary memory already exists for this user (identified by having an `about_user` edge pointing to the same user node), update its content in place:
`active-memory memory <existing-summary-id> update --text "<consolidated-summary>"`

- If no summary exists, create a new memory and link it to the user node:
`active-memory write --domain user --text "<consolidated-summary>" --tags user/profile-summary`
`active-memory graph relate <summary-id> user:<userId> about_user --domain user`

## Notes

- Skip user nodes that have no linked memory edges.
- Skip LLM calls when there is no content to consolidate.
- Do not duplicate summaries — always check for an existing summary before creating a new one.

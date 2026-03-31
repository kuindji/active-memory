# User Data Querying

## Finding User Facts by Category

Search user facts filtered by category tag:
`node active-memory search "" --domains user --tags <tag>`

Available category tags: `user/identity`, `user/preference`, `user/expertise`, `user/goal`

## Searching User Facts by Content
`node active-memory search "<some-info>" --domains user`

## Getting All Data Linked to a User
Use graph edges to find all memories connected to the user node:
`node active-memory graph edges user:<userId> --direction in`

## Getting the Profile Summary
A consolidated profile summary is stored with the `user/profile-summary` tag:
`node active-memory search "" --domains user --tags user/profile-summary`

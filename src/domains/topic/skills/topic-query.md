# Topic Querying

## Finding Topics by Content

Use search filtered by the `topic` tag:

```sh
active-memory search "machine learning" --tags topic
```

## Listing All Topics

```sh
active-memory search "" --tags topic --limit 50
```

## Finding Memories Linked to a Topic

Traverse `about_topic` edges inward to find all memories linked to a topic:

```sh
active-memory graph traverse <topic-id> --edges about_topic --direction in --depth 1
```

## Finding Child Topics

Traverse `subtopic_of` edges inward to find subtopics:

```sh
active-memory graph traverse <parent-topic-id> --edges subtopic_of --direction in --depth 1
```

## Finding Parent Topics

Traverse `subtopic_of` edges outward to find parent topics:

```sh
active-memory graph traverse <child-topic-id> --edges subtopic_of --direction out --depth 1
```

# Domain .md Files & Cross-Domain Access Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move domain structure/skill content to standalone `.md` files loaded lazily, and enforce cross-domain visibility on all DomainContext read operations.

**Architecture:** Two independent features. Feature 1 adds `baseDir` to DomainConfig, removes inline `content`/`structure` fields, adds lazy-loading helpers to DomainRegistry, and migrates existing domains. Feature 2 adds ownership-based visibility filtering to `getMemory()`, `getMemories()`, `getMemoryTags()`, and `getNodeEdges()` in the engine's `createDomainContext()`.

**Tech Stack:** TypeScript, Bun, SurrealDB, node:fs/promises, node:url, node:path

---

## File Structure

### New files
- `src/domains/topic/structure.md` — Topic domain structure docs (extracted from topic-domain.ts)
- `src/domains/topic/skills/topic-management.md` — Topic management skill content
- `src/domains/topic/skills/topic-query.md` — Topic query skill content
- `src/domains/topic/skills/topic-processing.md` — Topic processing skill content
- `src/domains/user/structure.md` — User domain structure docs (extracted from user-domain.ts)
- `src/domains/user/skills/user-data.md` — User data skill content
- `src/domains/user/skills/user-query.md` — User query skill content
- `src/domains/user/skills/user-profile.md` — User profile skill content
- `tests/fixtures/test-domain/structure.md` — Test fixture structure file
- `tests/fixtures/test-domain/skills/consumption.md` — Test fixture skill file
- `tests/fixtures/test-domain/skills/ingestion.md` — Test fixture skill file
- `tests/fixtures/test-domain/skills/analyze.md` — Test fixture skill file
- `tests/fixtures/test-domain/skills/summarize.md` — Test fixture skill file

### Modified files
- `src/core/types.ts` — Add `baseDir` to DomainConfig, remove `content` from DomainSkill, remove `structure` from DomainConfig
- `src/core/domain-registry.ts` — Add `getStructure()` and `getSkillContent()` async methods, update `listSummaries()`
- `src/core/engine.ts` — Add visibility checks to `getMemory()`, `getMemories()`, `getMemoryTags()`, `getNodeEdges()`
- `src/domains/topic/topic-domain.ts` — Add `baseDir`, remove `STRUCTURE` constant, remove `skills` import reference to content
- `src/domains/topic/skills.ts` — Remove `content` field from all skills
- `src/domains/user/user-domain.ts` — Add `baseDir`, remove `STRUCTURE` constant
- `src/domains/user/skills.ts` — Remove `content` field from all skills
- `src/domains/log-domain.ts` — Add `baseDir`
- `src/cli/commands/domains.ts` — Make `domainCommand` async, use registry's lazy-loading methods
- `src/cli/format.ts` — Update `domain-skill` formatter (skill no longer has inline content)
- `src/index.ts` — No DomainSkill type change needed (just `content` removed)
- `tests/domain-skills.test.ts` — Rewrite to use fixture files + new async loading methods
- `tests/domain-visibility.test.ts` — Add tests for getMemory, getMemoryTags, getNodeEdges visibility
- `tests/cli/commands/domains.test.ts` — Update for async structure/skill loading

---

### Task 1: Update DomainConfig and DomainSkill types

**Files:**
- Modify: `src/core/types.ts:204-240`

- [ ] **Step 1: Write the failing test**

Add a new test in `tests/domain-registry.test.ts` that verifies the new type shape:

```typescript
test('domain with baseDir is accepted', () => {
  const registry = new DomainRegistry()
  const domain: DomainConfig = {
    id: 'typed',
    name: 'Typed Domain',
    baseDir: '/some/path',
    async processInboxItem() {},
  }
  registry.register(domain)
  expect(registry.get('typed')?.baseDir).toBe('/some/path')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/domain-registry.test.ts`
Expected: TypeScript error — `baseDir` does not exist on DomainConfig

- [ ] **Step 3: Update types**

In `src/core/types.ts`, make these changes:

Remove `content` from `DomainSkill` (line 209):
```typescript
export interface DomainSkill {
  id: string
  name: string
  description: string
  scope: 'internal' | 'external' | 'both'
}
```

Remove `structure` and add `baseDir` to `DomainConfig` (lines 225-240):
```typescript
export interface DomainConfig {
  id: string
  name: string
  baseDir?: string
  schema?: DomainSchema
  skills?: DomainSkill[]
  settings?: DomainSettings
  processInboxItem(entry: OwnedMemory, context: DomainContext): Promise<void>
  search?: {
    rank?(query: SearchQuery, candidates: ScoredMemory[]): ScoredMemory[]
    expand?(query: SearchQuery, context: DomainContext): Promise<SearchQuery>
  }
  buildContext?(text: string, budgetTokens: number, context: DomainContext): Promise<ContextResult>
  describe?(): string
  schedules?: DomainSchedule[]
}
```

- [ ] **Step 4: Fix compilation errors across the codebase**

After removing `content` from DomainSkill and `structure` from DomainConfig, multiple files will have TypeScript errors. Do NOT fix domain files or test files yet — those are handled in later tasks. For now, only fix the types file itself and ensure it compiles.

Run: `bun run typecheck`

Expected: Errors in domain files, skills files, tests, CLI — these are expected and will be fixed in subsequent tasks.

- [ ] **Step 5: Commit**

```bash
git add src/core/types.ts tests/domain-registry.test.ts
git commit -m "feat: add baseDir to DomainConfig, remove inline content/structure fields"
```

---

### Task 2: Add lazy-loading methods to DomainRegistry

**Files:**
- Modify: `src/core/domain-registry.ts`
- Test: `tests/domain-registry.test.ts`

- [ ] **Step 1: Create test fixture files**

Create `tests/fixtures/test-domain/structure.md`:
```markdown
# Test Domain Structure

## Tags
- `test/category` - Categorization tag
- `test/priority` - Priority level

## Attributes
- `kind`: string - The type of test entry (unit, integration, e2e)
- `severity`: string - How critical (low, medium, high)
```

Create `tests/fixtures/test-domain/skills/consumption.md`:
```markdown
When querying the test domain, use tags test/category to filter by type.
```

Create `tests/fixtures/test-domain/skills/ingestion.md`:
```markdown
Create entries with kind attribute set to unit, integration, or e2e.
```

Create `tests/fixtures/test-domain/skills/analyze.md`:
```markdown
Analyze test results by grouping by kind and severity.
```

Create `tests/fixtures/test-domain/skills/summarize.md`:
```markdown
Summarize test results across all categories.
```

- [ ] **Step 2: Write the failing tests**

Add tests in `tests/domain-registry.test.ts`:

```typescript
import { join } from 'node:path'

const FIXTURES_DIR = join(import.meta.dir, 'fixtures', 'test-domain')

describe('Lazy loading', () => {
  test('getStructure loads structure.md from baseDir', async () => {
    const registry = new DomainRegistry()
    registry.register({
      id: 'fixtured',
      name: 'Fixtured',
      baseDir: FIXTURES_DIR,
      async processInboxItem() {},
    })
    const structure = await registry.getStructure('fixtured')
    expect(structure).toContain('## Tags')
    expect(structure).toContain('test/category')
  })

  test('getStructure returns null when no baseDir', async () => {
    const registry = new DomainRegistry()
    registry.register({
      id: 'nobase',
      name: 'No Base',
      async processInboxItem() {},
    })
    const structure = await registry.getStructure('nobase')
    expect(structure).toBeNull()
  })

  test('getStructure returns null when structure.md does not exist', async () => {
    const registry = new DomainRegistry()
    registry.register({
      id: 'emptydir',
      name: 'Empty Dir',
      baseDir: join(import.meta.dir, 'fixtures'),
      async processInboxItem() {},
    })
    const structure = await registry.getStructure('emptydir')
    expect(structure).toBeNull()
  })

  test('getSkillContent loads skill md from baseDir/skills/', async () => {
    const registry = new DomainRegistry()
    registry.register({
      id: 'fixtured',
      name: 'Fixtured',
      baseDir: FIXTURES_DIR,
      skills: [
        { id: 'consumption', name: 'Consumption', description: 'desc', scope: 'external' },
      ],
      async processInboxItem() {},
    })
    const content = await registry.getSkillContent('fixtured', 'consumption')
    expect(content).toContain('test/category')
  })

  test('getSkillContent returns null when skill md does not exist', async () => {
    const registry = new DomainRegistry()
    registry.register({
      id: 'fixtured',
      name: 'Fixtured',
      baseDir: FIXTURES_DIR,
      skills: [
        { id: 'nonexistent', name: 'Missing', description: 'desc', scope: 'external' },
      ],
      async processInboxItem() {},
    })
    const content = await registry.getSkillContent('fixtured', 'nonexistent')
    expect(content).toBeNull()
  })

  test('getSkillContent returns null when no baseDir', async () => {
    const registry = new DomainRegistry()
    registry.register({
      id: 'nobase',
      name: 'No Base',
      skills: [
        { id: 'any', name: 'Any', description: 'desc', scope: 'external' },
      ],
      async processInboxItem() {},
    })
    const content = await registry.getSkillContent('nobase', 'any')
    expect(content).toBeNull()
  })

  test('getSkillContent returns null for unknown domain', async () => {
    const registry = new DomainRegistry()
    const content = await registry.getSkillContent('unknown', 'any')
    expect(content).toBeNull()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/domain-registry.test.ts`
Expected: FAIL — `getStructure` and `getSkillContent` do not exist on DomainRegistry

- [ ] **Step 4: Implement lazy-loading methods**

In `src/core/domain-registry.ts`, add the imports and methods:

```typescript
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DomainConfig, DomainSkill, DomainSummary } from './types.ts'

// Inside the class, add:

  async getStructure(domainId: string): Promise<string | null> {
    const domain = this.domains.get(domainId)
    if (!domain?.baseDir) return null
    try {
      return await readFile(join(domain.baseDir, 'structure.md'), 'utf-8')
    } catch {
      return null
    }
  }

  async getSkillContent(domainId: string, skillId: string): Promise<string | null> {
    const domain = this.domains.get(domainId)
    if (!domain?.baseDir) return null
    try {
      return await readFile(join(domain.baseDir, 'skills', `${skillId}.md`), 'utf-8')
    } catch {
      return null
    }
  }
```

Also update `listSummaries()` to detect structure via `baseDir` presence (since `structure` field is removed):

```typescript
  async hasStructure(domainId: string): Promise<boolean> {
    const content = await this.getStructure(domainId)
    return content !== null
  }

  listSummaries(): DomainSummary[] {
    return this.list().map(d => ({
      id: d.id,
      name: d.name,
      description: d.describe?.(),
      hasStructure: d.baseDir != null,
      skillCount: d.skills?.length ?? 0,
    }))
  }
```

Note: `hasStructure` in the summary becomes an approximation (baseDir exists). For accurate checking, use `getStructure()`. The summary is a quick list — acceptable trade-off.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/domain-registry.test.ts`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/domain-registry.ts tests/domain-registry.test.ts tests/fixtures/
git commit -m "feat: add lazy-loading getStructure/getSkillContent to DomainRegistry"
```

---

### Task 3: Create topic domain .md files and update topic domain code

**Files:**
- Create: `src/domains/topic/structure.md`
- Create: `src/domains/topic/skills/topic-management.md`
- Create: `src/domains/topic/skills/topic-query.md`
- Create: `src/domains/topic/skills/topic-processing.md`
- Modify: `src/domains/topic/topic-domain.ts`
- Modify: `src/domains/topic/skills.ts`

- [ ] **Step 1: Create the structure.md file**

Create `src/domains/topic/structure.md` with the exact content from the `STRUCTURE` constant in `topic-domain.ts`:

```markdown
# Topic Domain

Built-in primitive for tracking named topics across domains.

## Tags
- `topic` — All topic memories carry this tag

## Ownership Attributes
- `name`: string — Human-readable topic name
- `status`: 'active' | 'stale' | 'merged' — Topic lifecycle status
- `mentionCount`: number — Times referenced by other domains
- `lastMentionedAt`: number — Timestamp of last reference
- `createdBy`: string — Domain ID that created this topic
- `mergedInto`: string (optional) — Target topic ID when status is 'merged'

## Edges
- `subtopic_of`: Creates parent-child topic hierarchy
- `related_to`: Semantic relatedness between topics (with strength field)
- `about_topic`: Links any memory to a topic (with domain field)
```

- [ ] **Step 2: Create skill .md files**

Create `src/domains/topic/skills/topic-management.md` — copy the `content` value from the `topicManagement` skill object in `skills.ts` (the full markdown starting with `# Topic Management`).

Create `src/domains/topic/skills/topic-query.md` — copy the `content` value from the `topicQuery` skill object.

Create `src/domains/topic/skills/topic-processing.md` — copy the `content` value from the `topicProcessing` skill object.

**Important:** These files contain template literal interpolations in the original TS code (e.g., `` `${TOPIC_DOMAIN_ID}` ``, `` `${TOPIC_TAG}` ``). Replace them with the actual values:
- `${TOPIC_DOMAIN_ID}` → `topic`
- `${TOPIC_TAG}` → `topic`
- `${MERGE_SIMILARITY_THRESHOLD}` → `0.85`

- [ ] **Step 3: Update skills.ts — remove content field**

In `src/domains/topic/skills.ts`, remove the `content` property from all three skill objects and remove the imports that were only used for template interpolation in content:

```typescript
import type { DomainSkill } from '../../core/types.ts'

const topicManagement: DomainSkill = {
  id: 'topic-management',
  name: 'How to create and manage topics',
  description: 'Tells external agents how to create topics, link memories to topics, set parent topics, and track mention counts',
  scope: 'external',
}

const topicQuery: DomainSkill = {
  id: 'topic-query',
  name: 'How to query topics',
  description: 'Tells external agents how to find topics, list active topics, and traverse topic relationships',
  scope: 'external',
}

const topicProcessing: DomainSkill = {
  id: 'topic-processing',
  name: 'Internal topic merge detection',
  description: 'Internal skill for detecting and merging duplicate or near-duplicate topics',
  scope: 'internal',
}

export const topicSkills: DomainSkill[] = [topicManagement, topicQuery, topicProcessing]
```

- [ ] **Step 4: Update topic-domain.ts — add baseDir, remove STRUCTURE**

In `src/domains/topic/topic-domain.ts`:

Add imports:
```typescript
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
```

Remove the `STRUCTURE` constant entirely.

Add `baseDir` to the returned config and remove `structure`:

```typescript
export function createTopicDomain(options?: TopicDomainOptions): DomainConfig {
  return {
    id: TOPIC_DOMAIN_ID,
    name: 'Topic',
    baseDir: dirname(fileURLToPath(import.meta.url)),
    schema: {
      // ... unchanged
    },
    skills: topicSkills,
    // ... rest unchanged
  }
}
```

- [ ] **Step 5: Verify topic domain compiles**

Run: `bun run typecheck`
Expected: No errors in topic domain files (there may still be errors in test files — those are fixed later)

- [ ] **Step 6: Commit**

```bash
git add src/domains/topic/
git commit -m "refactor: move topic domain structure and skills to .md files"
```

---

### Task 4: Create user domain .md files and update user domain code

**Files:**
- Create: `src/domains/user/structure.md`
- Create: `src/domains/user/skills/user-data.md`
- Create: `src/domains/user/skills/user-query.md`
- Create: `src/domains/user/skills/user-profile.md`
- Modify: `src/domains/user/user-domain.ts`
- Modify: `src/domains/user/skills.ts`

- [ ] **Step 1: Create the structure.md file**

Create `src/domains/user/structure.md` with the content from the `STRUCTURE` constant in `user-domain.ts`:

```markdown
# User Domain

Built-in primitive for tracking facts about individual users across domains.

## Tags
- `user` — Root tag for all user-related memories
- `user/identity` — Identity attributes (name, location, pronouns)
- `user/preference` — Preferences, communication style, settings
- `user/expertise` — Skills, knowledge areas, professional background
- `user/goal` — Current objectives, aspirations, ongoing projects
- `user/profile-summary` — Consolidated profile summary generated by the domain schedule

## Nodes
- `user`: Represents a unique user identified by a `userId` string field

## Edges
- `about_user`: Links any memory to a user node (with optional `domain` field)
```

- [ ] **Step 2: Create skill .md files**

Create `src/domains/user/skills/user-data.md` — copy content from `userData` skill object. Replace interpolations:
- `${USER_DOMAIN_ID}` → `user`
- `${USER_TAG}` → `user`

Create `src/domains/user/skills/user-query.md` — copy content from `userQuery` skill object, same replacements.

Create `src/domains/user/skills/user-profile.md` — copy content from `userProfile` skill object, same replacements.

- [ ] **Step 3: Update skills.ts — remove content field**

In `src/domains/user/skills.ts`:

```typescript
import type { DomainSkill } from '../../core/types.ts'

const userData: DomainSkill = {
  id: 'user-data',
  name: 'How to store user facts',
  description: 'Tells external agents how to find or create a user node, store user facts, and link existing memories to a user',
  scope: 'external',
}

const userQuery: DomainSkill = {
  id: 'user-query',
  name: 'How to query user data',
  description: 'Tells external agents how to find user facts by category, retrieve all data linked to a user, and get a profile summary',
  scope: 'external',
}

const userProfile: DomainSkill = {
  id: 'user-profile',
  name: 'Internal user profile consolidation',
  description: 'Internal skill describing how user profile summaries are synthesised from accumulated user facts',
  scope: 'internal',
}

export const userSkills: DomainSkill[] = [userData, userQuery, userProfile]
```

- [ ] **Step 4: Update user-domain.ts — add baseDir, remove STRUCTURE**

In `src/domains/user/user-domain.ts`:

Add imports:
```typescript
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
```

Remove the `STRUCTURE` constant entirely.

Add `baseDir` to the returned config and remove `structure`:

```typescript
export function createUserDomain(options?: UserDomainOptions): DomainConfig {
  return {
    id: USER_DOMAIN_ID,
    name: 'User',
    baseDir: dirname(fileURLToPath(import.meta.url)),
    schema: {
      // ... unchanged
    },
    skills: userSkills,
    // ... rest unchanged
  }
}
```

- [ ] **Step 5: Update log-domain.ts — add baseDir**

In `src/domains/log-domain.ts`, add `baseDir`:

```typescript
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import type { DomainConfig, OwnedMemory, DomainContext } from '../core/types.ts'

export const logDomain: DomainConfig = {
  id: 'log',
  name: 'Log',
  baseDir: dirname(fileURLToPath(import.meta.url)),
  async processInboxItem(_entry: OwnedMemory, _context: DomainContext): Promise<void> {
    // Log domain is a no-op processor — it just keeps the raw memories
  },
  describe() {
    return 'Built-in chronological log. Keeps all ingested memories with no processing.'
  },
}
```

- [ ] **Step 6: Verify all domain code compiles**

Run: `bun run typecheck`
Expected: No errors in domain files (test errors still expected)

- [ ] **Step 7: Commit**

```bash
git add src/domains/user/ src/domains/log-domain.ts
git commit -m "refactor: move user domain structure and skills to .md files, add baseDir to log domain"
```

---

### Task 5: Update CLI domain commands for lazy loading

**Files:**
- Modify: `src/cli/commands/domains.ts`
- Modify: `src/cli/format.ts:109-110`

- [ ] **Step 1: Write the failing test**

Update `tests/cli/commands/domains.test.ts` to use fixture-based test domains and test async loading. Replace the `testDomain` fixture at the top of the file:

```typescript
import { join } from 'node:path'

const FIXTURES_DIR = join(import.meta.dir, '..', '..', 'fixtures', 'test-domain')

const testDomain: DomainConfig = {
  id: 'test-domain',
  name: 'Test Domain',
  baseDir: FIXTURES_DIR,
  skills: [
    {
      id: 'consumption',
      name: 'How to use Test Domain data',
      description: 'Tells external agents how to query and interpret test domain data',
      scope: 'external',
    },
    {
      id: 'ingestion',
      name: 'How to create Test Domain data',
      description: 'Tells external agents how to create data for this domain',
      scope: 'external',
    },
    {
      id: 'analyze',
      name: 'Internal analysis',
      description: 'Used by domain agent to analyze test results',
      scope: 'internal',
    },
  ],
  async processInboxItem(_entry: OwnedMemory, _context: DomainContext) {
    // no-op
  },
}
```

Update the structure test to expect the `structure` to come from the output (loaded lazily):

```typescript
it('returns domain structure with formatCommand domain-structure', async () => {
  const result = await domainCommand(engine, makeParsed('domain', ['test-domain', 'structure']))
  expect(result.exitCode).toBe(0)
  expect(result.formatCommand).toBe('domain-structure')
  const output = result.output as { domainId: string; structure: string }
  expect(output.domainId).toBe('test-domain')
  expect(output.structure).toContain('## Tags')
})
```

Update the skill content test:

```typescript
it('returns specific skill with content loaded from file', async () => {
  const result = await domainCommand(engine, makeParsed('domain', ['test-domain', 'skill', 'consumption']))
  expect(result.exitCode).toBe(0)
  expect(result.formatCommand).toBe('domain-skill')
  const skill = result.output as { id: string; name: string; content: string }
  expect(skill.id).toBe('consumption')
  expect(skill.name).toBe('How to use Test Domain data')
  expect(skill.content).toContain('test/category')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/cli/commands/domains.test.ts`
Expected: FAIL — current domainCommand reads `domain.structure` directly (which no longer exists)

- [ ] **Step 3: Update the domainCommand handler**

In `src/cli/commands/domains.ts`:

```typescript
import type { CommandHandler, CommandResult } from '../types.ts'

const domainsCommand: CommandHandler = (engine, _parsed) => {
  const registry = engine.getDomainRegistry()
  const summaries = registry.listSummaries()
  return Promise.resolve({ output: summaries, exitCode: 0 })
}

const domainCommand: CommandHandler = async (engine, parsed): Promise<CommandResult> => {
  const registry = engine.getDomainRegistry()
  const domainId = parsed.args[0]
  const subcommand = parsed.args[1]

  if (!domainId) {
    return { output: { error: 'Domain ID is required' }, exitCode: 1 }
  }

  const domain = registry.get(domainId)
  if (!domain) {
    return { output: { error: `Domain "${domainId}" not found` }, exitCode: 1 }
  }

  if (!subcommand) {
    return { output: { error: 'Subcommand is required: structure, skills, or skill <skill-id>' }, exitCode: 1 }
  }

  if (subcommand === 'structure') {
    const structure = await registry.getStructure(domainId)
    if (!structure) {
      return { output: { error: `Domain "${domainId}" has no structure defined` }, exitCode: 1 }
    }
    return {
      output: { domainId, structure },
      exitCode: 0,
      formatCommand: 'domain-structure',
    }
  }

  if (subcommand === 'skills') {
    const skills = registry.getExternalSkills(domainId)
    return {
      output: { domainId, skills },
      exitCode: 0,
      formatCommand: 'domain-skills',
    }
  }

  if (subcommand === 'skill') {
    const skillId = parsed.args[2]
    if (!skillId) {
      return { output: { error: 'Skill ID is required' }, exitCode: 1 }
    }
    const skill = registry.getSkill(domainId, skillId)
    if (!skill) {
      return { output: { error: `Skill "${skillId}" not found in domain "${domainId}"` }, exitCode: 1 }
    }
    const content = await registry.getSkillContent(domainId, skillId)
    return {
      output: { ...skill, content: content ?? '' },
      exitCode: 0,
      formatCommand: 'domain-skill',
    }
  }

  return { output: { error: `Unknown subcommand "${subcommand}". Expected: structure, skills, or skill <skill-id>` }, exitCode: 1 }
}

export { domainsCommand, domainCommand }
```

- [ ] **Step 4: Update format.ts**

In `src/cli/format.ts`, the `domain-skill` case accesses `(data as DomainSkill).content`. Since `DomainSkill` no longer has `content`, update the type assertion:

```typescript
    case 'domain-skill':
      return (data as { content: string }).content
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/cli/commands/domains.test.ts`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/domains.ts src/cli/format.ts tests/cli/commands/domains.test.ts
git commit -m "refactor: update CLI domain commands to use lazy-loaded .md files"
```

---

### Task 6: Update domain-skills test to use fixture files

**Files:**
- Modify: `tests/domain-skills.test.ts`

- [ ] **Step 1: Rewrite test to use baseDir and lazy loading**

Replace the test file content:

```typescript
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { join } from 'node:path'
import { MemoryEngine } from '../src/core/engine.ts'
import { MockLLMAdapter } from './helpers.ts'
import type { DomainConfig, OwnedMemory, DomainContext } from '../src/core/types.ts'

const FIXTURES_DIR = join(import.meta.dir, 'fixtures', 'test-domain')

describe('Domain skills and structure', () => {
  let engine: MemoryEngine

  const testDomain: DomainConfig = {
    id: 'test-domain',
    name: 'Test Domain',
    baseDir: FIXTURES_DIR,
    skills: [
      {
        id: 'consumption',
        name: 'How to use Test Domain data',
        description: 'Tells external agents how to query and interpret test domain data',
        scope: 'external',
      },
      {
        id: 'ingestion',
        name: 'How to create Test Domain data',
        description: 'Tells external agents how to create data for this domain',
        scope: 'external',
      },
      {
        id: 'analyze',
        name: 'Internal analysis',
        description: 'Used by domain agent to analyze test results',
        scope: 'internal',
      },
      {
        id: 'summarize',
        name: 'Summarize test results',
        description: 'Can be used internally or by other agents',
        scope: 'both',
      },
    ],
    async processInboxItem(_entry: OwnedMemory, _context: DomainContext) {
      // no-op
    },
  }

  const minimalDomain: DomainConfig = {
    id: 'minimal',
    name: 'Minimal Domain',
    async processInboxItem(_entry: OwnedMemory, _context: DomainContext) {
      // no-op
    },
  }

  beforeEach(async () => {
    engine = new MemoryEngine()
    await engine.initialize({
      connection: 'mem://',
      namespace: 'test',
      database: `test_${Date.now()}`,
      llm: new MockLLMAdapter(),
    })
    await engine.registerDomain(testDomain)
    await engine.registerDomain(minimalDomain)
  })

  afterEach(async () => {
    await engine.close()
  })

  test('getStructure loads structure from .md file', async () => {
    const registry = engine.getDomainRegistry()
    const structure = await registry.getStructure('test-domain')
    expect(structure).toContain('## Tags')
    expect(structure).toContain('test/category')
  })

  test('domain without baseDir returns null for structure', async () => {
    const registry = engine.getDomainRegistry()
    const structure = await registry.getStructure('minimal')
    expect(structure).toBeNull()
  })

  test('getExternalSkills returns only external and both-scoped skills', () => {
    const registry = engine.getDomainRegistry()
    const skills = registry.getExternalSkills('test-domain')
    expect(skills.length).toBe(3)
    expect(skills.map(s => s.id).sort()).toEqual(['consumption', 'ingestion', 'summarize'])
  })

  test('getInternalSkills returns only internal and both-scoped skills', () => {
    const registry = engine.getDomainRegistry()
    const skills = registry.getInternalSkills('test-domain')
    expect(skills.length).toBe(2)
    expect(skills.map(s => s.id).sort()).toEqual(['analyze', 'summarize'])
  })

  test('getSkill returns specific skill by id', () => {
    const registry = engine.getDomainRegistry()
    const skill = registry.getSkill('test-domain', 'consumption')
    expect(skill).toBeDefined()
    expect(skill!.name).toBe('How to use Test Domain data')
    expect(skill!.scope).toBe('external')
  })

  test('getSkillContent loads content from .md file', async () => {
    const registry = engine.getDomainRegistry()
    const content = await registry.getSkillContent('test-domain', 'consumption')
    expect(content).toContain('test/category')
  })

  test('getSkill returns undefined for nonexistent skill', () => {
    const registry = engine.getDomainRegistry()
    const skill = registry.getSkill('test-domain', 'nonexistent')
    expect(skill).toBeUndefined()
  })

  test('domain without skills returns empty arrays', () => {
    const registry = engine.getDomainRegistry()
    expect(registry.getExternalSkills('minimal')).toEqual([])
    expect(registry.getInternalSkills('minimal')).toEqual([])
  })

  test('listDomainSummaries returns id, name, and description for all domains', () => {
    const registry = engine.getDomainRegistry()
    const summaries = registry.listSummaries()
    const testSummary = summaries.find(s => s.id === 'test-domain')
    expect(testSummary).toBeDefined()
    expect(testSummary!.name).toBe('Test Domain')
    expect(testSummary!.hasStructure).toBe(true)
    expect(testSummary!.skillCount).toBe(4)

    const minimalSummary = summaries.find(s => s.id === 'minimal')
    expect(minimalSummary).toBeDefined()
    expect(minimalSummary!.hasStructure).toBe(false)
    expect(minimalSummary!.skillCount).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `bun test tests/domain-skills.test.ts`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add tests/domain-skills.test.ts
git commit -m "test: update domain-skills tests to use fixture .md files"
```

---

### Task 7: Add visibility checks to getMemory and getMemoryTags

**Files:**
- Modify: `src/core/engine.ts:372-383` (getMemory) and `594-599` (getMemoryTags)
- Test: `tests/domain-visibility.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/domain-visibility.test.ts`:

```typescript
test('getMemory returns null for memory owned only by non-visible domain', async () => {
  const ctx = engine.createDomainContext('domaina')
  // domaina can only see domaina + domainb
  // Find a memory owned by domainc
  const ctxC = engine.createDomainContext('domainc')
  const memoriesC = await ctxC.getMemories({ domains: ['domainc'] })
  const memoryFromC = memoriesC.find(m => m.content === 'content from C')
  expect(memoryFromC).toBeDefined()

  const result = await ctx.getMemory(memoryFromC!.id)
  expect(result).toBeNull()
})

test('getMemory returns memory owned by visible domain', async () => {
  const ctx = engine.createDomainContext('domaina')
  // domaina can see domainb
  const ctxB = engine.createDomainContext('domainb')
  const memoriesB = await ctxB.getMemories({ domains: ['domainb'] })
  const memoryFromB = memoriesB.find(m => m.content === 'content from B')
  expect(memoryFromB).toBeDefined()

  const result = await ctx.getMemory(memoryFromB!.id)
  expect(result).toBeDefined()
  expect(result!.content).toBe('content from B')
})

test('getMemoryTags returns empty for memory owned only by non-visible domain', async () => {
  const ctx = engine.createDomainContext('domaina')
  const ctxC = engine.createDomainContext('domainc')
  const memoriesC = await ctxC.getMemories({ domains: ['domainc'] })
  const memoryFromC = memoriesC.find(m => m.content === 'content from C')
  expect(memoryFromC).toBeDefined()

  const tags = await ctx.getMemoryTags(memoryFromC!.id)
  expect(tags).toEqual([])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/domain-visibility.test.ts`
Expected: FAIL — `getMemory` currently returns the node regardless of visibility

- [ ] **Step 3: Add a visibility check helper in createDomainContext**

In `src/core/engine.ts`, inside the `createDomainContext` method (around line 362), add a helper function before the returned object:

```typescript
    async function isMemoryVisible(memoryId: string): Promise<boolean> {
      const owners = await graph.query<{ out: unknown }[]>(
        'SELECT out FROM owned_by WHERE in = $memId',
        { memId: new StringRecordId(memoryId) }
      )
      if (!owners || owners.length === 0) return false
      return owners.some(o => {
        const domainId = String(o.out).replace(/^domain:/, '')
        return visibleDomains.includes(domainId)
      })
    }
```

- [ ] **Step 4: Update getMemory to check visibility**

In the returned object's `getMemory` method:

```typescript
      async getMemory(id: string): Promise<MemoryEntry | null> {
        const node = await graph.getNode(id)
        if (!node) return null
        if (!await isMemoryVisible(id)) return null
        return {
          id: node.id,
          content: node.content as string,
          eventTime: (node.event_time as number | null) ?? null,
          createdAt: node.created_at as number,
          tokenCount: node.token_count as number,
        }
      },
```

- [ ] **Step 5: Update getMemoryTags to check visibility**

```typescript
      async getMemoryTags(memoryId: string): Promise<string[]> {
        if (!await isMemoryVisible(memoryId)) return []
        const rows = await graph.query<string[]>(
          'SELECT VALUE out.label FROM tagged WHERE in = $memId',
          { memId: new StringRecordId(memoryId) }
        )
        return (rows ?? []).filter((label): label is string => typeof label === 'string')
      },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test tests/domain-visibility.test.ts`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add src/core/engine.ts tests/domain-visibility.test.ts
git commit -m "feat: enforce visibility checks on getMemory and getMemoryTags"
```

---

### Task 8: Add visibility checks to getNodeEdges

**Files:**
- Modify: `src/core/engine.ts:602-626` (getNodeEdges)
- Test: `tests/domain-visibility.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/domain-visibility.test.ts`:

```typescript
test('getNodeEdges filters edges connecting to memories from non-visible domains', async () => {
  // domaina can only see domaina + domainb
  const ctx = engine.createDomainContext('domaina')

  // Get a memory from domaina
  const memoriesA = await ctx.getMemories({ domains: ['domaina'] })
  const memoryFromA = memoriesA.find(m => m.content === 'content from A')
  expect(memoryFromA).toBeDefined()

  // Get all edges from this memory — should not include edges to memories from domainc/domaind
  // All ingested memories have owned_by edges and tagged edges
  const edges = await ctx.getNodeEdges(memoryFromA!.id, 'out')

  // owned_by edges point to domain nodes, not memory nodes — those should pass through
  // tagged edges point to tag nodes — those should pass through
  // The key test is: if we create a cross-memory edge, it should be filtered
  // For this test, we verify the basic edge retrieval works with visibility
  expect(edges.length).toBeGreaterThan(0)
})

test('getNodeEdges excludes edges to non-visible memory nodes', async () => {
  // Create a cross-memory reference edge between domainA memory and domainC memory
  const graph = engine.getGraph()
  const ctxD = engine.createDomainContext('domaind')
  const memoriesD = await ctxD.getMemories({ domains: ['domaind'] })
  const memoryFromD = memoriesD.find(m => m.content === 'content from D')

  const ctxA = engine.createDomainContext('domaina')
  const memoriesA = await ctxA.getMemories({ domains: ['domaina'] })
  const memoryFromA = memoriesA.find(m => m.content === 'content from A')

  // Create a reinforces edge from A -> D
  await graph.relate(memoryFromA!.id, 'reinforces', memoryFromD!.id, {
    strength: 0.9,
    detected_at: Date.now(),
  })

  // From domaina's context, getNodeEdges should NOT include the edge to memoryFromD
  // because domaina can only see domaina + domainb
  const ctxFiltered = engine.createDomainContext('domaina')
  const edges = await ctxFiltered.getNodeEdges(memoryFromA!.id, 'out')

  const reinforcesEdges = edges.filter(e => String(e.id).startsWith('reinforces:'))
  expect(reinforcesEdges.length).toBe(0)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/domain-visibility.test.ts`
Expected: FAIL — `getNodeEdges` currently returns all edges without filtering

- [ ] **Step 3: Update getNodeEdges to filter by visibility**

In `src/core/engine.ts`, update the `getNodeEdges` method:

```typescript
      async getNodeEdges(nodeId: string, direction?: 'in' | 'out' | 'both'): Promise<Edge[]> {
        const dir = direction ?? 'both'
        const conditions: string[] = []
        if (dir === 'out' || dir === 'both') conditions.push('in = $nodeId')
        if (dir === 'in' || dir === 'both') conditions.push('out = $nodeId')
        const where = conditions.join(' OR ')

        const edgeNames = schema.getRegisteredEdgeNames()
        const coreEdges = ['tagged', 'owned_by', 'reinforces', 'contradicts', 'summarizes', 'refines', 'child_of', 'has_rule']
        const allEdges = [...new Set([...coreEdges, ...edgeNames])]

        const results: Edge[] = []
        const nodeRef = new StringRecordId(nodeId)
        for (const edgeName of allEdges) {
          const rows = await graph.query<Edge[]>(
            `SELECT * FROM ${edgeName} WHERE ${where}`,
            { nodeId: nodeRef }
          )
          if (rows) results.push(...rows)
        }

        // Filter edges that connect to memory nodes from non-visible domains
        const filtered: Edge[] = []
        for (const edge of results) {
          const inId = String(edge.in)
          const outId = String(edge.out)
          // Determine the "other" node — the one that isn't the queried node
          const otherId = inId === nodeId ? outId : inId

          // Only check visibility for memory nodes
          if (otherId.startsWith('memory:')) {
            if (await isMemoryVisible(otherId)) {
              filtered.push(edge)
            }
          } else {
            // Non-memory nodes (tags, domains, user nodes, etc.) pass through
            filtered.push(edge)
          }
        }

        return filtered
      },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/domain-visibility.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/engine.ts tests/domain-visibility.test.ts
git commit -m "feat: enforce visibility checks on getNodeEdges"
```

---

### Task 9: Run full test suite, typecheck, and lint

**Files:**
- Potentially fix: any files with remaining compilation errors or test failures

- [ ] **Step 1: Run typecheck**

Run: `bun run typecheck`
Expected: No errors. If there are errors, fix them — they'll likely be in test files or format.ts that still reference `content` on DomainSkill.

- [ ] **Step 2: Run full test suite**

Run: `bun test`
Expected: All tests pass. Fix any failures.

- [ ] **Step 3: Run lint**

Run: `bun run lint:fix`
Expected: No errors or auto-fixed.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve remaining type and test issues after md files migration"
```

Only commit if there were actual fixes needed. Skip if everything passed cleanly.

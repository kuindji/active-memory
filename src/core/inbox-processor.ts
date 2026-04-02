import { StringRecordId } from 'surrealdb'
import type { GraphStore } from './graph-store.ts'
import type { DomainRegistry } from './domain-registry.ts'
import type { EventEmitter } from './events.ts'
import type { DomainContext, OwnedMemory, MemoryEntry, Node } from './types.ts'

interface RecordIdLike {
  tb: string
  id: string
  toString(): string
}

interface RawMemoryRow {
  id: RecordIdLike | string
  content: string
  event_time: number | null
  created_at: number
  token_count: number
}

interface RawOwnedByEdge {
  out: RecordIdLike | string
  attributes?: Record<string, unknown>
  owned_at?: number
}

interface RawTaggedRow {
  in: RecordIdLike | string
  label: string
}

interface InboxLockPayload {
  lockedAt: number
}

interface InboxProcessorOptions {
  intervalMs?: number
  batchLimit?: number
  staleAfterMs?: number
}

class InboxProcessor {
  private timeout: ReturnType<typeof setTimeout> | null = null
  private running = false
  private intervalMs = 5000
  private batchLimit = 50
  private staleAfterMs = 30_000

  constructor(
    private store: GraphStore,
    private domainRegistry: DomainRegistry,
    private events: EventEmitter,
    private contextFactory: (domainId: string, requestContext?: Record<string, unknown>) => DomainContext
  ) {}

  // --- Phase 1: Claim Assertion ---

  private async processAssertionBatch(): Promise<number> {
    // Find memories with assert-claim tags
    const rows = await this.store.query<RawMemoryRow[]>(
      `SELECT id, content, event_time, created_at, token_count
       FROM memory
       WHERE ->tagged->tag CONTAINS tag:inbox
       ORDER BY created_at ASC LIMIT $limit`,
      { limit: this.batchLimit }
    )

    if (!rows || rows.length === 0) return 0

    // Filter to only memories that have assert-claim tags
    const memoriesWithAssertions: { mem: RawMemoryRow; assertTags: string[] }[] = []

    for (const raw of rows) {
      const memId = String(raw.id)
      const assertTags = await this.store.query<string[]>(
        `SELECT VALUE out.label FROM tagged
         WHERE in = $memId AND string::starts_with(out.label, 'inbox:assert-claim:')`,
        { memId: new StringRecordId(memId) }
      )
      if (assertTags && assertTags.length > 0) {
        memoriesWithAssertions.push({ mem: raw, assertTags })
      }
    }

    if (memoriesWithAssertions.length === 0) return 0

    // Process all memories in parallel
    await Promise.allSettled(
      memoriesWithAssertions.map(({ mem, assertTags }) =>
        this.processAssertions(mem, assertTags)
      )
    )

    return memoriesWithAssertions.length
  }

  private async processAssertions(raw: RawMemoryRow, assertTags: string[]): Promise<void> {
    const memId = String(raw.id)
    const memory: MemoryEntry = {
      id: memId,
      content: raw.content,
      eventTime: raw.event_time,
      createdAt: raw.created_at,
      tokenCount: raw.token_count,
    }

    // Get existing tags (excluding inbox-related)
    const allTags = await this.store.query<string[]>(
      `SELECT VALUE out.label FROM tagged WHERE in = $memId`,
      { memId: new StringRecordId(memId) }
    )
    const tags = (allTags ?? [])
      .filter((label): label is string => typeof label === 'string')
      .filter(l => !l.startsWith('inbox'))

    // Extract domain IDs from assert-claim tag labels
    const prefix = 'inbox:assert-claim:'
    const domainIds = assertTags.map(label => label.slice(prefix.length))

    // Run all assertions in parallel
    const results = await Promise.allSettled(
      domainIds.map(async (domainId) => {
        const domain = this.domainRegistry.get(domainId)
        if (!domain?.assertInboxClaim) return false

        const owned: OwnedMemory = {
          memory,
          domainAttributes: {},
          tags,
        }

        const ctx = this.contextFactory(domainId)
        try {
          const claimed = await domain.assertInboxClaim(owned, ctx)
          if (claimed) {
            // Create ownership
            const fullDomainId = `domain:${domainId}`
            await this.store.relate(memId, 'owned_by', fullDomainId, {
              attributes: {},
              owned_at: Date.now(),
            })
            // Add inbox processing tag
            const inboxTagId = `tag:\`inbox:${domainId}\``
            try {
              await this.store.createNodeWithId(inboxTagId, {
                label: `inbox:${domainId}`,
                created_at: Date.now(),
              })
            } catch { /* already exists */ }
            await this.store.relate(memId, 'tagged', inboxTagId)
          }
          return claimed
        } catch (err) {
          this.events.emit('error', {
            source: 'inbox-assertion',
            domainId,
            memoryId: memId,
            error: err,
          })
          return false
        }
      })
    )

    // Remove all assert-claim tags
    for (const label of assertTags) {
      const tagId = `tag:\`${label}\``
      await this.store.unrelate(memId, 'tagged', tagId)
    }

    // Check if any domain claimed or if memory has any owners (from autoOwn)
    const owners = await this.store.query<{ count: number }[]>(
      'SELECT count() AS count FROM owned_by WHERE in = $memId GROUP ALL',
      { memId: new StringRecordId(memId) }
    )
    const ownerCount = (owners && owners.length > 0) ? owners[0].count : 0

    if (ownerCount === 0) {
      // No one claimed — clean up the memory
      await this.removeOrphanedMemory(memId)
    }

    this.events.emit('inboxClaimAsserted', {
      memoryId: memId,
      claimed: results.filter(r => r.status === 'fulfilled' && r.value === true).length,
    })
  }

  // --- Phase 2: Inbox Processing ---

  private async processInboxBatch(): Promise<number> {
    // Find memories with inbox:<domain> tags (excluding assert-claim)
    const taggedRows = await this.store.query<RawTaggedRow[]>(
      `SELECT in, out.label AS label FROM tagged
       WHERE string::starts_with(out.label, 'inbox:')
         AND !string::starts_with(out.label, 'inbox:assert-claim:')
       LIMIT $limit`,
      { limit: this.batchLimit * 10 } // fetch more since multiple tags per memory
    )

    if (!taggedRows || taggedRows.length === 0) return 0

    // Group by memory ID
    const memoryDomains = new Map<string, string[]>()
    for (const row of taggedRows) {
      const memId = String(row.in)
      const domainId = row.label.slice('inbox:'.length)
      if (!memoryDomains.has(memId)) {
        memoryDomains.set(memId, [])
      }
      memoryDomains.get(memId)!.push(domainId)
    }

    // Limit to batchLimit memories
    const memIds = [...memoryDomains.keys()].slice(0, this.batchLimit)

    // Process all memories in parallel
    await Promise.allSettled(
      memIds.map(memId => this.processDomainInbox(memId, memoryDomains.get(memId)!))
    )

    return memIds.length
  }

  private async processDomainInbox(memId: string, domainIds: string[]): Promise<void> {
    // Fetch memory
    const node = await this.store.getNode<Node & RawMemoryRow>(memId)
    if (!node) return

    const memory: MemoryEntry = {
      id: memId,
      content: node.content,
      eventTime: node.event_time,
      createdAt: node.created_at,
      tokenCount: node.token_count,
    }

    // Get non-inbox tags
    const allTags = await this.store.query<string[]>(
      `SELECT VALUE out.label FROM tagged WHERE in = $memId`,
      { memId: new StringRecordId(memId) }
    )
    const tags = (allTags ?? [])
      .filter((label): label is string => typeof label === 'string')
      .filter(l => !l.startsWith('inbox'))

    // Process all domains in parallel
    await Promise.allSettled(
      domainIds.map(async (domainId) => {
        const domain = this.domainRegistry.get(domainId)
        if (!domain) return

        // Get domain attributes from owned_by edge
        const ownedByEdges = await this.store.query<RawOwnedByEdge[]>(
          'SELECT attributes, owned_at FROM owned_by WHERE in = $memId AND out = $domainId',
          {
            memId: new StringRecordId(memId),
            domainId: new StringRecordId(`domain:${domainId}`),
          }
        )
        const domainAttributes = ownedByEdges?.[0]?.attributes ?? {}

        const owned: OwnedMemory = {
          memory,
          domainAttributes,
          tags,
        }

        const ctx = this.contextFactory(domainId)
        try {
          await domain.processInboxItem(owned, ctx)
        } catch (err) {
          this.events.emit('error', {
            source: 'inbox',
            domainId,
            memoryId: memId,
            error: err,
          })
        }

        // Remove this domain's inbox tag (always, even on error)
        const inboxTagId = `tag:\`inbox:${domainId}\``
        await this.store.unrelate(memId, 'tagged', inboxTagId)

        this.events.emit('inboxDomainProcessed', { memoryId: memId, domainId })
      })
    )

    // Check if any inbox: tags remain
    const remainingInbox = await this.store.query<{ count: number }[]>(
      `SELECT count() AS count FROM tagged
       WHERE in = $memId AND string::starts_with(out.label, 'inbox:')
       GROUP ALL`,
      { memId: new StringRecordId(memId) }
    )
    const remaining = (remainingInbox && remainingInbox.length > 0) ? remainingInbox[0].count : 0

    if (remaining === 0) {
      // All domain tags cleared — remove the inbox tag
      await this.store.unrelate(memId, 'tagged', 'tag:inbox')
      this.events.emit('inboxProcessed', { memoryId: memId })
    }
  }

  // --- Cleanup ---

  private async removeOrphanedMemory(memId: string): Promise<void> {
    // Remove all tagged edges
    await this.store.query(
      'DELETE tagged WHERE in = $memId',
      { memId: new StringRecordId(memId) }
    )
    // Delete the memory node
    await this.store.deleteNode(memId)
    this.events.emit('deleted', { memoryId: memId, reason: 'unclaimed' })
  }

  // --- Tick & Lifecycle ---

  async tick(): Promise<boolean> {
    try {
      const acquired = await this.acquireLock()
      if (!acquired) return false

      const asserted = await this.processAssertionBatch()
      const processed = await this.processInboxBatch()

      return asserted > 0 || processed > 0
    } catch (err) {
      this.events.emit('error', { source: 'inbox', error: err })
      return false
    } finally {
      await this.releaseLock()
      this.scheduleNext()
    }
  }

  start(options?: InboxProcessorOptions): void {
    if (this.running) return
    if (options?.intervalMs != null) this.intervalMs = options.intervalMs
    if (options?.batchLimit != null) this.batchLimit = options.batchLimit
    if (options?.staleAfterMs != null) this.staleAfterMs = options.staleAfterMs
    this.running = true
    this.scheduleNext()
  }

  stop(): void {
    this.running = false
    if (this.timeout) {
      clearTimeout(this.timeout)
      this.timeout = null
    }
  }

  private scheduleNext(): void {
    if (!this.running) return
    this.timeout = setTimeout(() => { void this.tick() }, this.intervalMs)
  }

  private async acquireLock(): Promise<boolean> {
    const existing = await this.store.getNode<Node & { value?: string }>('meta:_inbox_lock')

    if (existing?.value) {
      const parsed: unknown = JSON.parse(existing.value)
      const lockedAt = parsed && typeof parsed === 'object' && 'lockedAt' in parsed
        ? (parsed as { lockedAt: unknown }).lockedAt
        : undefined
      if (typeof lockedAt === 'number') {
        const age = Date.now() - lockedAt
        if (age < this.staleAfterMs) {
          return false
        }
      }
    }

    const payload: InboxLockPayload = { lockedAt: Date.now() }

    try {
      if (existing) {
        await this.store.updateNode('meta:_inbox_lock', { value: JSON.stringify(payload) })
      } else {
        await this.store.createNodeWithId('meta:_inbox_lock', { value: JSON.stringify(payload) })
      }
    } catch {
      return false
    }

    return true
  }

  private async releaseLock(): Promise<void> {
    try {
      await this.store.deleteNode('meta:_inbox_lock')
    } catch {
      // Best-effort — staleness will handle it
    }
  }
}

export { InboxProcessor }

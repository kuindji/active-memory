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
  embedding?: number[]
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
  similarityThreshold?: number
}

interface SimilarityBatch {
  batchId: string
  entries: OwnedMemory[]
  memoryIds: string[]
}

type TagFilter =
  | { type: 'assert-claim' }
  | { type: 'domain'; domainId: string }

class InboxProcessor {
  private timeout: ReturnType<typeof setTimeout> | null = null
  private running = false
  private intervalMs = 5000
  private batchLimit = 50
  private staleAfterMs = 30_000
  private similarityThreshold = 0

  constructor(
    private store: GraphStore,
    private domainRegistry: DomainRegistry,
    private events: EventEmitter,
    private contextFactory: (domainId: string, requestContext?: Record<string, unknown>) => DomainContext
  ) {}

  // --- Stale Batch Recovery ---

  private async recoverStaleBatches(): Promise<void> {
    const cutoff = Date.now() - this.staleAfterMs
    await this.store.query(
      `DELETE tagged WHERE
        out.label IS NOT NONE
        AND string::starts_with(out.label, 'inbox:processing:')
        AND out.created_at < $cutoff`,
      { cutoff }
    )
  }

  // --- Candidate Fetching ---

  /**
   * Fetches candidate memory IDs matching the tag filter, excluding any
   * that are currently tagged with inbox:processing:*.
   * Returns IDs in created_at ASC order.
   */
  private async fetchCandidateIds(filter: TagFilter): Promise<string[]> {
    let query: string

    if (filter.type === 'assert-claim') {
      // Find memories that have at least one inbox:assert-claim:* tag
      query = `SELECT in FROM tagged
        WHERE out.label IS NOT NONE
          AND string::starts_with(out.label, 'inbox:assert-claim:')`
    } else {
      // Find memories with the specific domain inbox tag
      query = `SELECT in FROM tagged
        WHERE out = $domainTag`
    }

    const vars: Record<string, unknown> = {}
    if (filter.type === 'domain') {
      vars.domainTag = new StringRecordId(`tag:\`inbox:${filter.domainId}\``)
    }

    const candidates = await this.store.query<Array<{ in: RecordIdLike | string }>>(query, vars)
    if (!candidates || candidates.length === 0) return []

    const memIds = [...new Set(candidates.map(r => String(r.in)))]

    // Exclude any currently tagged as processing
    const processing = await this.store.query<Array<{ in: RecordIdLike | string }>>(
      `SELECT in FROM tagged
       WHERE out.label IS NOT NONE
         AND string::starts_with(out.label, 'inbox:processing:')`
    )
    const processingIds = new Set((processing ?? []).map(r => String(r.in)))

    return memIds.filter(id => !processingIds.has(id))
  }

  /**
   * Fetch full memory rows for a set of IDs, preserving order.
   */
  private async fetchMemoryRows(ids: string[]): Promise<RawMemoryRow[]> {
    if (ids.length === 0) return []

    const rows: RawMemoryRow[] = []
    for (const id of ids) {
      const node = await this.store.getNode<Node & RawMemoryRow>(id)
      if (node) {
        rows.push({
          id: node.id,
          content: node.content,
          embedding: node.embedding,
          event_time: node.event_time,
          created_at: node.created_at,
          token_count: node.token_count,
        })
      }
    }
    return rows
  }

  // --- Similarity Batch Building ---

  private async buildSimilarityBatch(
    filter: TagFilter,
    domainId?: string,
  ): Promise<SimilarityBatch | null> {
    // 1. Get candidate IDs (filtered)
    const candidateIds = await this.fetchCandidateIds(filter)
    if (candidateIds.length === 0) return null

    // 2. Fetch all candidate rows and sort by created_at (oldest first)
    const candidateRows = await this.fetchMemoryRows(candidateIds)
    if (candidateRows.length === 0) return null
    candidateRows.sort((a, b) => a.created_at - b.created_at)

    // 3. Pick centroid (oldest)
    const seed = candidateRows[0]
    const seedId = String(seed.id)

    // 4. Find neighbors
    let batchIds: string[]

    if (seed.embedding && candidateRows.length > 1) {
      // Use similarity-based ordering
      const neighborIds = candidateRows.slice(1).map(r => String(r.id))
      batchIds = await this.findSimilarNeighbors(seed, neighborIds)
      batchIds = [seedId, ...batchIds]
    } else {
      // No embedding or single candidate: chronological
      batchIds = candidateRows.slice(0, this.batchLimit).map(r => String(r.id))
    }

    // 4. Tag as processing
    const batchId = await this.tagBatchAsProcessing(batchIds)

    // 5. Build OwnedMemory entries
    const entries = await this.buildOwnedMemoryEntries(batchIds, domainId)

    return { batchId, entries, memoryIds: batchIds }
  }

  private async findSimilarNeighbors(
    seed: RawMemoryRow,
    candidateIds: string[],
  ): Promise<string[]> {
    if (candidateIds.length === 0 || !seed.embedding) return []

    // Fetch in batches to avoid huge queries, but use SurrealDB for similarity
    const seedId = String(seed.id)
    const limit = this.batchLimit - 1 // seed already takes one slot

    // Query neighbors by similarity from the candidate set
    const idRefs = candidateIds.map(id => new StringRecordId(id))

    let query: string
    const vars: Record<string, unknown> = {
      seedEmbedding: seed.embedding,
      seedId: new StringRecordId(seedId),
      candidateIds: idRefs,
      limit,
    }

    if (this.similarityThreshold > 0) {
      query = `SELECT id, vector::similarity::cosine(embedding, $seedEmbedding) AS similarity
        FROM memory
        WHERE id IN $candidateIds
          AND id != $seedId
          AND embedding IS NOT NONE
          AND vector::similarity::cosine(embedding, $seedEmbedding) >= $threshold
        ORDER BY similarity DESC
        LIMIT $limit`
      vars.threshold = this.similarityThreshold
    } else {
      query = `SELECT id, vector::similarity::cosine(embedding, $seedEmbedding) AS similarity
        FROM memory
        WHERE id IN $candidateIds
          AND id != $seedId
          AND embedding IS NOT NONE
        ORDER BY similarity DESC
        LIMIT $limit`
    }

    const rows = await this.store.query<Array<{ id: RecordIdLike | string }>>(query, vars)
    if (!rows || rows.length === 0) {
      // Fallback: return candidates without embedding in chronological order
      return candidateIds.slice(0, limit)
    }

    const similarIds = rows.map(r => String(r.id))

    // Also include candidates without embeddings (chronological, appended)
    const similarSet = new Set(similarIds)
    const remaining = candidateIds.filter(id => !similarSet.has(id) && id !== seedId)

    // Fill up to limit
    const spotsLeft = limit - similarIds.length
    if (spotsLeft > 0) {
      similarIds.push(...remaining.slice(0, spotsLeft))
    }

    return similarIds
  }

  private async tagBatchAsProcessing(memoryIds: string[]): Promise<string> {
    const batchId = crypto.randomUUID()
    const tagId = `tag:\`inbox:processing:${batchId}\``
    const now = Date.now()

    await this.store.createNodeWithId(tagId, {
      label: `inbox:processing:${batchId}`,
      created_at: now,
    })

    for (const memId of memoryIds) {
      await this.store.relate(memId, 'tagged', tagId)
    }

    return batchId
  }

  private async removeBatchProcessingTag(batchId: string): Promise<void> {
    const tagId = `tag:\`inbox:processing:${batchId}\``
    await this.store.query(
      `DELETE tagged WHERE out = $tagId`,
      { tagId: new StringRecordId(tagId) }
    )
    try {
      await this.store.deleteNode(tagId)
    } catch { /* best-effort */ }
  }

  private toMemoryEntry(raw: RawMemoryRow): MemoryEntry {
    return {
      id: String(raw.id),
      content: raw.content,
      eventTime: raw.event_time,
      createdAt: raw.created_at,
      tokenCount: raw.token_count,
    }
  }

  private async buildOwnedMemoryEntries(
    memoryIds: string[],
    domainId?: string,
  ): Promise<OwnedMemory[]> {
    const entries: OwnedMemory[] = []

    for (const memId of memoryIds) {
      const node = await this.store.getNode<Node & RawMemoryRow>(memId)
      if (!node) continue

      const memory = this.toMemoryEntry({
        id: node.id,
        content: node.content,
        event_time: node.event_time,
        created_at: node.created_at,
        token_count: node.token_count,
      })

      // Get non-inbox tags
      const allTags = await this.store.query<string[]>(
        `SELECT VALUE out.label FROM tagged WHERE in = $memId`,
        { memId: new StringRecordId(memId) }
      )
      const tags = (allTags ?? [])
        .filter((label): label is string => typeof label === 'string')
        .filter(l => !l.startsWith('inbox'))

      // Get domain attributes if domainId provided
      let domainAttributes: Record<string, unknown> = {}
      if (domainId) {
        const ownedByEdges = await this.store.query<RawOwnedByEdge[]>(
          'SELECT attributes, owned_at FROM owned_by WHERE in = $memId AND out = $domainId',
          {
            memId: new StringRecordId(memId),
            domainId: new StringRecordId(`domain:${domainId}`),
          }
        )
        domainAttributes = ownedByEdges?.[0]?.attributes ?? {}
      }

      entries.push({ memory, domainAttributes, tags })
    }

    return entries
  }

  // --- Phase 1: Claim Assertion ---

  private async processAssertionBatch(): Promise<number> {
    const batch = await this.buildSimilarityBatch({ type: 'assert-claim' })
    if (!batch) return 0

    const { batchId, entries, memoryIds } = batch

    try {
      // Collect assert-claim tags for each memory to know which domains to call
      const memoryDomainMap = new Map<string, string[]>()
      const allDomainIds = new Set<string>()

      for (const memId of memoryIds) {
        const assertTags = await this.store.query<string[]>(
          `SELECT VALUE out.label FROM tagged
           WHERE in = $memId AND out.label IS NOT NONE AND string::starts_with(out.label, 'inbox:assert-claim:')`,
          { memId: new StringRecordId(memId) }
        )
        const domainIds = (assertTags ?? []).map(label => label.slice('inbox:assert-claim:'.length))
        memoryDomainMap.set(memId, domainIds)
        for (const d of domainIds) allDomainIds.add(d)
      }

      // Call each domain's assertInboxClaimBatch
      for (const domainId of allDomainIds) {
        const domain = this.domainRegistry.get(domainId)
        if (!domain?.assertInboxClaimBatch) continue

        // Filter entries to only those that have this domain's assert-claim tag
        const domainEntries = entries.filter(e =>
          memoryDomainMap.get(e.memory.id)?.includes(domainId)
        )
        if (domainEntries.length === 0) continue

        const ctx = this.contextFactory(domainId)
        try {
          const claimedIds = await domain.assertInboxClaimBatch(domainEntries, ctx)

          for (const memId of claimedIds) {
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
        } catch (err) {
          this.events.emit('error', {
            source: 'inbox-assertion',
            domainId,
            error: err,
          })
        }
      }

      // Remove all assert-claim tags from batch members
      for (const memId of memoryIds) {
        const domainIds = memoryDomainMap.get(memId) ?? []
        for (const domainId of domainIds) {
          const tagId = `tag:\`inbox:assert-claim:${domainId}\``
          await this.store.unrelate(memId, 'tagged', tagId)
        }
      }

      // Clean up unclaimed memories
      for (const memId of memoryIds) {
        const owners = await this.store.query<{ count: number }[]>(
          'SELECT count() AS count FROM owned_by WHERE in = $memId GROUP ALL',
          { memId: new StringRecordId(memId) }
        )
        const ownerCount = (owners && owners.length > 0) ? owners[0].count : 0

        if (ownerCount === 0) {
          await this.removeOrphanedMemory(memId)
        }

        this.events.emit('inboxClaimAsserted', {
          memoryId: memId,
          claimed: ownerCount > 0,
        })
      }
    } finally {
      await this.removeBatchProcessingTag(batchId)
    }

    return memoryIds.length
  }

  // --- Phase 2: Inbox Processing ---

  private async processInboxBatch(): Promise<number> {
    // Find distinct domain IDs with pending inbox items
    const taggedRows = await this.store.query<RawTaggedRow[]>(
      `SELECT in, out.label AS label FROM tagged
       WHERE out.label IS NOT NONE
         AND string::starts_with(out.label, 'inbox:')
         AND !string::starts_with(out.label, 'inbox:assert-claim:')
         AND !string::starts_with(out.label, 'inbox:processing:')
       LIMIT $limit`,
      { limit: this.batchLimit * 10 }
    )

    if (!taggedRows || taggedRows.length === 0) return 0

    // Collect distinct domain IDs
    const domainIds = new Set<string>()
    for (const row of taggedRows) {
      domainIds.add(row.label.slice('inbox:'.length))
    }

    let totalProcessed = 0

    for (const domainId of domainIds) {
      const domain = this.domainRegistry.get(domainId)
      if (!domain) continue

      const batch = await this.buildSimilarityBatch({ type: 'domain', domainId }, domainId)
      if (!batch) continue

      const { batchId, entries, memoryIds } = batch

      try {
        const ctx = this.contextFactory(domainId)
        try {
          await domain.processInboxBatch(entries, ctx)
        } catch (err) {
          this.events.emit('error', {
            source: 'inbox',
            domainId,
            error: err,
          })
        }

        // Remove this domain's inbox tag from all batch members
        const inboxTagId = `tag:\`inbox:${domainId}\``
        for (const memId of memoryIds) {
          await this.store.unrelate(memId, 'tagged', inboxTagId)
          this.events.emit('inboxDomainProcessed', { memoryId: memId, domainId })
        }

        // Check if any inbox: tags remain for each memory
        for (const memId of memoryIds) {
          const remainingInbox = await this.store.query<{ count: number }[]>(
            `SELECT count() AS count FROM tagged
             WHERE in = $memId
               AND out.label IS NOT NONE
               AND string::starts_with(out.label, 'inbox:')
               AND !string::starts_with(out.label, 'inbox:processing:')
             GROUP ALL`,
            { memId: new StringRecordId(memId) }
          )
          const remaining = (remainingInbox && remainingInbox.length > 0) ? remainingInbox[0].count : 0

          if (remaining === 0) {
            await this.store.unrelate(memId, 'tagged', 'tag:inbox')
            this.events.emit('inboxProcessed', { memoryId: memId })
          }
        }

        totalProcessed += memoryIds.length
      } finally {
        await this.removeBatchProcessingTag(batchId)
      }
    }

    return totalProcessed
  }

  // --- Cleanup ---

  private async removeOrphanedMemory(memId: string): Promise<void> {
    await this.store.query(
      'DELETE tagged WHERE in = $memId',
      { memId: new StringRecordId(memId) }
    )
    await this.store.deleteNode(memId)
    this.events.emit('deleted', { memoryId: memId, reason: 'unclaimed' })
  }

  // --- Tick & Lifecycle ---

  async tick(): Promise<boolean> {
    try {
      const acquired = await this.acquireLock()
      if (!acquired) return false

      try {
        await this.recoverStaleBatches()
        const asserted = await this.processAssertionBatch()
        const processed = await this.processInboxBatch()
        return asserted > 0 || processed > 0
      } catch (err) {
        this.events.emit('error', { source: 'inbox', error: err })
        return false
      }
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
    if (options?.similarityThreshold != null) this.similarityThreshold = options.similarityThreshold
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
export type { InboxProcessorOptions }

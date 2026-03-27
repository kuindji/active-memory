// --- Core entity types ---

export interface MemoryEntry {
  id: string
  content: string
  embedding?: number[]
  eventTime: number | null
  createdAt: number
  tokenCount: number
}

export interface Tag {
  id: string
  label: string
  createdAt: number
}

export interface MemoryOwnership {
  memoryId: string
  flowId: string
  attributes: Record<string, unknown>
  ownedAt: number
}

export type ReferenceType = 'reinforces' | 'contradicts' | 'summarizes' | 'refines'

export interface Reference {
  targetId: string
  type: ReferenceType
}

// --- Graph types ---

export interface Node {
  id: string
  [key: string]: unknown
}

export interface Edge {
  id: string
  in: string
  out: string
  [key: string]: unknown
}

export interface GraphApi {
  createNode(type: string, data: Record<string, unknown>): Promise<string>
  createNodeWithId(id: string, data: Record<string, unknown>): Promise<string>
  getNode<T extends Node = Node>(id: string): Promise<T | null>
  updateNode(id: string, data: Record<string, unknown>): Promise<void>
  deleteNode(id: string): Promise<boolean>
  relate(from: string, edge: string, to: string, data?: Record<string, unknown>): Promise<string>
  unrelate(from: string, edge: string, to: string): Promise<boolean>
  traverse<T = Node>(from: string, pattern: string): Promise<T[]>
  query<T = unknown>(surql: string, vars?: Record<string, unknown>): Promise<T>
  transaction<T>(fn: (tx: GraphApi) => Promise<T>): Promise<T>
}

// --- Schema types ---

export interface FieldDef {
  name: string
  type: string
  required?: boolean
  default?: unknown
  computed?: string
}

export interface IndexDef {
  name: string
  fields: string[]
  type?: 'unique' | 'search' | 'hnsw'
  config?: Record<string, unknown>
}

export interface NodeDef {
  name: string
  fields: FieldDef[]
  indexes?: IndexDef[]
  schemafull?: boolean
}

export interface EdgeDef {
  name: string
  from: string | string[]
  to: string | string[]
  fields?: FieldDef[]
}

export interface FlowSchema {
  nodes: NodeDef[]
  edges: EdgeDef[]
}

export interface SharedSchema {
  nodes: NodeDef[]
  edges: EdgeDef[]
}

// --- Search types ---

export interface SearchQuery {
  text?: string
  mode?: 'vector' | 'fulltext' | 'hybrid' | 'graph'
  traversal?: {
    from: string | string[]
    pattern: string
    depth?: number
  }
  tags?: string[]
  flowIds?: string[]
  attributes?: Record<string, unknown>
  since?: number
  limit?: number
  tokenBudget?: number
  minScore?: number
  weights?: {
    vector?: number
    fulltext?: number
    graph?: number
  }
}

export interface SearchResult {
  entries: ScoredMemory[]
  totalTokens: number
  mode: string
  stats?: {
    vectorCandidates?: number
    fulltextCandidates?: number
    graphCandidates?: number
    mergedTotal: number
  }
}

export interface ScoredMemory {
  id: string
  content: string
  score: number
  scores: {
    vector?: number
    fulltext?: number
    graph?: number
  }
  tags: string[]
  flowAttributes: Record<string, Record<string, unknown>>
  eventTime: number | null
  createdAt: number
  connections?: {
    references?: { id: string; type: string }[]
  }
}

// --- Flow types ---

export interface OwnedMemory {
  memory: MemoryEntry
  flowAttributes: Record<string, unknown>
  tags: string[]
}

export interface FlowContext {
  flowId: string
  graph: GraphApi
  llm: LLMAdapter
  getMemory(id: string): Promise<MemoryEntry | null>
  getMemories(ids: string[]): Promise<MemoryEntry[]>
  getMemoriesByFlow(flowId: string): Promise<string[]>
  getMemoriesSince(flowId: string, since: number): Promise<string[]>
  addTag(path: string): Promise<void>
  tagMemory(memoryId: string, tagId: string): Promise<void>
  untagMemory(memoryId: string, tagId: string): Promise<void>
  getTagDescendants(tagPath: string): Promise<string[]>
  addOwnership(memoryId: string, flowId: string, attributes?: Record<string, unknown>): Promise<void>
  releaseOwnership(memoryId: string, flowId: string): Promise<void>
  updateAttributes(memoryId: string, attributes: Record<string, unknown>): Promise<void>
  search(query: Omit<SearchQuery, 'flowIds'>): Promise<SearchResult>
  getMeta(key: string): Promise<string | null>
  setMeta(key: string, value: string): Promise<void>
}

export interface FlowSchedule {
  id: string
  name: string
  intervalMs: number
  run: (context: FlowContext) => Promise<void>
}

export interface FlowConfig {
  id: string
  name: string
  schema?: FlowSchema
  processInboxItem(entry: OwnedMemory, context: FlowContext): Promise<void>
  search?: {
    rank?(query: SearchQuery, candidates: ScoredMemory[]): ScoredMemory[]
    expand?(query: SearchQuery, context: FlowContext): Promise<SearchQuery>
  }
  buildContext?(text: string, budgetTokens: number, context: FlowContext): Promise<ContextResult>
  describe?(): string
  schedules?: FlowSchedule[]
}

// --- Ingestion types ---

export interface IngestOptions {
  flowIds?: string[]
  eventTime?: number
  tags?: string[]
  metadata?: Record<string, unknown>
  skipDedup?: boolean
}

export interface IngestResult {
  action: 'stored' | 'reinforced' | 'skipped'
  id?: string
  existingId?: string
}

export interface RepetitionConfig {
  duplicateThreshold: number
  reinforceThreshold: number
}

// --- Context building types ---

export interface ContextOptions {
  flowIds?: string[]
  budgetTokens?: number
  maxMemories?: number
}

export interface ContextResult {
  context: string
  memories: ScoredMemory[]
  totalTokens: number
}

// --- Ask types ---

export interface AskOptions {
  flowIds?: string[]
  tags?: string[]
  budgetTokens?: number
  limit?: number
}

export interface AskResult {
  answer: string
  memories: ScoredMemory[]
  rounds: number
}

// --- Adapter types ---

export interface LLMAdapter {
  extract(text: string, prompt?: string): Promise<string[]>
  extractStructured?(text: string, schema: string, prompt?: string): Promise<unknown[]>
  consolidate(memories: string[]): Promise<string>
  assess?(content: string, existingContext: string[]): Promise<number>
  rerank?(query: string, candidates: { id: string; content: string }[]): Promise<string[]>
  synthesize?(query: string, memories: ScoredMemory[], tagContext?: string[]): Promise<string>
  generate?(prompt: string): Promise<string>
}

// --- Config types ---

export interface EngineConfig {
  connection: string
  namespace?: string
  database?: string
  credentials?: { user: string; pass: string }
  llm: LLMAdapter
  embeddingModel?: {
    path: string
    name: string
    dimension: number
  }
  repetition?: RepetitionConfig
  sharedSchemas?: SharedSchema[]
  search?: {
    defaultMode?: 'vector' | 'fulltext' | 'hybrid'
    defaultWeights?: { vector?: number; fulltext?: number; graph?: number }
    defaultEf?: number
  }
}

// --- Event types ---

export type MemoryEventName =
  | 'ingested'
  | 'deleted'
  | 'reinforced'
  | 'tagAssigned'
  | 'tagRemoved'
  | 'ownershipAdded'
  | 'ownershipRemoved'
  | 'inboxProcessed'
  | 'scheduleRun'
  | 'error'
  | 'warning'

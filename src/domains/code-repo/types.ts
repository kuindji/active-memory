export type MemoryClassification = 'decision' | 'rationale' | 'clarification' | 'direction' | 'observation' | 'question'

export type Audience = 'technical' | 'business'

export type ModuleKind = 'package' | 'service' | 'lambda' | 'subsystem' | 'library'

export interface CodeRepoAttributes {
  classification: MemoryClassification
  audience: Audience[]
  superseded: boolean
}

export interface CodeRepoDomainOptions {
  projectRoot?: string
  commitScanner?: {
    enabled?: boolean
    intervalMs?: number
  }
  driftDetector?: {
    enabled?: boolean
    intervalMs?: number
  }
}

export const CODE_REPO_DOMAIN_ID = 'code-repo'
export const CODE_REPO_TAG = 'code-repo'
export const CODE_REPO_TECHNICAL_TAG = 'code-repo/technical'
export const CODE_REPO_BUSINESS_TAG = 'code-repo/business'
export const CODE_REPO_DECISION_TAG = 'code-repo/decision'
export const CODE_REPO_RATIONALE_TAG = 'code-repo/rationale'
export const CODE_REPO_CLARIFICATION_TAG = 'code-repo/clarification'
export const CODE_REPO_DIRECTION_TAG = 'code-repo/direction'
export const CODE_REPO_OBSERVATION_TAG = 'code-repo/observation'
export const CODE_REPO_QUESTION_TAG = 'code-repo/question'

export const DEFAULT_SCAN_INTERVAL_MS = 3_600_000 // 1 hour
export const DEFAULT_DRIFT_INTERVAL_MS = 86_400_000 // 24 hours

export const CLASSIFICATION_TAGS: Record<MemoryClassification, string> = {
  decision: CODE_REPO_DECISION_TAG,
  rationale: CODE_REPO_RATIONALE_TAG,
  clarification: CODE_REPO_CLARIFICATION_TAG,
  direction: CODE_REPO_DIRECTION_TAG,
  observation: CODE_REPO_OBSERVATION_TAG,
  question: CODE_REPO_QUESTION_TAG,
}

export const AUDIENCE_TAGS: Record<Audience, string> = {
  technical: CODE_REPO_TECHNICAL_TAG,
  business: CODE_REPO_BUSINESS_TAG,
}

// --- Bootstrap types ---

export interface DirEntry {
  name: string
  relativePath: string
  isDirectory: boolean
  children?: DirEntry[]
  files?: string[]
}

export interface TriageResult {
  repoSize?: string
  filesToRead?: string[]
}

export interface AnalysisModule {
  name: string
  path: string
  kind: string
  description?: string
}

export interface AnalysisRelationship {
  from: string
  to: string
  type: string
  description?: string
}

export interface AnalysisResult {
  modules?: AnalysisModule[]
  data_entities?: Array<{ name: string; source?: string }>
  concepts?: Array<{ name: string; description?: string }>
  patterns?: Array<{ name: string; scope?: string }>
  relationships?: AnalysisRelationship[]
}

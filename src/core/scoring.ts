import { encodingForModel } from 'js-tiktoken'

let encoder: ReturnType<typeof encodingForModel> | null = null

function getEncoder() {
  if (!encoder) {
    encoder = encodingForModel('gpt-4o')
  }
  return encoder
}

export function countTokens(text: string): number {
  return getEncoder().encode(text).length
}

export function mergeScores(
  scores: { vector?: number; fulltext?: number; graph?: number },
  weights: { vector: number; fulltext: number; graph: number }
): number {
  let total = 0
  let weightSum = 0

  if (scores.vector !== undefined) {
    total += scores.vector * weights.vector
    weightSum += weights.vector
  }
  if (scores.fulltext !== undefined) {
    total += scores.fulltext * weights.fulltext
    weightSum += weights.fulltext
  }
  if (scores.graph !== undefined) {
    total += scores.graph * weights.graph
    weightSum += weights.graph
  }

  return weightSum > 0 ? total / weightSum : 0
}

export function computeDecay(weight: number, timestamp: number, now: number, lambda: number): number {
  if (weight === 0) return 0
  const hours = (now - timestamp) / (3600 * 1000)
  return weight * Math.exp(-lambda * hours)
}

export function applyTokenBudget<T extends { tokenCount?: number; content?: string }>(
  entries: T[],
  budget: number
): T[] {
  const result: T[] = []
  let usedTokens = 0

  for (const entry of entries) {
    const tokens = entry.tokenCount ?? (entry.content ? countTokens(entry.content) : 0)
    if (usedTokens + tokens > budget) break
    result.push(entry)
    usedTokens += tokens
  }

  return result
}

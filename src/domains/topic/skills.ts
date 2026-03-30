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

import type { DomainSkill } from '../../core/types.ts'

const chatIngest: DomainSkill = {
  id: 'chat-ingest',
  name: 'How to feed messages into the chat domain',
  description: 'Tells external agents how to ingest user and assistant messages, including required request context (userId, chatSessionId) and message format',
  scope: 'external',
}

const chatQuery: DomainSkill = {
  id: 'chat-query',
  name: 'How to retrieve conversational memory',
  description: 'Tells external agents how to use buildContext for assembling tiered conversation history with depth-based budget allocation',
  scope: 'external',
}

const chatProcessing: DomainSkill = {
  id: 'chat-processing',
  name: 'Internal chat processing schedules',
  description: 'Documents the promotion, consolidation, and pruning schedules that manage the working → episodic → semantic lifecycle',
  scope: 'internal',
}

export const chatSkills: DomainSkill[] = [chatIngest, chatQuery, chatProcessing]

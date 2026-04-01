import type { DomainSkill } from '../../core/types.ts'

const chatIngest: DomainSkill = {
  id: 'chat-ingest',
  name: 'How to feed messages into the chat domain',
  description: 'Tells external agents how to ingest user and assistant messages, including required request context (userId, chatSessionId) and message format',
  scope: 'external',
  writes: true,
}

const chatQuery: DomainSkill = {
  id: 'chat-query',
  name: 'How to retrieve conversational memory',
  description: 'Tells external agents how to use buildContext for assembling tiered conversation history with depth-based budget allocation',
  scope: 'external',
}

const chatPromoteWorkingMemory: DomainSkill = {
  id: 'chat-promote-working-memory',
  name: 'Promote working memory to episodic',
  description: 'System prompt for the LLM that extracts key facts from working memory messages during promotion to episodic memory',
  scope: 'internal',
}

const chatConsolidateEpisodic: DomainSkill = {
  id: 'chat-consolidate-episodic',
  name: 'Consolidate episodic to semantic',
  description: 'System prompt for the LLM that summarizes clusters of episodic memories into long-term semantic memories',
  scope: 'internal',
}

export const chatSkills: DomainSkill[] = [chatIngest, chatQuery, chatPromoteWorkingMemory, chatConsolidateEpisodic]

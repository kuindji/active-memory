import type { DomainSkill } from '../../core/types.ts'

const projectCapture: DomainSkill = {
  id: 'project-capture',
  name: 'How to record project knowledge',
  description: 'Tells external agents how to write curated project knowledge — decisions, rationale, clarifications, direction — with classification metadata and audience tags (technical/business)',
  scope: 'external',
  writes: true,
}

const projectQuery: DomainSkill = {
  id: 'project-query',
  name: 'How to retrieve project knowledge',
  description: 'Tells external agents how to search project knowledge by classification, audience, and entity, traverse the architecture graph, and use buildContext with audience filtering',
  scope: 'external',
}

const projectInbox: DomainSkill = {
  id: 'project-inbox',
  name: 'Inbox processing for unstructured knowledge',
  description: 'System prompt for the LLM that classifies unstructured knowledge, extracts entities, and detects contradictions during inbox processing',
  scope: 'internal',
}

export const projectSkills: DomainSkill[] = [projectCapture, projectQuery, projectInbox]

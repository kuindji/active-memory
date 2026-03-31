import type { DomainSkill } from '../../core/types.ts'

const projectCapture: DomainSkill = {
  id: 'project-capture',
  name: 'How to record project knowledge',
  description: 'Tells external agents how to write curated project knowledge — decisions, rationale, clarifications, direction — with classification metadata and audience tags (technical/business)',
  scope: 'external',
}

const projectQuery: DomainSkill = {
  id: 'project-query',
  name: 'How to retrieve project knowledge',
  description: 'Tells external agents how to search project knowledge by classification, audience, and entity, traverse the architecture graph, and use buildContext with audience filtering',
  scope: 'external',
}

const projectProcessing: DomainSkill = {
  id: 'project-processing',
  name: 'Internal project processing',
  description: 'Documents inbox processing for unstructured knowledge dumps, commit scanner schedule, and drift detector schedule',
  scope: 'internal',
}

export const projectSkills: DomainSkill[] = [projectCapture, projectQuery, projectProcessing]

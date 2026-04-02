import { MemoryEngine } from './src/core/engine.ts'
import { ClaudeCliAdapter } from './src/adapters/llm/claude-cli.ts'
import { createTopicDomain } from './src/domains/topic/index.ts'
import { createCodeRepoDomain } from './src/domains/code-repo/index.ts'

const engine = new MemoryEngine()

await engine.initialize({
  connection: `surrealkv://${import.meta.dir}/.memory-domain/db`,
  namespace: 'default',
  database: 'memory',
  llm: new ClaudeCliAdapter({
    modelLevels: {
      low: 'haiku',
      medium: 'sonnet',
      high: 'opus',
    },
  }),
})

await engine.registerDomain(createTopicDomain())
await engine.registerDomain(createCodeRepoDomain({
  projectRoot: import.meta.dir,
}))

export default engine

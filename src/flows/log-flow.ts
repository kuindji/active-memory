import type { FlowConfig, OwnedMemory, FlowContext } from '../core/types.ts'

export const logFlow: FlowConfig = {
  id: 'log',
  name: 'Log',
  async processInboxItem(_entry: OwnedMemory, _context: FlowContext): Promise<void> {
    // Log flow is a no-op processor — it just keeps the raw memories
  },
  describe() {
    return 'Built-in chronological log. Keeps all ingested memories with no processing.'
  },
}

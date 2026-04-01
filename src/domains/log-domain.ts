import type { DomainConfig, OwnedMemory, DomainContext } from '../core/types.ts'

export const logDomain: DomainConfig = {
  id: 'log',
  name: 'Log',
  settings: {
    autoOwn: true,
  },
  async processInboxItem(_entry: OwnedMemory, _context: DomainContext): Promise<void> {
    // Log domain is a no-op processor — it just keeps the raw memories
  },
  describe() {
    return 'Chronological log. Keeps all ingested memories with no processing.'
  },
}

export interface UserDomainOptions {
  consolidateSchedule?: {
    enabled?: boolean
    intervalMs?: number
  }
}

export const USER_DOMAIN_ID = 'user'
export const USER_TAG = 'user'
export const DEFAULT_CONSOLIDATE_INTERVAL_MS = 3_600_000

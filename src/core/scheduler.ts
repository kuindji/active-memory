import type { FlowSchedule, FlowContext } from './types.ts'
import type { EventEmitter } from './events.ts'

interface ScheduleEntry {
  flowId: string
  schedule: FlowSchedule
  lastRunAt: number
}

export class Scheduler {
  private entries = new Map<string, ScheduleEntry>()
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private contextFactory: (flowId: string) => FlowContext,
    private events?: EventEmitter
  ) {}

  registerSchedule(flowId: string, schedule: FlowSchedule): void {
    const key = `${flowId}:${schedule.id}`
    this.entries.set(key, { flowId, schedule, lastRunAt: 0 })
  }

  unregisterFlow(flowId: string): void {
    for (const key of this.entries.keys()) {
      if (key.startsWith(`${flowId}:`)) {
        this.entries.delete(key)
      }
    }
  }

  async tick(): Promise<void> {
    const now = Date.now()
    for (const [, entry] of this.entries) {
      const elapsed = now - entry.lastRunAt
      if (elapsed >= entry.schedule.intervalMs) {
        entry.lastRunAt = now
        try {
          const ctx = this.contextFactory(entry.flowId)
          await entry.schedule.run(ctx)
          this.events?.emit('scheduleRun', { flowId: entry.flowId, scheduleId: entry.schedule.id })
        } catch (err) {
          this.events?.emit('error', { source: 'scheduler', error: err })
        }
      }
    }
  }

  start(tickIntervalMs = 60_000): void {
    this.stop()
    this.timer = setInterval(() => this.tick(), tickIntervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  async runNow(flowId: string, scheduleId?: string): Promise<void> {
    for (const entry of this.entries.values()) {
      if (entry.flowId === flowId && (!scheduleId || entry.schedule.id === scheduleId)) {
        const ctx = this.contextFactory(entry.flowId)
        await entry.schedule.run(ctx)
      }
    }
  }
}

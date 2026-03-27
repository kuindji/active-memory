import { describe, test, expect, beforeEach } from 'bun:test'
import { Scheduler } from '../src/core/scheduler.ts'
import { EventEmitter } from '../src/core/events.ts'
import type { DomainContext, DomainSchedule } from '../src/core/types.ts'

function makeSchedule(id: string, intervalMs: number, run?: (ctx: DomainContext) => Promise<void>): DomainSchedule {
  return {
    id,
    name: id,
    intervalMs,
    run: run ?? (() => Promise.resolve()),
  }
}

function makeMockContextFactory(): (domainId: string) => DomainContext {
  return (domainId: string) => ({ domain: domainId }) as unknown as DomainContext
}

describe('Scheduler', () => {
  let events: EventEmitter
  let scheduler: Scheduler

  beforeEach(() => {
    events = new EventEmitter()
    scheduler = new Scheduler(makeMockContextFactory(), events)
  })

  describe('registerSchedule', () => {
    test('registers a schedule entry', async () => {
      let called = false
      scheduler.registerSchedule('testDomain', makeSchedule('s1', 1000, () => { called = true; return Promise.resolve() }))
      await scheduler.runNow('testDomain', 's1')
      expect(called).toBe(true)
    })

    test('registers multiple schedules for same domain', async () => {
      let count = 0
      scheduler.registerSchedule('d', makeSchedule('a', 1000, () => { count++; return Promise.resolve() }))
      scheduler.registerSchedule('d', makeSchedule('b', 1000, () => { count++; return Promise.resolve() }))
      await scheduler.runNow('d')
      expect(count).toBe(2)
    })
  })

  describe('unregisterDomain', () => {
    test('removes all schedules for a domain', async () => {
      let called = false
      scheduler.registerSchedule('remove_me', makeSchedule('s1', 1000, () => { called = true; return Promise.resolve() }))
      scheduler.unregisterDomain('remove_me')
      await scheduler.runNow('remove_me')
      expect(called).toBe(false)
    })

    test('does not affect other domains', async () => {
      let keepCalled = false
      scheduler.registerSchedule('keep', makeSchedule('s1', 1000, () => { keepCalled = true; return Promise.resolve() }))
      scheduler.registerSchedule('remove', makeSchedule('s1', 1000, () => Promise.resolve()))
      scheduler.unregisterDomain('remove')
      await scheduler.runNow('keep')
      expect(keepCalled).toBe(true)
    })
  })

  describe('tick', () => {
    test('runs schedule when interval has elapsed', async () => {
      let ran = false
      scheduler.registerSchedule('d', makeSchedule('s1', 0, () => { ran = true; return Promise.resolve() }))
      await scheduler.tick()
      expect(ran).toBe(true)
    })

    test('does not run schedule before interval elapses', async () => {
      let count = 0
      scheduler.registerSchedule('d', makeSchedule('s1', 100_000, () => { count++; return Promise.resolve() }))
      // First tick runs because lastRunAt is 0
      await scheduler.tick()
      expect(count).toBe(1)
      // Second tick should NOT run — interval hasn't passed
      await scheduler.tick()
      expect(count).toBe(1)
    })

    test('emits scheduleRun event on success', async () => {
      const emitted: unknown[] = []
      events.on('scheduleRun', (...args) => emitted.push(...args))

      scheduler.registerSchedule('d', makeSchedule('s1', 0, () => Promise.resolve()))
      await scheduler.tick()

      expect(emitted).toHaveLength(1)
      expect(emitted[0]).toEqual({ domainId: 'd', scheduleId: 's1' })
    })

    test('emits error event when schedule throws', async () => {
      const errors: unknown[] = []
      events.on('error', (...args) => errors.push(...args))

      scheduler.registerSchedule('d', makeSchedule('s1', 0, () => {
        return Promise.reject(new Error('schedule failed'))
      }))
      await scheduler.tick()

      expect(errors).toHaveLength(1)
      expect((errors[0] as { source: string }).source).toBe('scheduler')
    })

    test('passes domain context to schedule run', async () => {
      let receivedDomain: string | undefined
      const factory = (domainId: string) => {
        receivedDomain = domainId
        return { domain: domainId } as unknown as DomainContext
      }

      const s = new Scheduler(factory, events)
      s.registerSchedule('myDomain', makeSchedule('s1', 0, () => Promise.resolve()))
      await s.tick()

      expect(receivedDomain).toBe('myDomain')
    })
  })

  describe('runNow', () => {
    test('runs specific schedule by id', async () => {
      let aCalled = false
      let bCalled = false
      scheduler.registerSchedule('d', makeSchedule('a', 100_000, () => { aCalled = true; return Promise.resolve() }))
      scheduler.registerSchedule('d', makeSchedule('b', 100_000, () => { bCalled = true; return Promise.resolve() }))

      await scheduler.runNow('d', 'a')
      expect(aCalled).toBe(true)
      expect(bCalled).toBe(false)
    })

    test('runs all schedules for domain when no scheduleId given', async () => {
      let count = 0
      scheduler.registerSchedule('d', makeSchedule('a', 100_000, () => { count++; return Promise.resolve() }))
      scheduler.registerSchedule('d', makeSchedule('b', 100_000, () => { count++; return Promise.resolve() }))

      await scheduler.runNow('d')
      expect(count).toBe(2)
    })

    test('does nothing for unknown domain', async () => {
      // Should not throw
      await scheduler.runNow('nonexistent')
    })
  })

  describe('start and stop', () => {
    test('start and stop do not throw', () => {
      scheduler.registerSchedule('d', makeSchedule('s1', 60_000))
      scheduler.start(60_000)
      scheduler.stop()
    })

    test('stop is idempotent', () => {
      scheduler.stop()
      scheduler.stop()
    })

    test('start replaces previous timer', () => {
      scheduler.start(60_000)
      // Second start should not throw — replaces timer
      scheduler.start(60_000)
      scheduler.stop()
    })
  })
})

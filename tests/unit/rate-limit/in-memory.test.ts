import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest'

import { RATE_LIMITS } from '@/lib/rate-limit/config'
import {
  __resetInMemoryBucketsForTests,
  consumeInMemory,
} from '@/lib/rate-limit/in-memory'

/**
 * Agent 7 hardening — unit coverage for the in-memory rate limiter fallback.
 *
 * The in-memory limiter is dev + CI only; production is guarded by
 * `missingProductionUpstashEnv` and the module-level assertion in
 * `limiter.ts`. These assertions guarantee the fallback behavior is still
 * correct so flake-free CI runs don't mask regressions.
 */

afterEach(() => {
  __resetInMemoryBucketsForTests()
  vi.useRealTimers()
})

describe('consumeInMemory — capacity + refill', () => {
  it('allows up to capacity requests then blocks', () => {
    const { requests } = RATE_LIMITS['accept-invite']
    for (let i = 0; i < requests; i++) {
      expect(consumeInMemory('accept-invite', '1.1.1.1')).toBe(true)
    }
    expect(consumeInMemory('accept-invite', '1.1.1.1')).toBe(false)
  })

  it('isolates buckets per identifier', () => {
    const { requests } = RATE_LIMITS['accept-invite']
    for (let i = 0; i < requests; i++) {
      expect(consumeInMemory('accept-invite', '1.1.1.1')).toBe(true)
    }
    // Other IP is still at full capacity
    expect(consumeInMemory('accept-invite', '2.2.2.2')).toBe(true)
  })

  it('isolates buckets per bucket name', () => {
    const { requests: acceptRequests } = RATE_LIMITS['accept-invite']
    for (let i = 0; i < acceptRequests; i++) {
      expect(consumeInMemory('accept-invite', '1.1.1.1')).toBe(true)
    }
    // Different bucket name for the same identifier is unaffected
    expect(consumeInMemory('invite-create', '1.1.1.1')).toBe(true)
  })
})

describe('consumeInMemory — refill over time', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-23T00:00:00Z'))
  })

  it('refills a full window worth of tokens once the window elapses', () => {
    const bucket = RATE_LIMITS['accept-invite']

    // Exhaust the bucket
    for (let i = 0; i < bucket.requests; i++) {
      expect(consumeInMemory('accept-invite', '1.1.1.1')).toBe(true)
    }
    expect(consumeInMemory('accept-invite', '1.1.1.1')).toBe(false)

    // Advance time just shy of a full window — still blocked
    vi.setSystemTime(new Date(Date.now() + bucket.windowMs - 1))
    expect(consumeInMemory('accept-invite', '1.1.1.1')).toBe(false)

    // Cross the window boundary — bucket refills
    vi.setSystemTime(new Date(Date.now() + 2))
    expect(consumeInMemory('accept-invite', '1.1.1.1')).toBe(true)
  })

  it('caps refill at capacity across multiple elapsed windows', () => {
    const bucket = RATE_LIMITS['accept-invite']

    // Consume one token
    expect(consumeInMemory('accept-invite', '1.1.1.1')).toBe(true)

    // Advance 10 full windows — bucket should cap at `requests`, not grow unbounded
    vi.setSystemTime(new Date(Date.now() + bucket.windowMs * 10))
    for (let i = 0; i < bucket.requests; i++) {
      expect(consumeInMemory('accept-invite', '1.1.1.1')).toBe(true)
    }
    expect(consumeInMemory('accept-invite', '1.1.1.1')).toBe(false)
  })
})

describe('__resetInMemoryBucketsForTests', () => {
  it('clears state so successive tests start fresh', () => {
    const { requests } = RATE_LIMITS['accept-invite']
    for (let i = 0; i < requests; i++) {
      expect(consumeInMemory('accept-invite', '1.1.1.1')).toBe(true)
    }
    expect(consumeInMemory('accept-invite', '1.1.1.1')).toBe(false)

    __resetInMemoryBucketsForTests()

    expect(consumeInMemory('accept-invite', '1.1.1.1')).toBe(true)
  })
})

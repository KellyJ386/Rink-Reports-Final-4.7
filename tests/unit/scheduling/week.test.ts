import { describe, it, expect } from 'vitest'

import {
  sundayOf,
  toISODate,
  fromISODate,
  shiftWeek,
  weekFourBack,
  daysOfWeek,
} from '@/lib/scheduling/week'

/**
 * Agent 9 — unit test template.
 *
 * One representative unit test suite: pure function boundaries, no DB, no
 * network. This pattern is what future agents copy for their own domain
 * utilities (e.g. lib/communications/sanitize.ts, lib/forms/resolve-options.ts).
 */

describe('lib/scheduling/week', () => {
  describe('sundayOf', () => {
    it('returns the same Sunday when given a Sunday', () => {
      const sun = new Date(2026, 3, 19) // Sun Apr 19 2026
      expect(sundayOf(sun).getDay()).toBe(0)
      expect(toISODate(sundayOf(sun))).toBe('2026-04-19')
    })

    it('walks back to Sunday from any weekday', () => {
      for (let offset = 0; offset < 7; offset++) {
        const d = new Date(2026, 3, 19 + offset)
        const sun = sundayOf(d)
        expect(sun.getDay()).toBe(0)
        expect(toISODate(sun)).toBe('2026-04-19')
      }
    })
  })

  describe('shiftWeek', () => {
    it('adds 7-day increments in both directions', () => {
      expect(shiftWeek('2026-04-19', 1)).toBe('2026-04-26')
      expect(shiftWeek('2026-04-19', -1)).toBe('2026-04-12')
      expect(shiftWeek('2026-04-19', 0)).toBe('2026-04-19')
    })

    it('crosses month boundaries', () => {
      expect(shiftWeek('2026-04-26', 1)).toBe('2026-05-03')
    })

    it('crosses year boundaries', () => {
      expect(shiftWeek('2026-12-27', 1)).toBe('2027-01-03')
    })
  })

  describe('weekFourBack', () => {
    it('returns exactly 28 days prior (not "same calendar week of last month")', () => {
      // SCHEDULING.md locks this — deterministic, no calendar-week-of-month math
      expect(weekFourBack('2026-04-19')).toBe('2026-03-22')
      expect(weekFourBack('2026-05-03')).toBe('2026-04-05')
    })
  })

  describe('daysOfWeek', () => {
    it('returns 7 consecutive ISO dates starting at the given Sunday', () => {
      const days = daysOfWeek('2026-04-19')
      expect(days).toHaveLength(7)
      expect(days[0]).toBe('2026-04-19')
      expect(days[6]).toBe('2026-04-25')
    })
  })

  describe('round-trip', () => {
    it('fromISODate → toISODate is identity', () => {
      const samples = ['2026-01-04', '2026-04-19', '2026-12-27']
      for (const s of samples) {
        expect(toISODate(fromISODate(s))).toBe(s)
      }
    })
  })
})

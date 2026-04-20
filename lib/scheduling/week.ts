/**
 * Week boundary helpers. The system locks to Sunday as the first day of the week
 * for v1 (see SCHEDULING.md). All date arithmetic uses this assumption.
 *
 * week_start_date is stored as a PostgreSQL `date` (no TZ). The client formats
 * it as ISO 8601 `YYYY-MM-DD`.
 */

/** Format a Date as YYYY-MM-DD using local calendar components. */
export function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Parse YYYY-MM-DD into a local-midnight Date. */
export function fromISODate(s: string): Date {
  const [y, m, d] = s.split('-').map((n) => parseInt(n, 10))
  return new Date(y, m - 1, d)
}

/** Given any Date, return the Sunday that starts its week (ISO: day 0). */
export function sundayOf(d: Date): Date {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  copy.setDate(copy.getDate() - copy.getDay())
  return copy
}

/** Current week's Sunday in local time. */
export function currentWeekStart(): string {
  return toISODate(sundayOf(new Date()))
}

/** Shift a week-start date by N weeks (positive = future, negative = past). */
export function shiftWeek(weekStartISO: string, deltaWeeks: number): string {
  const d = fromISODate(weekStartISO)
  d.setDate(d.getDate() + deltaWeeks * 7)
  return toISODate(d)
}

/** Exactly 28 days before the given week start — used for copy-previous-month. */
export function weekFourBack(weekStartISO: string): string {
  return shiftWeek(weekStartISO, -4)
}

/** Seven consecutive days starting at the given Sunday. */
export function daysOfWeek(weekStartISO: string): string[] {
  const start = fromISODate(weekStartISO)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    return toISODate(d)
  })
}

/** Display helper: "Sun Apr 19, 2026" for a YYYY-MM-DD. */
export function formatWeekLabel(weekStartISO: string): string {
  const d = fromISODate(weekStartISO)
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export type PeriodType = 'day' | 'week' | 'month' | 'all'

export interface DateRange {
  start: string // ISO date, inclusive
  end: string // ISO date, inclusive
}

/**
 * Parse a bare "YYYY-MM-DD" string (every stored date in this app has no time or
 * timezone component) as a LOCAL calendar date. `new Date(isoString)` parses as UTC
 * midnight, which every subsequent getter then reinterprets in the browser's local
 * timezone -- in any timezone behind UTC that silently shifts the effective date
 * back a day, and disagrees with `new Date()` (real local "now") used everywhere
 * else. Never construct a Date from a bare ISO string directly; always go through
 * this.
 */
export function parseIsoDateLocal(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Serialize a local Date back to "YYYY-MM-DD" -- never use .toISOString() (UTC). */
export function isoDate(yearOrDate: number | Date, month?: number, day?: number): string {
  const [y, m, d] =
    yearOrDate instanceof Date
      ? [yearOrDate.getFullYear(), yearOrDate.getMonth(), yearOrDate.getDate()]
      : [yearOrDate, month!, day!]
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  d.setDate(d.getDate() - d.getDay()) // Sunday-start, matches the calendar grid
  return d
}

export function computePeriodRange(periodType: PeriodType, anchor: Date): DateRange | null {
  switch (periodType) {
    case 'all':
      return null
    case 'day': {
      const iso = isoDate(anchor)
      return { start: iso, end: iso }
    }
    case 'week': {
      const start = startOfWeek(anchor)
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)
      return { start: isoDate(start), end: isoDate(end) }
    }
    case 'month': {
      const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
      const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0) // day 0 = last day of prior month
      return { start: isoDate(start), end: isoDate(end) }
    }
  }
}

/** Step the anchor forward/back by one period. Normalizes month math so e.g. Jan 31
 * -> Feb never rolls into March (resets to day 1 of the target month first). */
export function addPeriod(periodType: PeriodType, anchor: Date, direction: 1 | -1): Date {
  switch (periodType) {
    case 'day':
      return new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + direction)
    case 'week':
      return new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 7 * direction)
    case 'month':
      return new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1)
    case 'all':
      return anchor
  }
}

export function formatPeriodLabel(periodType: PeriodType, anchor: Date): string {
  switch (periodType) {
    case 'all':
      return 'All time'
    case 'day':
      return anchor.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    case 'week': {
      const start = startOfWeek(anchor)
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)
      // Always include the month on both ends -- some ICU/Intl implementations produce
      // a garbled fallback string for { day, year } with no month specified.
      const startLabel = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      const endLabel = end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      return `${startLabel} – ${endLabel}`
    }
    case 'month':
      return anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  }
}

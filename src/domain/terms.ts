/**
 * Term arithmetic. Twenty lines of integer math instead of a date library,
 * because this domain has no clock — only an ordered sequence of {year, season}.
 *
 * Ordering within a calendar year follows the academic sequence:
 *   Spring → Summer → Fall
 * so SP 2026 < SU 2026 < FS 2026 < SP 2027.
 */
import type { Season, Term } from './types.ts'

const SEASON_INDEX: Record<Season, number> = { SP: 0, SU: 1, FS: 2 }
const SEASON_BY_INDEX: readonly Season[] = ['SP', 'SU', 'FS']

/** Total ordering over terms. Monotonic, so it doubles as a sort key. */
export function ordinal(t: Term): number {
  return t.year * 3 + SEASON_INDEX[t.season]
}

export function fromOrdinal(n: number): Term {
  const year = Math.floor(n / 3)
  // Non-null: n % 3 is always 0..2 and SEASON_BY_INDEX has exactly 3 entries.
  const season = SEASON_BY_INDEX[n % 3]!
  return { year, season }
}

/** Negative if a is earlier, positive if later, 0 if the same term. */
export function compareTerms(a: Term, b: Term): number {
  return ordinal(a) - ordinal(b)
}

export function sameTerm(a: Term, b: Term): boolean {
  return a.year === b.year && a.season === b.season
}

/**
 * The next term a student would enroll in. With `includeSummer` false — the
 * default, and what nearly every full-time student actually does — summer is
 * skipped entirely, so Spring is followed by Fall.
 */
export function nextTerm(t: Term, includeSummer = false): Term {
  if (includeSummer) return fromOrdinal(ordinal(t) + 1)
  return t.season === 'SP' ? { year: t.year, season: 'FS' } : { year: t.year + 1, season: 'SP' }
}

export function addTerms(t: Term, n: number, includeSummer = false): Term {
  if (n < 0) throw new RangeError(`addTerms expects n >= 0, got ${n}`)
  let cur = t
  for (let i = 0; i < n; i++) cur = nextTerm(cur, includeSummer)
  return cur
}

/**
 * How many enrollment terms separate `from` and `to`, counting the same way
 * `nextTerm` steps. Returns 0 when they are the same term, and never negative.
 */
export function termsBetween(from: Term, to: Term, includeSummer = false): number {
  if (compareTerms(from, to) >= 0) return 0
  let count = 0
  let cur = from
  // Bounded: the projection itself caps at 16 terms, so this can never spin.
  while (compareTerms(cur, to) < 0 && count < 64) {
    cur = nextTerm(cur, includeSummer)
    count++
  }
  return count
}

const SEASON_LABEL: Record<Season, string> = { SP: 'Spring', SU: 'Summer', FS: 'Fall' }

/** "Fall 2026" — how a term is named in a plan of study. */
export function termLabel(t: Term): string {
  return `${SEASON_LABEL[t.season]} ${t.year}`
}

/**
 * "December 2027" — the month a degree is actually conferred, which is what a
 * student means by "when do I graduate".
 *
 * VERIFY on Day 10 against the S&T academic calendar before this ships; summer
 * conferral in particular is a guess until someone reads the calendar page.
 */
const CONFERRAL_MONTH: Record<Season, string> = { SP: 'May', SU: 'August', FS: 'December' }

export function graduationLabel(t: Term): string {
  return `${CONFERRAL_MONTH[t.season]} ${t.year}`
}

/** Fall and Spring only. Summer never consumes a scholarship semester at S&T,
 *  and Pell is scheduled against the fall/spring award year. */
export function isAidCountingTerm(t: Term): boolean {
  return t.season === 'FS' || t.season === 'SP'
}

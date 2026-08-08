import { describe, expect, it } from 'vitest'
import {
  addTerms,
  compareTerms,
  graduationLabel,
  isAidCountingTerm,
  nextTerm,
  ordinal,
  sameTerm,
  termLabel,
  termsBetween,
} from '../src/domain/terms.ts'
import type { Term } from '../src/domain/types.ts'

const SP26: Term = { year: 2026, season: 'SP' }
const SU26: Term = { year: 2026, season: 'SU' }
const FS26: Term = { year: 2026, season: 'FS' }
const SP27: Term = { year: 2027, season: 'SP' }
const FS27: Term = { year: 2027, season: 'FS' }

describe('ordering', () => {
  it('orders spring before summer before fall within a year', () => {
    expect(ordinal(SP26)).toBeLessThan(ordinal(SU26))
    expect(ordinal(SU26)).toBeLessThan(ordinal(FS26))
  })

  it('orders across the year boundary', () => {
    expect(compareTerms(FS26, SP27)).toBeLessThan(0)
  })

  it('is reflexive at zero', () => {
    expect(compareTerms(SP26, { year: 2026, season: 'SP' })).toBe(0)
    expect(sameTerm(SP26, { year: 2026, season: 'SP' })).toBe(true)
  })
})

describe('nextTerm', () => {
  it('skips summer by default, which is what a full-time student does', () => {
    expect(nextTerm(SP26)).toEqual(FS26)
    expect(nextTerm(FS26)).toEqual(SP27)
  })

  it('includes summer when asked', () => {
    expect(nextTerm(SP26, true)).toEqual(SU26)
    expect(nextTerm(SU26, true)).toEqual(FS26)
    expect(nextTerm(FS26, true)).toEqual(SP27)
  })
})

describe('addTerms', () => {
  it('walks a standard academic year in two steps', () => {
    expect(addTerms(SP26, 2)).toEqual(SP27)
  })

  it('is the identity at zero', () => {
    expect(addTerms(FS26, 0)).toEqual(FS26)
  })

  it('walks three semesters into the following fall', () => {
    // SP26 -> FS26 -> SP27 -> FS27
    expect(addTerms(SP26, 3)).toEqual(FS27)
  })

  it('refuses to go backwards rather than silently guessing', () => {
    expect(() => addTerms(SP26, -1)).toThrow(RangeError)
  })
})

describe('termsBetween', () => {
  it('is the inverse of addTerms', () => {
    expect(termsBetween(SP26, addTerms(SP26, 4))).toBe(4)
  })

  it('is zero for the same term and never negative', () => {
    expect(termsBetween(FS26, FS26)).toBe(0)
    expect(termsBetween(FS27, SP26)).toBe(0)
  })

  it('counts summer only when summer is enrolled', () => {
    expect(termsBetween(SP26, FS26)).toBe(1)
    expect(termsBetween(SP26, FS26, true)).toBe(2)
  })
})

describe('labels', () => {
  it('names a term the way a plan of study does', () => {
    expect(termLabel(FS26)).toBe('Fall 2026')
  })

  it('names a graduation by the month the degree is conferred', () => {
    // "May 2027" is what a student means by "when do I graduate", not "Spring 2027".
    expect(graduationLabel(SP27)).toBe('May 2027')
    expect(graduationLabel(FS27)).toBe('December 2027')
  })
})

describe('isAidCountingTerm', () => {
  it('counts fall and spring only', () => {
    // S&T merit scholarships are 8 semesters of full-time fall/spring; summer
    // never consumes one. Pell is scheduled against the fall/spring award year.
    expect(isAidCountingTerm(FS26)).toBe(true)
    expect(isAidCountingTerm(SP26)).toBe(true)
    expect(isAidCountingTerm(SU26)).toBe(false)
  })
})

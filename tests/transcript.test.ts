import { describe, expect, it } from 'vitest'
import { makeCourse, regexExtract } from '../src/components/TranscriptEditor.tsx'

describe('derived fields follow the grade', () => {
  it('marks withdrawals and failures as attempted but not earned', () => {
    // This is the single most consequential derivation in the app: the SAP
    // maximum-timeframe denominator is ATTEMPTED hours, so a dropped course
    // still spends federal aid runway while earning nothing.
    for (const grade of ['W', 'F', 'U', 'I'] as const) {
      const c = makeCourse({ code: 'PHYSICS 1135', credits: 4, grade })
      expect(c.earned, grade).toBe(false)
      expect(c.attempted, grade).toBe(true)
    }
  })

  it('treats passing, transfer and exam credit as earned', () => {
    for (const grade of ['A', 'C-', 'D', 'S', 'TR', 'CR'] as const) {
      expect(makeCourse({ code: 'MATH 1215', grade }).earned, grade).toBe(true)
    }
  })

  it('gives ungraded passes no grade points rather than zero', () => {
    // Scoring a transfer credit as 0.0 would silently wreck a GPA.
    for (const grade of ['S', 'TR', 'CR', 'W'] as const) {
      expect(makeCourse({ code: 'ENGLISH 1120', grade }).gradePoints, grade).toBeNull()
    }
    expect(makeCourse({ code: 'ENGLISH 1120', grade: 'F' }).gradePoints).toBe(0)
  })

  it('derives the subject from the code, spaces and all', () => {
    expect(makeCourse({ code: 'COMP SCI 1570' }).subject).toBe('COMP SCI')
    expect(makeCourse({ code: 'SP&M S 1185' }).subject).toBe('SP&M S')
    expect(makeCourse({ code: 'MATH 1215' }).subject).toBe('MATH')
  })
})

describe('regex fallback', () => {
  const sample = [
    'FALL 2024                          Attempted  Earned  Grade',
    'CHEM 1305   General Chemistry I         4.0     4.0     B',
    'ENGLISH 1120 Exposition & Argumentation 3.0     3.0     A-',
    'PHYSICS 1135 Engineering Physics I      4.0     0.0     W',
    'COMP SCI 1570 Introduction To C++       3.0     3.0     B+',
    'not a course row at all',
  ].join('\n')

  it('recovers rows when the model is unavailable', () => {
    // It only has to beat typing from scratch — the editable table catches
    // whatever it gets wrong.
    const rows = regexExtract(sample)
    expect(rows.length).toBeGreaterThanOrEqual(4)
    expect(rows.map((r) => r.code)).toContain('CHEM 1305')
    expect(rows.map((r) => r.code)).toContain('COMP SCI 1570')
  })

  it('keeps the withdrawal', () => {
    const w = regexExtract(sample).find((r) => r.code === 'PHYSICS 1135')
    expect(w?.grade).toBe('W')
    expect(w?.earned).toBe(false)
    expect(w?.attempted).toBe(true)
  })

  it('flags everything it produces as needing a check', () => {
    for (const row of regexExtract(sample)) {
      expect(row.confidence).toBeLessThan(0.8)
      expect(row.source).toBe('parsed')
    }
  })

  it('returns nothing rather than guessing on prose', () => {
    expect(regexExtract('I am a junior thinking about switching majors.')).toEqual([])
  })
})

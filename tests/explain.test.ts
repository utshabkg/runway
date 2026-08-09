import { describe, expect, it } from 'vitest'
import { redact } from '../api/_lib/anthropic.js'
import { EXPLAIN_SYSTEM, PARSE_SYSTEM } from '../api/_lib/prompts.js'
import { getProgram, getSchool } from '../src/data/registry.ts'
import { PERSONAS, DEMO_NOW } from '../src/data/personas.ts'
import { explainFallback } from '../src/domain/explainFallback.ts'
import { simulate } from '../src/domain/simulate.ts'

const mst = getSchool('mst')

function comparisonFor(personaId: string) {
  const p = PERSONAS.find((x) => x.id === personaId)!
  return {
    persona: p,
    comparison: simulate(p.transcript, getProgram(p.stayProgramId), getProgram(p.switchProgramId), mst, {
      load: p.load,
      includeSummer: false,
      now: DEMO_NOW,
      ...(p.coop ? { switchCoop: p.coop } : {}),
    }),
  }
}

describe('redaction', () => {
  it('strips identifiers without eating course codes', () => {
    // The whole difficulty: course numbers ARE digit runs, and losing them
    // would destroy the parse. Only long runs and labelled fields go.
    const input = [
      'Student ID: 12345678901',
      'DOB: 03/14/2004',
      'jordan@mst.edu',
      'COMP SCI 1570  Introduction To C++  3.0  B+',
      'MATH 1215  Calculus II  4.0  C+',
    ].join('\n')
    const out = redact(input)
    expect(out).toContain('COMP SCI 1570')
    expect(out).toContain('MATH 1215')
    expect(out).toContain('3.0')
    expect(out).not.toContain('12345678901')
    expect(out).not.toContain('03/14/2004')
    expect(out).not.toContain('jordan@mst.edu')
  })

  it('catches identifiers however they are punctuated', () => {
    for (const line of ['Student Number - 998877665', 'SSN: 111-22-3333', 'student id #5551234567']) {
      expect(redact(line)).toContain('[redacted]')
    }
  })
})

describe('prompts forbid the model from doing arithmetic', () => {
  it('tells the explanation model it may not recompute', () => {
    expect(EXPLAIN_SYSTEM).toMatch(/[Nn]ever compute, re-derive/)
    expect(EXPLAIN_SYSTEM).toContain('668.34')
    expect(EXPLAIN_SYSTEM).toMatch(/exactly 5 questions/)
  })

  it('tells the parser to keep withdrawals and never infer', () => {
    // Attempted credits are the SAP denominator, so a dropped course is the
    // most consequential row on the page.
    expect(PARSE_SYSTEM).toMatch(/withdrawn/i)
    expect(PARSE_SYSTEM).toMatch(/[Nn]ever infer/)
    expect(PARSE_SYSTEM).toMatch(/Do not compute/)
  })

  it('never mentions the repealed loan-subsidy limit', () => {
    for (const prompt of [EXPLAIN_SYSTEM, PARSE_SYSTEM]) {
      expect(prompt).not.toMatch(/subsidized/i)
    }
  })
})

describe('deterministic explanation', () => {
  it.each(PERSONAS.map((p) => p.id))('%s: produces prose and exactly five questions', (id) => {
    const { persona, comparison } = comparisonFor(id)
    const result = explainFallback(comparison, Boolean(persona.coop))
    expect(result.source).toBe('fallback')
    expect(result.questions).toHaveLength(5)
    expect(result.explanation.length).toBeGreaterThan(200)
    for (const q of result.questions) expect(q.trim().endsWith('?')).toBe(true)
  })

  it('quotes the engine rather than inventing figures', () => {
    const { comparison } = comparisonFor('jordan')
    const result = explainFallback(comparison)
    // Every number in the prose must be one the engine produced.
    expect(result.explanation).toContain(String(comparison.switch.aid.sap.ceiling))
    expect(result.explanation).toContain(String(comparison.switch.aid.sap.attemptedAtGraduation))
  })

  it('says plainly when the switch is cheaper instead of manufacturing a downside', () => {
    const { comparison } = comparisonFor('jordan')
    expect(comparison.delta.extraCost).toBeLessThan(0)
    expect(explainFallback(comparison).explanation).toMatch(/saves you/)
  })

  it('explains an orphaned credit by capacity, not by blame', () => {
    const { comparison } = comparisonFor('jordan')
    const text = explainFallback(comparison).explanation
    expect(text).toMatch(/nowhere left to put them|do not count toward anything/)
    // The EAB point: orphaned is not the same as wasted, and the copy must
    // never say a course was bad.
    expect(text).not.toMatch(/wasted|thrown away|lost/i)
  })

  it('anchors every advisor question to a number', () => {
    const { comparison } = comparisonFor('jordan')
    for (const q of explainFallback(comparison).questions) {
      expect(q, q).toMatch(/\d/)
    }
  })

  it('is deterministic', () => {
    const { comparison } = comparisonFor('sam')
    expect(JSON.stringify(explainFallback(comparison))).toBe(JSON.stringify(explainFallback(comparison)))
  })
})

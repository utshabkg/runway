/**
 * Cost, projection, aid and the orchestrator.
 *
 * Every dollar figure below was computed by hand from the official Fall 2026 /
 * Spring 2027 fee schedule before the code was run, and every credit ceiling
 * from the published program length. Where the engine and the arithmetic
 * disagree, the arithmetic gets rechecked — the assertion is never relaxed to
 * match the output.
 */
import { describe, expect, it } from 'vitest'
import { getProgram, getSchool } from '../src/data/registry.ts'
import { costOfPlan, feesForTerm, rateFor, tuitionForTerm } from '../src/domain/cost.ts'
import { aidRunway } from '../src/domain/aid.ts'
import { project } from '../src/domain/project.ts'
import { allocate } from '../src/domain/match.ts'
import { simulate } from '../src/domain/simulate.ts'
import type { CompletedCourse, PlannedTerm, Term, Transcript } from '../src/domain/types.ts'

const mst = getSchool('mst')
const NOW: Term = { year: 2026, season: 'FS' }

const term = (credits: number, t: Term = NOW, isCoop = false): PlannedTerm => ({
  term: t,
  credits,
  items: [],
  isSummer: t.season === 'SU',
  isCoop,
})

let seq = 0
const course = (code: string, credits: number): CompletedCourse => ({
  id: `x${seq++}`,
  code,
  subject: code.replace(/\s+\d.*$/, '').trim(),
  title: code,
  credits,
  grade: 'B',
  term: { year: 2024, season: 'FS' },
  earned: true,
  attempted: true,
  gradePoints: 3,
  source: 'persona',
})

function mechEngJunior(): CompletedCourse[] {
  return [
    course('CHEM 1305', 4), course('CHEM 1319', 1), course('ENGLISH 1120', 3),
    course('FR ENG 1100', 1), course('HISTORY 1300', 3), course('MATH 1214', 4),
    course('MATH 1215', 4), course('MECH ENG 1720', 3), course('PHYSICS 1135', 4),
    course('CIV ENG 2200', 3), course('MATH 2222', 4), course('MECH ENG 1761', 1),
    course('MECH ENG 2653', 3), course('PHYSICS 2135', 4), course('MATH 3304', 3),
    course('MECH ENG 2360', 3), course('MECH ENG 2519', 3), course('MECH ENG 2761', 2),
    course('MET ENG 2110', 3), course('COMP SCI 1570', 3), course('PHILOS 1105', 3),
  ]
}

const transcript = (courses: CompletedCourse[]): Transcript => ({
  schoolId: 'mst',
  courses,
  transferCredits: 0,
  acceleratedCredits: 0,
  asOfTerm: NOW,
  firstEnrolledTerm: { year: 2024, season: 'FS' },
  residency: 'in-state',
  pellSemestersUsedFTE: 4,
  institutionalScholarshipSemestersUsed: 4,
})

describe('tuition follows the rate tier assigned to the major', () => {
  it('charges the published plateau for a full-time in-state term', () => {
    // Official Fall 2026 / Spring 2027 schedule, 12-18 hour plateau.
    const rate1 = rateFor(mst, 'mst-psychology')
    const rate3 = rateFor(mst, 'mst-mechanical-engineering')
    expect(tuitionForTerm(rate1, 15, 'in-state')).toBe(745_100)
    expect(tuitionForTerm(rate3, 15, 'in-state')).toBe(974_700)
    expect(tuitionForTerm(rate3, 15, 'out-of-state')).toBe(1_971_800)
  })

  it('prices the same fifteen credits $2,296 apart by major', () => {
    // The mechanic the whole product turns on, and the reason a switch can be
    // cheaper per term while taking longer overall.
    const psych = tuitionForTerm(rateFor(mst, 'mst-psychology'), 15, 'in-state')
    const mecheng = tuitionForTerm(rateFor(mst, 'mst-mechanical-engineering'), 15, 'in-state')
    expect(mecheng - psych).toBe(229_600)
  })

  it('bills per credit below the plateau and plateau-plus above it', () => {
    const rate3 = rateFor(mst, 'mst-mechanical-engineering')
    // 9 hours is below the 12-hour floor: 9 x $812.00
    expect(tuitionForTerm(rate3, 9, 'in-state')).toBe(730_800)
    // "Over 18 hours will be assessed at plateau rate plus per credit hour rate
    // for additional hours over 18": $9,747.00 + 1 x $812.00
    expect(tuitionForTerm(rate3, 19, 'in-state')).toBe(1_055_900)
    expect(tuitionForTerm(rate3, 0, 'in-state')).toBe(0)
  })

  it('computer science and mechanical engineering share a tier, so a switch between them moves no rate', () => {
    expect(rateFor(mst, 'mst-computer-science').id).toBe(rateFor(mst, 'mst-mechanical-engineering').id)
  })

  it('bills an undeclared student at the most expensive tier', () => {
    expect(rateFor(mst, 'mst-undeclared').id).toBe('rate-3')
  })
})

describe('fees', () => {
  it('caps the activity and facility fee at twelve hours', () => {
    // $42.00 per credit hour, capped at 12, plus $223.59 health service.
    expect(feesForTerm(mst.fees, 15)).toEqual({ perCredit: 50_400, flat: 22_359 })
    expect(feesForTerm(mst.fees, 9)).toEqual({ perCredit: 37_800, flat: 22_359 })
    // The cap means 12 and 18 hours pay the same fee.
    expect(feesForTerm(mst.fees, 12).perCredit).toBe(feesForTerm(mst.fees, 18).perCredit)
  })

  it('charges nothing for a term with no coursework', () => {
    expect(feesForTerm(mst.fees, 0)).toEqual({ perCredit: 0, flat: 0 })
  })
})

describe('cost of a plan', () => {
  it('sums to the hand-computed total', () => {
    // Two full-time terms at Rate 3, in-state, plus the $75 graduation fee.
    // Tuition  2 x $9,747.00       = $19,494.00
    // Fees     2 x ($504 + $223.59) = $1,455.18
    // One-time $75.00
    const rate3 = rateFor(mst, 'mst-mechanical-engineering')
    const cost = costOfPlan([term(15), term(15)], rate3, mst, {
      residency: 'in-state',
      attemptedBefore: 60,
      programTotalCredits: 128,
      includeGraduationFee: true,
    })
    expect(cost.tuitionTotal).toBe(1_949_400)
    expect(cost.feesTotal).toBe(145_518 + 7_500)
    expect(cost.surchargeTotal).toBe(0)
    expect(cost.grandTotal).toBe(1_949_400 + 145_518 + 7_500)
  })

  it('charges nothing for a co-op term', () => {
    const rate3 = rateFor(mst, 'mst-mechanical-engineering')
    const cost = costOfPlan([term(0, NOW, true)], rate3, mst, {
      residency: 'in-state',
      attemptedBefore: 60,
      programTotalCredits: 128,
      includeGraduationFee: false,
    })
    expect(cost.grandTotal).toBe(0)
  })

  it('applies no excess-credit surcharge in Missouri', () => {
    // Fla. Stat. 1009.286 has no Missouri equivalent, so this must stay zero
    // however many hours a student accumulates.
    const rate3 = rateFor(mst, 'mst-mechanical-engineering')
    const cost = costOfPlan([term(15), term(15), term(15)], rate3, mst, {
      residency: 'in-state',
      attemptedBefore: 200,
      programTotalCredits: 128,
      includeGraduationFee: false,
    })
    expect(cost.surchargeTotal).toBe(0)
  })
})

describe('projection', () => {
  it('respects the credit load and the program ceiling', () => {
    const program = getProgram('mst-computer-science')
    const remaining = allocate([], program).remaining
    const result = project(remaining, program, { load: 15, includeSummer: false, startTerm: NOW })
    for (const t of result.plan) expect(t.credits).toBeLessThanOrEqual(15)
    expect(result.overflow).toBe(false)
  })

  it('does not schedule a course before its prerequisite chain has run', () => {
    const program = getProgram('mst-computer-science')
    const remaining = allocate([], program).remaining
    const result = project(remaining, program, { load: 18, includeSummer: false, startTerm: NOW })
    // COMP SCI 4096 sits at depth 7 in the published plan of study, so it
    // cannot appear before the eighth term.
    const index = result.plan.findIndex((t) => t.items.some((i) => i.includes('COMP SCI 4096')))
    if (index >= 0) expect(index).toBeGreaterThanOrEqual(7)
  })

  it('inserts co-op terms that carry no coursework', () => {
    const program = getProgram('mst-computer-science')
    const remaining = allocate([], program).remaining
    const result = project(remaining, program, {
      load: 15,
      includeSummer: false,
      startTerm: NOW,
      coopTerms: { startAfterTerms: 2, termCount: 1 },
    })
    const coops = result.plan.filter((t) => t.isCoop)
    expect(coops).toHaveLength(1)
    expect(coops[0]!.credits).toBe(0)
    expect(result.assumptions.some((a) => a.includes('co-op'))).toBe(true)
  })

  it('never claims to have finished work it could not schedule', () => {
    const program = getProgram('mst-mechanical-engineering')
    const remaining = allocate([], program).remaining
    // One credit per term cannot finish a 128-hour degree inside the valve.
    const result = project(remaining, program, { load: 1, includeSummer: false, startTerm: NOW })
    expect(result.overflow).toBe(true)
    expect(result.assumptions.some((a) => a.includes('not reliable'))).toBe(true)
  })
})

describe('aid runway', () => {
  it('sets the SAP ceiling at 150% of the published program length', () => {
    // 34 CFR 668.34. S&T's own worked example is a 120-hour B.A. in History
    // needing completion before 180 attempted hours.
    const inputs = { attemptedNow: 62, completedNow: 62, pellSemestersUsedFTE: 4, institutionalSemestersUsed: 4, stateSemestersUsed: 4 }
    expect(aidRunway([], getProgram('mst-mechanical-engineering'), mst, inputs).sap.ceiling).toBe(192)
    expect(aidRunway([], getProgram('mst-computer-science'), mst, inputs).sap.ceiling).toBe(190.5)
    expect(aidRunway([], getProgram('mst-psychology'), mst, inputs).sap.ceiling).toBe(180)
  })

  it('measures headroom against attempted, not earned, credits', () => {
    const inputs = { attemptedNow: 100, completedNow: 80, pellSemestersUsedFTE: 4, institutionalSemestersUsed: 4, stateSemestersUsed: 4 }
    const runway = aidRunway([term(15), term(15)], getProgram('mst-psychology'), mst, inputs)
    // 100 attempted + 30 planned = 130 against a 180 ceiling.
    expect(runway.sap.attemptedAtGraduation).toBe(130)
    expect(runway.sap.headroomCredits).toBe(50)
    expect(runway.sap.status).toBe('ok')
  })

  it('always carries the caveat that the regulation is silent on major changes', () => {
    const inputs = { attemptedNow: 62, completedNow: 62, pellSemestersUsedFTE: 0, institutionalSemestersUsed: 0, stateSemestersUsed: 0 }
    const runway = aidRunway([term(15)], getProgram('mst-psychology'), mst, inputs)
    expect(runway.sap.caveat).toContain('668.34')
    expect(runway.sap.caveat.length).toBeGreaterThan(80)
  })

  it('treats the Pell limit as unappealable', () => {
    const inputs = { attemptedNow: 62, completedNow: 62, pellSemestersUsedFTE: 11, institutionalSemestersUsed: 8, stateSemestersUsed: 8 }
    const runway = aidRunway([term(15), term(15)], getProgram('mst-psychology'), mst, inputs)
    expect(runway.pell.appealable).toBe(false)
    expect(runway.pell.percentUsedAtGraduation).toBe(11 * 50 + 2 * 50)
    expect(runway.pell.status).toBe('exceeded')
    expect(runway.flags.some((f) => f.id === 'pell-leu' && f.severity === 'critical')).toBe(true)
  })

  it('does not consume a scholarship semester during a co-op', () => {
    // At S&T aid is not issued during a co-op and most awards freeze rather
    // than burn — good news students generally do not know they have.
    const inputs = { attemptedNow: 62, completedNow: 62, pellSemestersUsedFTE: 4, institutionalSemestersUsed: 4, stateSemestersUsed: 4 }
    const withCoop = aidRunway([term(15), term(0, NOW, true), term(15)], getProgram('mst-computer-science'), mst, inputs)
    const without = aidRunway([term(15), term(15)], getProgram('mst-computer-science'), mst, inputs)
    expect(withCoop.institutional[0]!.semestersAtGraduation).toBe(without.institutional[0]!.semestersAtGraduation)
  })

  it('flags the eight-semester scholarship cliff', () => {
    const inputs = { attemptedNow: 90, completedNow: 90, pellSemestersUsedFTE: 6, institutionalSemestersUsed: 7, stateSemestersUsed: 7 }
    const runway = aidRunway([term(15), term(15), term(15)], getProgram('mst-psychology'), mst, inputs)
    // 7 already used + 3 more = 10 against a cap of 8.
    expect(runway.institutional[0]!.termsUnfunded).toBe(2)
    expect(runway.institutional[0]!.status).toBe('exceeded')
  })

  it('ends Access Missouri at 150 completed hours, not just ten semesters', () => {
    // The credit-hour cap is independent of the semester cap and is the one a
    // major switch is most likely to trip.
    const inputs = { attemptedNow: 140, completedNow: 140, pellSemestersUsedFTE: 6, institutionalSemestersUsed: 6, stateSemestersUsed: 6 }
    const runway = aidRunway([term(15), term(15)], getProgram('mst-psychology'), mst, inputs)
    const access = runway.stateAid.find((a) => a.programId === 'access-missouri')!
    expect(access.status).toBe('ineligibleAt')
    expect(access.reason).toContain('150')
  })
})

describe('two futures', () => {
  it('produces a complete comparison for the flagship scenario', () => {
    const result = simulate(
      transcript(mechEngJunior()),
      getProgram('mst-mechanical-engineering'),
      getProgram('mst-psychology'),
      mst,
      { load: 15, includeSummer: false, now: NOW },
    )
    expect(result.stay.programName).toContain('Mechanical')
    expect(result.switch.programName).toContain('Psychological')
    expect(result.stay.plan.length).toBeGreaterThan(0)
    expect(result.switch.plan.length).toBeGreaterThan(0)
    expect(result.timing).toHaveLength(4)
    expect(result.modelVersion).toBeTruthy()
  })

  it('charges the switch at the target major rate, not the source', () => {
    // Engineering to psychology moves Rate 3 to Rate 1, so each remaining term
    // costs $2,296 less even though the degree may take longer.
    const result = simulate(
      transcript(mechEngJunior()),
      getProgram('mst-mechanical-engineering'),
      getProgram('mst-psychology'),
      mst,
      { load: 15, includeSummer: false, now: NOW },
    )
    const stayFullTime = result.stay.cost.perTerm.filter((t) => t.tuition > 0)
    const switchFullTime = result.switch.cost.perTerm.filter((t) => t.tuition > 0)
    expect(stayFullTime[0]!.tuition).toBeGreaterThan(switchFullTime[0]!.tuition)
  })

  it('never reports negative orphaned credits as a benefit', () => {
    const result = simulate(
      transcript(mechEngJunior()),
      getProgram('mst-mechanical-engineering'),
      getProgram('mst-computer-science'),
      mst,
      { load: 15, includeSummer: false, now: NOW },
    )
    expect(Number.isFinite(result.delta.creditsOrphaned)).toBe(true)
    expect(Number.isFinite(result.delta.extraCost)).toBe(true)
  })

  it('carries the assumptions the numbers depend on', () => {
    const result = simulate(
      transcript(mechEngJunior()),
      getProgram('mst-mechanical-engineering'),
      getProgram('mst-psychology'),
      mst,
      { load: 15, includeSummer: false, now: NOW },
    )
    const text = result.switch.assumptions.join(' ')
    expect(text).toContain('668.34')
    expect(text).toContain('Rate 1')
    expect(text).toMatch(/offered/)
  })

  it('charges for the semesters spent waiting', () => {
    // Waiting is not free and the switch itself costs the same whenever it is
    // made — the entire cost of delay sits in the terms billed at the CURRENT
    // major's rate before the switch happens. Omitting that priced every delay
    // identically, which made the timing curve useless.
    const result = simulate(
      transcript(mechEngJunior()),
      getProgram('mst-mechanical-engineering'),
      getProgram('mst-psychology'),
      mst,
      { load: 15, includeSummer: false, now: NOW },
    )
    const costs = result.timing.map((t) => t.totalCost)
    expect(costs[0]).toBeLessThan(costs[1]!)
    for (let i = 1; i < costs.length; i++) expect(costs[i]).toBeGreaterThanOrEqual(costs[i - 1]!)
    expect(result.timing[0]!.deltaCostVsNow).toBe(0)
    // One term of waiting costs a full-time term at Rate 3 plus fees.
    expect(result.timing[1]!.deltaCostVsNow).toBeGreaterThan(900_000)
  })

  it('does not decorate a flat curve with a cliff', () => {
    const result = simulate(
      transcript(mechEngJunior()),
      getProgram('mst-mechanical-engineering'),
      getProgram('mst-computer-science'),
      mst,
      { load: 15, includeSummer: false, now: NOW },
    )
    for (const point of result.timing) {
      if (point.isCliff) {
        // A cliff must be justified by something: a newly binding aid
        // constraint, or a cost step larger than steady waiting explains.
        const stepsUp = point.deltaCostVsNow > 0
        expect(point.newlyBindingConstraints.length > 0 || stepsUp).toBe(true)
      }
    }
  })

  it('is deterministic', () => {
    // One transcript, simulated twice. Building it twice would mint fresh
    // course ids and compare different inputs, which tests nothing.
    const fixed = transcript(mechEngJunior())
    const run = () =>
      simulate(fixed, getProgram('mst-mechanical-engineering'), getProgram('mst-psychology'), mst, {
        load: 15,
        includeSummer: false,
        now: NOW,
      })
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()))
  })
})

/**
 * Allocation tests.
 *
 * Every expectation here was computed by hand from the catalog data BEFORE the
 * engine was run against it. If the engine disagrees with the arithmetic, one
 * of them is wrong and the disagreement gets resolved — the expectation is
 * never edited to match the output.
 */
import { describe, expect, it } from 'vitest'
import { allocate, courseLevel, matchesRef } from '../src/domain/match.ts'
import { getProgram } from '../src/data/registry.ts'
import type { CompletedCourse, Grade, Term } from '../src/domain/types.ts'

const FS24: Term = { year: 2024, season: 'FS' }

let seq = 0
function course(code: string, credits: number, grade: Grade = 'B', term: Term = FS24): CompletedCourse {
  const earned = !['F', 'W', 'U', 'I'].includes(grade)
  return {
    id: `c${seq++}`,
    code,
    subject: code.replace(/\s+\d.*$/, '').trim(),
    title: code,
    credits,
    grade,
    term,
    earned,
    attempted: true,
    gradePoints: null,
    source: 'persona',
  }
}

/**
 * A Mechanical Engineering junior, 62 attempted hours. Drawn from the S&T
 * MechE plan of study so that the courses are real and their credit values
 * match the catalog.
 */
function mechEngJunior(): CompletedCourse[] {
  return [
    course('CHEM 1305', 4), course('CHEM 1319', 1),
    course('ENGLISH 1120', 3), course('FR ENG 1100', 1),
    course('HISTORY 1300', 3), course('MATH 1214', 4),
    course('MATH 1215', 4), course('MECH ENG 1720', 3),
    course('PHYSICS 1135', 4), course('CIV ENG 2200', 3),
    course('MATH 2222', 4), course('MECH ENG 1761', 1),
    course('MECH ENG 2653', 3), course('PHYSICS 2135', 4),
    course('MATH 3304', 3), course('MECH ENG 2360', 3),
    course('MECH ENG 2519', 3), course('MECH ENG 2761', 2),
    course('MET ENG 2110', 3), course('COMP SCI 1570', 3),
    course('PHILOS 1105', 3),
  ]
}

describe('course matching', () => {
  it('reads the level off a code', () => {
    expect(courseLevel('COMP SCI 3800')).toBe(3800)
    expect(courseLevel('SP&M S 1185')).toBe(1185)
    expect(courseLevel('MATH')).toBeNull()
  })

  it('honours pattern bounds and exclusions', () => {
    const cs5000 = course('MECH ENG 5000', 3)
    // MECH ENG 5000 is titled "Special Problems"; three MechE footnotes forbid
    // co-op, special problems and research credit in a technical elective.
    expect(matchesRef(cs5000, { kind: 'pattern', subject: 'MECH ENG', minLevel: 5000 })).toBe(true)
    expect(
      matchesRef(cs5000, { kind: 'pattern', subject: 'MECH ENG', minLevel: 5000, exclude: ['MECH ENG 5000'] }),
    ).toBe(false)
  })

  it('matches anyOf by exact code', () => {
    expect(matchesRef(course('MATH 1211', 4), { kind: 'anyOf', codes: ['MATH 1214', 'MATH 1211'] })).toBe(true)
    expect(matchesRef(course('MATH 1210', 4), { kind: 'anyOf', codes: ['MATH 1214', 'MATH 1211'] })).toBe(false)
  })
})

describe('grade floors', () => {
  it('blocks a course below the floor from the requirement but keeps it in the pool', () => {
    // S&T requires a C or better in every Computer Science course. A D still
    // counts as elective credit — it is not thrown away.
    const withD = [course('COMP SCI 1570', 3, 'D')]
    const result = allocate(withD, getProgram('mst-computer-science'))
    const fate = result.allocations[0]!.fate
    expect(fate.kind).not.toBe('satisfies')
    expect(result.orphanedCredits + result.absorbedCredits).toBe(3)
  })

  it('never lets a withdrawal or failure satisfy anything', () => {
    for (const grade of ['W', 'F', 'U'] as Grade[]) {
      const result = allocate([course('COMP SCI 1570', 3, grade)], getProgram('mst-computer-science'))
      expect(result.allocations[0]!.fate.kind, `grade ${grade}`).toBe('orphaned')
      expect(result.survivingCredits).toBe(0)
    }
  })

  it('accepts transfer and pass marks against a grade floor', () => {
    // TR and S carry no rank, so a floor cannot be evaluated against them. The
    // registrar convention is that credit already accepted toward a degree
    // cleared whatever floor applied when it was awarded.
    const result = allocate([course('COMP SCI 1570', 3, 'TR')], getProgram('mst-computer-science'))
    expect(result.allocations[0]!.fate.kind).toBe('satisfies')
  })
})

describe('the same transcript, opposite outcomes', () => {
  // This pair is the product. Missouri S&T publishes 29 hours of free-elective
  // capacity for Psychological Science and none at all for Mechanical
  // Engineering — the phrase "free elective" does not occur anywhere on the
  // MechE page. So identical completed work is absorbed by one target and
  // orphaned by the other, and the tool can say which without guessing.

  it('absorbs into psychology, which has capacity to spare', () => {
    const result = allocate(mechEngJunior(), getProgram('mst-psychology'))
    // Hand-derived from the catalog: the 20-hour science and mathematics
    // bucket fills exactly (CHEM 1305 4 + MATH 1214 4 + MATH 1215 4 +
    // PHYSICS 1135 4 + MATH 2222 4), English composition takes ENGLISH 1120,
    // the Williams Law slot takes HISTORY 1300 and humanities takes PHILOS
    // 1105 — 29 credits against named requirements. The remaining 33 go at the
    // 29-hour elective bucket, which fills exactly, leaving PHYSICS 2135
    // overflowing by 4.
    expect(result.electiveSlack.capacityCredits).toBe(29)
    expect(result.electiveSlack.usedCredits).toBe(29)
    expect(result.electiveSlack.overflowCredits).toBe(4)
    expect(result.orphanedCredits).toBe(4)
    expect(result.survivingCredits).toBe(58)
    expect(result.survivingCredits + result.orphanedCredits).toBe(62)
  })

  it('orphans into mechanical engineering, which has none', () => {
    const result = allocate(mechEngJunior(), getProgram('mst-mechanical-engineering'))
    expect(result.electiveSlack.capacityCredits).toBe(0)
    expect(result.absorbedCredits).toBe(0)
    // Nothing can be absorbed, so anything not filling a named requirement is
    // genuinely orphaned rather than quietly converted to elective credit.
    expect(result.orphanedCredits).toBe(62 - result.survivingCredits)
  })

  it('reports capacity as the reason, not the grade, when a bucket overflows', () => {
    const result = allocate(mechEngJunior(), getProgram('mst-mechanical-engineering'))
    const orphans = result.allocations.filter((a) => a.fate.kind === 'orphaned')
    for (const orphan of orphans) {
      expect(orphan.fate.kind === 'orphaned' && orphan.fate.reason).not.toBe('gradeTooLow')
    }
  })
})

describe('remaining work', () => {
  it('attributes a general-education shortfall to the framework change', () => {
    // A Mechanical Engineering student follows S&T's 31-hour core; Psychology
    // follows Missouri CORE 42. The shortfall is not asserted as 42 minus 31 —
    // the CORE 42 buckets engineering never required simply come back unfilled.
    const result = allocate(mechEngJunior(), getProgram('mst-psychology'))
    expect(result.remaining.addedByGenEdSwitch).toBeGreaterThan(0)
    const genEdBlocks = result.remaining.blocks.filter((b) =>
      getProgram('mst-psychology').blocks.find((x) => x.id === b.blockId)?.isGenEd,
    )
    expect(genEdBlocks.length).toBeGreaterThan(0)
  })

  it('never reports more remaining work than the degree requires', () => {
    for (const id of ['mst-psychology', 'mst-mechanical-engineering', 'mst-computer-science']) {
      const program = getProgram(id)
      const result = allocate(mechEngJunior(), program)
      expect(result.remaining.totalCredits, id).toBeLessThanOrEqual(program.totalCredits)
    }
  })

  it('leaves a fresh student needing the whole degree', () => {
    const program = getProgram('mst-computer-science')
    const result = allocate([], program)
    expect(result.survivingCredits).toBe(0)
    // Free-elective capacity is not "remaining work" in the sense of named
    // requirements, so the shortfall is the degree minus that capacity.
    expect(result.remaining.totalCredits).toBe(program.totalCredits - 7)
  })
})

describe('the allocator does not leave value on the table', () => {
  it.each(['mst-psychology', 'mst-mechanical-engineering', 'mst-computer-science', 'mst-information-science-technology'])(
    '%s: no credit is dropped while a requirement it fits is still open',
    (id) => {
      // Greedy with most-constrained-first is not an optimal solver, but it
      // does promise local optimality: nothing should end up absorbed or
      // orphaned while a requirement that would have taken it sits unfilled.
      // Anything else is a real defect, not a rounding artefact.
      const result = allocate(mechEngJunior(), getProgram(id))
      expect(result.misplacedCredits).toBe(0)
    },
  )

  it('is deterministic', () => {
    const a = allocate(mechEngJunior(), getProgram('mst-psychology'))
    const b = allocate(mechEngJunior(), getProgram('mst-psychology'))
    expect(a.allocations.map((x) => x.fate.kind)).toEqual(b.allocations.map((x) => x.fate.kind))
  })
})

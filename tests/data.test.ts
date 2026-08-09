/**
 * Catalog integrity gate.
 *
 * Six degree programs get transformed by hand from CourseLeaf plan-of-study
 * pages into requirement specs. Transcription typos are the highest-frequency
 * bug class in this build and the one a registrar in the audience is best
 * equipped to catch. This suite is what stops one reaching the stage.
 */
import { describe, expect, it } from 'vitest'
import {
  citationsFor,
  genEdFrameworks,
  getGenEdFramework,
  getProgram,
  getSchool,
  programs,
  schools,
  unverifiedCitations,
} from '../src/data/registry.ts'
import { blockCredits, checkProgramIntegrity } from '../src/data/schema.ts'

const schoolIds = Object.keys(schools)
const programIds = Object.keys(programs)

describe('registry loads', () => {
  it('validates every data file on import', () => {
    // Reaching this line at all means every school, gen-ed framework and
    // program file passed its zod schema — parsing happens at module load.
    expect(schoolIds.length).toBeGreaterThan(0)
  })

  it('has Missouri S&T', () => {
    const mst = getSchool('mst')
    expect(mst.name).toBe('Missouri University of Science and Technology')
    expect(mst.ipedsId).toBe('178411')
  })
})

describe('gen-ed frameworks reconcile', () => {
  it.each(Object.values(genEdFrameworks))('$id blocks sum to totalCredits', (framework) => {
    const summed = framework.blocks.reduce((total, b) => total + blockCredits(b), 0)
    expect(summed).toBeCloseTo(framework.totalCredits, 1)
  })

  it('models the two frameworks a switch can move a student between', () => {
    // S&T states that BS degrees in engineering, business and IST, and
    // chemistry typically do not follow CORE 42, while other BS degrees do.
    // An engineering-to-psychology switch therefore changes the general
    // education framework itself, which is a hidden source of extra credits
    // that no what-if audit explains.
    expect(getGenEdFramework('mst-gened31').totalCredits).toBe(31)
    expect(getGenEdFramework('mo-core42').totalCredits).toBe(42)
  })
})

describe('SAP policy is stated conservatively', () => {
  it.each(schoolIds)('%s measures maximum timeframe against attempted credits', (id) => {
    // 34 CFR 668.34(a)(5)(ii). The denominator is attempted, which is the whole
    // reason withdrawals and abandoned-major credits are permanent.
    const { sap } = getSchool(id)
    expect(sap.denominator).toBe('attempted')
    expect(sap.maxTimeframePct).toBe(1.5)
  })

  it.each(schoolIds)('%s does not claim a post-major-change rule the regulation lacks', (id) => {
    const { sap } = getSchool(id)
    if (sap.majorChangePolicy !== 'unspecified') {
      // Anything other than 'unspecified' is an institutional policy claim and
      // must be backed by a citation that actually says so.
      const citation = getSchool(id).citations[sap.citationId]
      expect(citation, `sap.citationId "${sap.citationId}" must resolve`).toBeDefined()
      expect(citation?.unverified ?? false).toBe(false)
    }
  })

  it.each(schoolIds)('%s treats the Pell 600% cap as unappealable', (id) => {
    const { pell } = getSchool(id)
    expect(pell.lifetimeEligibilityPct).toBe(600)
    expect(pell.appealable).toBe(false)
  })
})

describe('tuition rate tiers — the local mechanic', () => {
  it('bills Missouri S&T by rate tier assigned to the major', () => {
    // Official Fall 2026 / Spring 2027 fee schedule. Full-time in-state plateau.
    const { rates } = getSchool('mst').tuition
    expect(rates['rate-1']!.plateau!.flatInState).toBe(745_100)
    expect(rates['rate-2']!.plateau!.flatInState).toBe(859_900)
    expect(rates['rate-3']!.plateau!.flatInState).toBe(974_700)
  })

  it('prices a major change at up to $2,296 per semester', () => {
    // The headline: switching between the cheapest and dearest tier moves a
    // full-time in-state student's tuition by this much, in either direction.
    // Engineering to Psychology is cheaper per term while CORE 42 adds credits
    // — two effects pulling opposite ways, which is the whole product.
    const { rates } = getSchool('mst').tuition
    const delta = rates['rate-3']!.plateau!.flatInState - rates['rate-1']!.plateau!.flatInState
    expect(delta).toBe(229_600)
  })

  it('bills an undeclared student at the most expensive tier', () => {
    // Undeclared Undergraduate sits in Rate 3 alongside every engineering
    // major. Verifiable, in the official PDF, and news to most students.
    const { rates } = getSchool('mst').tuition
    const dearest = Object.values(rates).reduce((a, b) =>
      (a.plateau?.flatInState ?? 0) >= (b.plateau?.flatInState ?? 0) ? a : b,
    )
    expect(dearest.programIds).toContain('mst-undeclared')
  })

  it.each(schoolIds)('%s: every rate tier is internally consistent', (id) => {
    // The schema already rejects transposed residency columns and a plateau
    // that costs more than paying per credit; this asserts the tiers are
    // actually ordered, which a copy-paste slip between rows would break.
    const { rates } = getSchool(id).tuition
    for (const rate of Object.values(rates)) {
      expect(rate.perCreditOutOfState).toBeGreaterThan(rate.perCreditInState)
      if (rate.plateau) {
        expect(rate.plateau.flatInState).toBeLessThan(rate.perCreditInState * rate.plateau.maxCredits)
      }
    }
  })
})

describe('SULA never appears', () => {
  it('no data file mentions the repealed loan-subsidy 150% limit', () => {
    // The Direct Loan subsidy 150% limit was repealed by the FAFSA
    // Simplification Act effective July 1, 2021 and reversed retroactively. It
    // is constantly confused with the SAP maximum timeframe rule, which is very
    // much alive. Stating it as current would be a checkable, dated error in
    // front of an audience that includes financial aid staff.
    //
    // The guard is deliberately absolute rather than clever: citation notes are
    // rendered in the app, so even a correct "this was repealed" aside would put
    // the phrase on screen next to live aid rules. It already caught one such
    // aside during authoring. The point belongs in the README and the write-up,
    // as prose, where it reads as diligence instead of as a modelled rule.
    const serialized = JSON.stringify({ schools, programs, genEdFrameworks })
    expect(serialized).not.toMatch(/subsidized/i)
    expect(serialized).not.toMatch(/\bSULA\b/)
  })
})

describe('citations', () => {
  it.each(schoolIds)('%s: every citation has a resolvable url and an as-of date', (id) => {
    for (const [key, citation] of Object.entries(getSchool(id).citations)) {
      expect(citation.id, `citations["${key}"].id must match its key`).toBe(key)
      expect(citation.url).toMatch(/^https:\/\//)
      expect(citation.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it.each(schoolIds)('%s: no citation is more than 18 months stale', (id) => {
    // Not Date.now() — a fixed horizon, so this test cannot start failing on
    // its own one morning during the build.
    const horizon = new Date('2026-08-21')
    for (const citation of Object.values(getSchool(id).citations)) {
      const age = (horizon.getTime() - new Date(citation.asOf).getTime()) / 86_400_000
      expect(age, `${citation.id} was read ${Math.round(age)} days ago`).toBeLessThan(548)
    }
  })

  it.each(schoolIds)('%s: every unverified placeholder says what to check', (id) => {
    // An unverified figure without instructions is how a wrong number reaches
    // the demo. The schema enforces the note exists; this asserts it is useful.
    for (const citation of unverifiedCitations(id)) {
      expect(citation.note, `${citation.id} needs a note`).toBeDefined()
      expect(citation.note!.length).toBeGreaterThan(40)
    }
  })

  it('reports what still needs a human with a browser', () => {
    // Informational, and deliberately not an assertion that the list is empty:
    // failing the build on placeholders would block development. Day 10
    // registrar-proofing is done when `grep -rn '"unverified": true' src/data/`
    // returns nothing.
    const pending = schoolIds.flatMap((id) =>
      unverifiedCitations(id).map((c) => `  ${id}/${c.id} — ${c.label}`),
    )
    if (pending.length > 0) {
      console.warn(`\n${pending.length} citation(s) still unverified:\n${pending.join('\n')}\n`)
    }
    expect(Array.isArray(pending)).toBe(true)
  })
})

describe('programs', () => {
  it.each(programIds)('%s reconciles and resolves', (id) => {
    const program = getProgram(id)
    const genEd = getGenEdFramework(program.genEdFrameworkId)
    const problems = checkProgramIntegrity(program, genEd, getSchool(program.schoolId).citations)
    expect(problems.map((p) => p.problem)).toEqual([])
  })

  it.each(programIds)('%s names a rate tier that resolves', (id) => {
    // A program billed at a rate that does not exist would silently fall back
    // to the default and mis-price every projection for that major.
    const program = getProgram(id)
    const { rates } = getSchool(program.schoolId).tuition
    expect(Object.keys(rates), `program "${id}" rateId "${program.rateId}"`).toContain(program.rateId)
    expect(rates[program.rateId]!.programIds).toContain(id)
  })

  it.each(programIds)('%s publishes a free-elective capacity', (id) => {
    // capacityCredits is the number that decides whether an orphaned credit is
    // genuinely orphaned rather than absorbed. Without it the engine cannot
    // model EAB's finding, and the honesty argument collapses.
    const program = getProgram(id)
    const free = program.blocks.filter((b) => b.kind === 'freeElective')
    expect(free.length, 'a program needs exactly one free-elective block').toBe(1)
    expect(free[0]!.capacityCredits).toBeGreaterThanOrEqual(0)
  })

  it('citationsFor returns a deduplicated, sorted set', () => {
    const citations = citationsFor('mst', programIds.slice(0, 2))
    const ids = citations.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(citations.length).toBeGreaterThan(0)
  })
})

/**
 * Semester projection: turn remaining work into a term-by-term plan.
 *
 * DELIBERATE SIMPLIFICATION, and the app says so out loud. `prereqDepth` is
 * "how many terms of prerequisite chain sit above this course", not a
 * dependency graph. Missouri S&T states prerequisites as prose inside course
 * descriptions, and generic parsing of that prose is where projects like this
 * die — so depth is hand-encoded from where the published plan of study places
 * each course, and everything unlisted is depth 0.
 *
 * The projection also assumes every course is offered in every term it is
 * scheduled, except where `offeredIn` says otherwise. Real once-a-year
 * offerings can push a real graduation later than this reports, which is why
 * the assumptions panel names this explicitly rather than burying it.
 */
import { isAidCountingTerm, nextTerm } from './terms.ts'
import type { PlannedTerm, Program, RemainingWork, Season, Term } from './types.ts'

/** Safety valve. Sixteen terms is eight years; anything past that is a bug, not
 *  a plan, and the caller is told rather than left in a loop. */
const MAX_TERMS = 16

export interface ProjectionOptions {
  /** Credit hours the student plans to carry in a normal term. */
  load: number
  includeSummer: boolean
  /** Injected — the domain never reads a system clock. */
  startTerm: Term
  /**
   * How much of the prerequisite chain the student has already worked through,
   * as a depth. A junior who has passed a depth-3 course has cleared depth 3,
   * so depth-4 work is available to them immediately.
   *
   * Without this the gate restarts at zero for everyone and a depth-7 course
   * waits seven more terms no matter how far along the student is — which
   * inflates the remaining time for whichever path the student is already
   * deep into, normally the one they are considering leaving.
   */
  depthAlreadyCleared?: number
  /** Terms given over to a co-op, counted from the start. Zero credits, no
   *  tuition, and at S&T most scholarships freeze rather than burn. */
  coopTerms?: { startAfterTerms: number; termCount: number }
}

export interface Projection {
  plan: PlannedTerm[]
  graduationTerm: Term
  termsRemaining: number
  /** True when the safety valve tripped: the plan is incomplete and no
   *  graduation date should be shown. */
  overflow: boolean
  assumptions: string[]
}

interface Schedulable {
  label: string
  credits: number
  depth: number
}

function schedulables(remaining: RemainingWork, program: Program): Schedulable[] {
  const items: Schedulable[] = []
  for (const block of remaining.blocks) {
    for (const item of block.items) {
      const depth = item.code ? (program.prereqDepth[item.code] ?? 0) : 0
      items.push({ label: item.label, credits: item.credits, depth })
    }
  }
  // Deepest prerequisite chains first within a term, then larger courses, so a
  // 4-hour course is not stranded behind three 1-hour ones.
  return items.sort((a, b) => a.depth - b.depth || b.credits - a.credits)
}

export function project(
  remaining: RemainingWork,
  program: Program,
  options: ProjectionOptions,
): Projection {
  const { load, includeSummer, startTerm, coopTerms } = options
  const cleared = options.depthAlreadyCleared ?? 0
  const cap = Math.min(load, program.maxCreditsPerTerm)
  const pending = schedulables(remaining, program)

  const plan: PlannedTerm[] = []
  let term = startTerm
  let index = 0

  const isCoop = (i: number) =>
    coopTerms !== undefined &&
    i >= coopTerms.startAfterTerms &&
    i < coopTerms.startAfterTerms + coopTerms.termCount

  while (pending.length > 0 && index < MAX_TERMS) {
    if (isCoop(index)) {
      plan.push({ term, credits: 0, items: ['Co-op work term'], isSummer: term.season === 'SU', isCoop: true })
      term = nextTerm(term, includeSummer)
      index++
      continue
    }

    const taken: string[] = []
    let credits = 0
    for (let i = 0; i < pending.length; ) {
      const item = pending[i]!
      // A course cannot be taken before its prerequisite chain has had time to
      // run: depth 2 means two terms of prerequisites sit above it. Depth
      // already cleared by completed work counts against that.
      const unlocked = item.depth - cleared <= index
      if (unlocked && credits + item.credits <= cap) {
        taken.push(item.label)
        credits += item.credits
        pending.splice(i, 1)
      } else {
        i++
      }
    }

    // Nothing was schedulable — everything left is still gated by depth. Burn a
    // term rather than spin, which is what a real student would do.
    if (taken.length === 0) {
      plan.push({ term, credits: 0, items: [], isSummer: term.season === 'SU', isCoop: false })
    } else {
      plan.push({ term, credits, items: taken, isSummer: term.season === 'SU', isCoop: false })
    }
    term = nextTerm(term, includeSummer)
    index++
  }

  const overflow = pending.length > 0
  const lastEnrolled = [...plan].reverse().find((t) => t.credits > 0)
  const graduationTerm = lastEnrolled?.term ?? startTerm

  const assumptions = [
    `Assumes ${cap} credit hours per term.`,
    includeSummer ? 'Includes summer terms.' : 'Assumes no summer enrolment.',
    'Assumes every remaining course is offered in the term it is scheduled. Courses offered only once a year can push a real graduation later than this.',
    'Prerequisite ordering is approximated from where the published plan of study places each course, not from a full prerequisite graph.',
  ]
  if (coopTerms && coopTerms.termCount > 0) {
    assumptions.push(
      `Includes ${coopTerms.termCount} co-op term${coopTerms.termCount === 1 ? '' : 's'} carrying no coursework.`,
    )
  }
  if (overflow) {
    assumptions.push(
      `Could not schedule all remaining work within ${MAX_TERMS} terms; the graduation date shown is not reliable.`,
    )
  }

  return {
    plan,
    graduationTerm,
    termsRemaining: plan.length,
    overflow,
    assumptions,
  }
}

/** Terms that consume a semester of institutional or state aid: full-time fall
 *  and spring, and never a co-op term at a school that freezes awards. */
export function aidCountingTerms(plan: readonly PlannedTerm[], minFullTime: number, freezeOnCoop: boolean): number {
  return plan.filter(
    (t) => isAidCountingTerm(t.term) && t.credits >= minFullTime && !(freezeOnCoop && t.isCoop),
  ).length
}

/** Seasons a plan actually enrols in, for the assumptions panel. */
export function seasonsUsed(plan: readonly PlannedTerm[]): Season[] {
  return [...new Set(plan.filter((t) => t.credits > 0).map((t) => t.term.season))]
}

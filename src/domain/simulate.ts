/**
 * The orchestrator: two futures, side by side.
 *
 * Pure. No IO, no globals, no clock — `now` is injected, which is why every
 * figure the app renders is reproducible from committed inputs and why a
 * provost asking "how do you know these numbers are right?" gets an answer
 * rather than a shrug.
 */
import { aidRunway } from './aid.ts'
import { costOfPlan, rateFor } from './cost.ts'
import { allocate } from './match.ts'
import { project } from './project.ts'
import { addTerms, compareTerms, termsBetween } from './terms.ts'
import type {
  Cents,
  Citation,
  Comparison,
  PathProjection,
  Program,
  School,
  SimulateOptions,
  TimingPoint,
  Transcript,
} from './types.ts'

export const MODEL_VERSION = '0.3.0'

function projectPath(
  pathId: 'stay' | 'switch',
  transcript: Transcript,
  program: Program,
  school: School,
  options: SimulateOptions,
  coopTerms?: { startAfterTerms: number; termCount: number },
): PathProjection {
  const allocation = allocate(transcript.courses, program)

  // How deep into this program's prerequisite chain the student already is.
  // A student who has passed a depth-3 course has cleared depth 3, so depth-4
  // work is open to them now rather than three terms from now.
  const depthAlreadyCleared = transcript.courses
    .filter((c) => c.earned)
    .reduce((deepest, c) => Math.max(deepest, program.prereqDepth[c.code] ?? -1), -1) + 1

  const projection = project(allocation.remaining, program, {
    load: options.load,
    includeSummer: options.includeSummer,
    startTerm: options.now,
    depthAlreadyCleared,
    ...(coopTerms ? { coopTerms } : {}),
  })

  const rate = rateFor(school, program.id)
  const attemptedNow = transcript.courses.filter((c) => c.attempted).reduce((sum, c) => sum + c.credits, 0)
  const completedNow = transcript.courses.filter((c) => c.earned).reduce((sum, c) => sum + c.credits, 0)

  const cost = costOfPlan(projection.plan, rate, school, {
    residency: transcript.residency,
    attemptedBefore: attemptedNow - transcript.acceleratedCredits,
    programTotalCredits: program.totalCredits,
    includeGraduationFee: !projection.overflow,
  })

  const aid = aidRunway(projection.plan, program, school, {
    attemptedNow,
    completedNow,
    pellSemestersUsedFTE: transcript.pellSemestersUsedFTE ?? 0,
    institutionalSemestersUsed: transcript.institutionalScholarshipSemestersUsed ?? 0,
    stateSemestersUsed: transcript.institutionalScholarshipSemestersUsed ?? 0,
  })

  return {
    pathId,
    programId: program.id,
    programName: program.name,
    allocations: allocation.allocations,
    electiveSlack: allocation.electiveSlack,
    survivingCredits: allocation.survivingCredits,
    absorbedCredits: allocation.absorbedCredits,
    orphanedCredits: allocation.orphanedCredits,
    remaining: allocation.remaining,
    plan: projection.plan,
    graduationTerm: projection.graduationTerm,
    termsRemaining: projection.termsRemaining,
    cost,
    aid,
    assumptions: [
      ...projection.assumptions,
      `Tuition billed at ${rate.label}, the rate this school assigns to ${program.name}.`,
      aid.sap.caveat,
    ],
  }
}

/**
 * Cost of switching now versus waiting. The answer is deliberately non-linear:
 * constraints bind at cliffs — a scholarship's last semester, the SAP ceiling,
 * Pell's 600% wall — not smoothly, which is precisely why a student cannot work
 * it out on their own.
 *
 * KNOWN BIAS, disclosed in the assumptions panel and worth stating plainly here
 * because it runs the wrong way. Coursework a student would complete while
 * waiting is modelled as unmatched credit, since the plan of study yields
 * labels rather than course codes. In reality some of it would satisfy the new
 * program's requirements — a semester of engineering mathematics still counts
 * toward psychology's science and mathematics bucket. So this OVERSTATES the
 * cost of waiting and therefore tilts toward "switch now", which is the one
 * direction the standing conservative invariant does not cover: it is a bias
 * toward action, not against the tool's own impressiveness.
 *
 * Read the curve as directional, not precise. Fixing it properly means carrying
 * course codes through the projection, which is the right next change here.
 */
function timingSweep(
  transcript: Transcript,
  stayProgram: Program,
  switchProgram: Program,
  school: School,
  options: SimulateOptions,
  horizon = 3,
): TimingPoint[] {
  const points: TimingPoint[] = []
  let previousConstraints = new Set<string>()
  let baseline: Cents | null = null

  for (let k = 0; k <= horizon; k++) {
    // Waiting k terms means k more terms of the CURRENT major's coursework on
    // the transcript before the switch — which is exactly what makes waiting
    // expensive, because that work is matched against the new program too.
    const stayPlan = project(allocate(transcript.courses, stayProgram).remaining, stayProgram, {
      load: options.load,
      includeSummer: options.includeSummer,
      startTerm: options.now,
    })
    const prospective = stayPlan.plan.slice(0, k).flatMap((term, i) =>
      term.items.map((label, j) => ({
        id: `prospective-${k}-${i}-${j}`,
        code: `PENDING ${1000 + i * 10 + j}`,
        subject: 'PENDING',
        title: label,
        credits: term.credits / Math.max(1, term.items.length),
        grade: 'B' as const,
        term: term.term,
        earned: true,
        attempted: true,
        gradePoints: 3,
        source: 'persona' as const,
      })),
    )

    const future: Transcript = { ...transcript, courses: [...transcript.courses, ...prospective] }
    const path = projectPath('switch', future, switchProgram, school, {
      ...options,
      now: addTerms(options.now, k, options.includeSummer),
    })

    // The terms spent waiting are not free: they are billed at the CURRENT
    // major's rate, which at S&T may be the more expensive one. Omitting this
    // was why every delay priced identically — the switch itself costs the
    // same whenever you make it, and the whole cost of waiting sits in the
    // semesters you pay for before you do.
    const waitingCost = costOfPlan(stayPlan.plan.slice(0, k), rateFor(school, stayProgram.id), school, {
      residency: transcript.residency,
      attemptedBefore: transcript.courses.reduce((sum, c) => sum + (c.attempted ? c.credits : 0), 0),
      programTotalCredits: stayProgram.totalCredits,
      includeGraduationFee: false,
    }).grandTotal

    const total = path.cost.grandTotal + waitingCost
    baseline ??= total
    const constraints = new Set(path.aid.flags.filter((f) => f.severity !== 'info').map((f) => f.id))
    const newlyBinding = [...constraints].filter((c) => !previousConstraints.has(c))
    previousConstraints = constraints

    points.push({
      switchAfterTerms: k,
      switchTerm: addTerms(options.now, k, options.includeSummer),
      graduationTerm: path.graduationTerm,
      totalCost: total,
      deltaCostVsNow: total - baseline,
      orphanedCredits: path.orphanedCredits,
      newlyBindingConstraints: newlyBinding,
      // A cliff is a step a student would actually feel: a newly binding aid
      // constraint, or a jump in cost noticeably larger than one term of
      // waiting would explain. A flat curve must not be decorated with one.
      isCliff:
        newlyBinding.length > 0 ||
        (baseline !== null && k > 0 && total - baseline > (total / k) * 1.5),
    })
  }
  return points
}

export function simulate(
  transcript: Transcript,
  stayProgram: Program,
  switchProgram: Program,
  school: School,
  options: SimulateOptions,
  citations: Citation[] = [],
): Comparison {
  const stay = projectPath('stay', transcript, stayProgram, school, options)
  const switched = projectPath('switch', transcript, switchProgram, school, options)

  return {
    stay,
    switch: switched,
    delta: {
      extraTerms: switched.termsRemaining - stay.termsRemaining,
      extraCost: switched.cost.grandTotal - stay.cost.grandTotal,
      // Genuinely orphaned only. Never the raw "does not apply" count — that
      // is the number that would make this tool wrong.
      creditsOrphaned: switched.orphanedCredits - stay.orphanedCredits,
    },
    timing: timingSweep(transcript, stayProgram, switchProgram, school, options),
    citations,
    modelVersion: MODEL_VERSION,
  }
}

/** How much later the switch graduates, in enrolment terms. Negative is
 *  impossible by construction; a switch never finishes earlier than staying. */
export function extraTerms(comparison: Comparison, includeSummer: boolean): number {
  return compareTerms(comparison.switch.graduationTerm, comparison.stay.graduationTerm) <= 0
    ? 0
    : termsBetween(comparison.stay.graduationTerm, comparison.switch.graduationTerm, includeSummer)
}

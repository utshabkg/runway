/**
 * Aid runway — the thing nothing else computes.
 *
 * Degree audits are everywhere. DegreeWorks, uAchieve, Workday, Anthology and
 * Stellic all ship what-if major simulations, and Missouri S&T runs two of
 * them. None answers the question underneath the decision: after this, how much
 * federal aid eligibility do you have left?
 *
 * Four ceilings, all computable from a transcript plus a target program, none
 * surfaced anywhere:
 *
 *   SAP maximum timeframe — 150% of published program length, measured in
 *     ATTEMPTED credits (34 CFR 668.34). Withdrawals, failures and credits from
 *     an abandoned major never leave the denominator.
 *   Pell Lifetime Eligibility Used — 600%, roughly twelve full-time semesters,
 *     and unlike SAP there is NO APPEAL. A hard wall where SAP is a soft one.
 *   Institutional aid — S&T merit awards run eight semesters, full-time fall
 *     and spring only, and freeze rather than burn during a co-op.
 *   State aid — Access Missouri dies at ten semesters OR 150 completed credit
 *     hours, whichever comes first.
 *
 * WHAT THIS REFUSES TO CLAIM: 34 CFR 668.34 is silent on how credits from an
 * abandoned major count toward maximum timeframe. Schools decide, usually
 * through an appeal with an academic plan. That uncertainty is carried as a
 * data field (`SapPolicy.majorChangePolicy`) rather than a string, so the
 * interface structurally cannot assert a rule the regulation does not contain.
 */
import { isAidCountingTerm } from './terms.ts'
import type { AidFlag, AidRunway, PlannedTerm, Program, RunwayStatus, School, Term } from './types.ts'

/** Below this many credits of headroom, a student is one bad term from the
 *  ceiling and should hear about it now rather than after. */
const TIGHT_HEADROOM_CREDITS = 12

export interface AidInputs {
  attemptedNow: number
  completedNow: number
  /** Full-time-equivalent semesters of Pell already used. Students read this
   *  off StudentAid.gov; we ask rather than guess. */
  pellSemestersUsedFTE: number
  institutionalSemestersUsed: number
  stateSemestersUsed: number
}

function statusFor(headroom: number): RunwayStatus {
  if (headroom <= 0) return 'exceeded'
  if (headroom < TIGHT_HEADROOM_CREDITS) return 'tight'
  return 'ok'
}

const MAJOR_CHANGE_CAVEAT: Record<string, string> = {
  unspecified:
    '34 CFR 668.34 does not say how credits from an abandoned major count toward maximum timeframe. ' +
    'Schools set that policy, usually through an appeal with an academic plan. This projection counts ' +
    'every attempted credit — the most conservative reading. Confirm with your financial aid office.',
  excludesPriorMajor:
    'This school excludes credits that do not apply to the new program from the maximum-timeframe ' +
    'calculation, so the ceiling below is more generous than the federal floor requires.',
  includesAll:
    'This school counts every attempted credit toward maximum timeframe, including credits that no ' +
    'longer apply to the new program.',
}

export function aidRunway(
  plan: readonly PlannedTerm[],
  program: Program,
  school: School,
  inputs: AidInputs,
): AidRunway {
  const flags: AidFlag[] = []

  // ── SAP maximum timeframe ────────────────────────────────────────────────
  const plannedCredits = plan.reduce((sum, t) => sum + t.credits, 0)
  const ceiling = program.totalCredits * school.sap.maxTimeframePct
  const attemptedAtGraduation = inputs.attemptedNow + plannedCredits
  const headroomCredits = ceiling - attemptedAtGraduation
  const sapStatus = statusFor(headroomCredits)

  if (sapStatus !== 'ok') {
    flags.push({
      id: 'sap-max-timeframe',
      severity: sapStatus === 'exceeded' ? 'critical' : 'watch',
      title:
        sapStatus === 'exceeded'
          ? `This path exceeds the ${ceiling}-hour federal aid ceiling`
          : `Only ${Math.round(headroomCredits)} hours of federal aid headroom left`,
      detail:
        `Federal aid requires finishing within ${school.sap.maxTimeframePct * 100}% of the ` +
        `${program.totalCredits} hours this degree publishes, measured in attempted hours. ` +
        `This path reaches ${attemptedAtGraduation} of ${ceiling}.` +
        (school.sap.appealAvailable
          ? ` An appeal is available${school.sap.appealWindowWeeks ? `, decided within ${school.sap.appealWindowWeeks} weeks` : ''}.`
          : ''),
      citationId: school.sap.citationId,
    })
  }

  // ── Pell lifetime eligibility ────────────────────────────────────────────
  // One full-time fall or spring term consumes about 50% of a Scheduled Award.
  const pellTerms = plan.filter((t) => isAidCountingTerm(t.term) && t.credits >= 12 && !t.isCoop).length
  const percentUsedNow = inputs.pellSemestersUsedFTE * 50
  const percentUsedAtGraduation = percentUsedNow + pellTerms * 50
  const remainingPct = school.pell.lifetimeEligibilityPct - percentUsedAtGraduation
  const pellStatus: RunwayStatus = remainingPct <= 0 ? 'exceeded' : remainingPct < 100 ? 'tight' : 'ok'

  if (pellStatus !== 'ok' && inputs.pellSemestersUsedFTE > 0) {
    flags.push({
      id: 'pell-leu',
      severity: pellStatus === 'exceeded' ? 'critical' : 'watch',
      title:
        pellStatus === 'exceeded'
          ? 'This path runs out of Pell before graduation'
          : `Pell would be at ${percentUsedAtGraduation}% of the 600% lifetime limit`,
      // The sharpest fact in the whole model: SAP has an appeal, this does not.
      detail:
        'Pell has a 600% lifetime limit, about twelve full-time semesters. Unlike satisfactory ' +
        'academic progress, there is no appeal once it is reached.',
      citationId: school.pell.citationId,
    })
  }

  // ── Institutional aid ────────────────────────────────────────────────────
  const institutional = school.institutionalAid.map((award) => {
    const consumed = plan.filter(
      (t) =>
        award.countsTerms.includes(t.term.season) &&
        (!award.requiresFullTime || t.credits >= award.minCreditsForFullTime) &&
        !(award.frozenDuringCoop && t.isCoop),
    ).length
    const semestersAtGraduation = inputs.institutionalSemestersUsed + consumed
    const termsUnfunded = Math.max(0, semestersAtGraduation - award.maxSemesters)
    const status: RunwayStatus = termsUnfunded > 0 ? 'exceeded' : semestersAtGraduation === award.maxSemesters ? 'tight' : 'ok'

    if (termsUnfunded > 0) {
      flags.push({
        id: `institutional-${award.id}`,
        severity: 'critical',
        title: `${termsUnfunded} term${termsUnfunded === 1 ? '' : 's'} beyond your ${award.label}`,
        detail:
          `${award.label} runs ${award.maxSemesters} semesters of full-time enrolment. This path uses ` +
          `${semestersAtGraduation}.` +
          (award.frozenDuringCoop ? ' Co-op terms are frozen rather than consumed and are not counted here.' : ''),
        citationId: award.citationId,
      })
    }
    return {
      programId: award.id,
      label: award.label,
      semestersUsed: inputs.institutionalSemestersUsed,
      semestersAtGraduation,
      cap: award.maxSemesters,
      termsUnfunded,
      status,
    }
  })

  // ── State aid ────────────────────────────────────────────────────────────
  const stateAid = school.stateAid.map((award) => {
    let boundHitAt: Term | undefined
    let reason = ''
    let semesters = inputs.stateSemestersUsed
    let completed = inputs.completedNow

    for (const term of plan) {
      if (isAidCountingTerm(term.term) && term.credits > 0) semesters++
      completed += term.credits
      if (award.maxSemesters !== undefined && semesters > award.maxSemesters && !boundHitAt) {
        boundHitAt = term.term
        reason = `${award.label} runs at most ${award.maxSemesters} semesters.`
      }
      if (award.maxCompletedCredits !== undefined && completed >= award.maxCompletedCredits && !boundHitAt) {
        boundHitAt = term.term
        // The credit-hour cap is independent of the semester cap and is the one
        // a major switch is most likely to trip.
        reason = `${award.label} ends once you have completed ${award.maxCompletedCredits} credit hours, whichever comes first.`
      }
    }

    if (boundHitAt) {
      flags.push({
        id: `state-${award.id}`,
        severity: 'watch',
        title: `${award.label} runs out before you finish`,
        detail: reason,
        citationId: award.citationId,
      })
    }
    return {
      programId: award.id,
      label: award.label,
      status: (boundHitAt ? 'ineligibleAt' : 'ok') as 'ok' | 'tight' | 'ineligibleAt',
      ...(boundHitAt ? { boundHitAt } : {}),
      reason: reason || `Within ${award.label} limits on this path.`,
    }
  })

  return {
    sap: {
      attemptedNow: inputs.attemptedNow,
      attemptedAtGraduation,
      ceiling,
      headroomCredits,
      status: sapStatus,
      caveat: MAJOR_CHANGE_CAVEAT[school.sap.majorChangePolicy] ?? MAJOR_CHANGE_CAVEAT['unspecified']!,
    },
    pell: {
      percentUsedNow,
      percentUsedAtGraduation,
      cap: school.pell.lifetimeEligibilityPct,
      remainingPct,
      status: pellStatus,
      appealable: school.pell.appealable,
    },
    institutional,
    stateAid,
    flags,
  }
}

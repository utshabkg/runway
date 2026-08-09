/**
 * What a plan actually costs, in integer cents.
 *
 * The non-obvious mechanic this exists to capture: Missouri S&T bills tuition
 * by RATE TIER ASSIGNED TO THE MAJOR. A full-time in-state semester is $7,451
 * at Rate 1 (psychology, economics, history, English, philosophy, education)
 * and $9,747 at Rate 3 (all engineering, computer science, and — startlingly —
 * Undeclared Undergraduate). So a major change moves a student's tuition by up
 * to $2,296 per semester, in EITHER direction, and nothing in a degree audit
 * tells them.
 *
 * Cost is therefore never "extra terms times tuition". It is the new rate times
 * the new number of terms, which is why an engineering-to-psychology switch can
 * add semesters and still cost less per term.
 */
import type {
  Cents,
  CostBreakdown,
  ExcessCreditSurcharge,
  FeeSchedule,
  PlannedTerm,
  Residency,
  School,
  TuitionRate,
} from './types.ts'

export function rateFor(school: School, programId: string): TuitionRate {
  const named = Object.values(school.tuition.rates).find((r) => r.programIds.includes(programId))
  return named ?? school.tuition.rates[school.tuition.defaultRateId]!
}

/** Tuition for one term at one rate. */
export function tuitionForTerm(rate: TuitionRate, credits: number, residency: Residency): Cents {
  if (credits <= 0) return 0
  const perCredit = residency === 'in-state' ? rate.perCreditInState : rate.perCreditOutOfState
  const plateau = rate.plateau
  if (!plateau) return Math.round(perCredit * credits)

  const flat = residency === 'in-state' ? plateau.flatInState : plateau.flatOutOfState
  if (credits < plateau.minCredits) return Math.round(perCredit * credits)
  if (credits <= plateau.maxCredits) return flat
  // S&T: "Over 18 hours will be assessed at plateau rate plus per credit hour
  // rate for additional hours over 18."
  const overage = rate.overPlateauChargesPerCredit ? perCredit * (credits - plateau.maxCredits) : 0
  return Math.round(flat + overage)
}

/** Per-credit and flat fees for one term. */
export function feesForTerm(fees: FeeSchedule, credits: number): { perCredit: Cents; flat: Cents } {
  if (credits <= 0) return { perCredit: 0, flat: 0 }
  const perCredit = fees.perCreditFees.reduce((sum, fee) => {
    // The activity and facility fee is $42.00 per credit hour, capped at 12.
    const billable = fee.cappedAtCredits === undefined ? credits : Math.min(credits, fee.cappedAtCredits)
    return sum + fee.amountPerCredit * billable
  }, 0)
  const flat = fees.flatPerTerm.reduce((sum, fee) => {
    if (fee.proratedBelowCredits !== undefined && credits < fee.proratedBelowCredits) {
      return sum + Math.round((fee.amount * credits) / fee.proratedBelowCredits)
    }
    return sum + fee.amount
  }, 0)
  return { perCredit, flat }
}

export interface CostOptions {
  residency: Residency
  /** Attempted credits already on the transcript, for the excess-credit
   *  surcharge threshold. Excludes accelerated credit where the statute does. */
  attemptedBefore: number
  programTotalCredits: number
  /** Include the one-time graduation application fee. */
  includeGraduationFee: boolean
}

export function costOfPlan(
  plan: readonly PlannedTerm[],
  rate: TuitionRate,
  school: School,
  options: CostOptions,
): CostBreakdown {
  const perTerm: CostBreakdown['perTerm'] = []
  let running = options.attemptedBefore

  for (const term of plan) {
    // A co-op term carries no coursework, so no tuition and no per-credit fees.
    const tuition = term.isCoop ? 0 : tuitionForTerm(rate, term.credits, options.residency)
    const { perCredit, flat } = term.isCoop ? { perCredit: 0, flat: 0 } : feesForTerm(school.fees, term.credits)
    const surcharge = surchargeForTerm(
      school.excessCreditSurcharge,
      rate,
      options,
      running,
      term.isCoop ? 0 : term.credits,
    )
    running += term.isCoop ? 0 : term.credits
    perTerm.push({
      term: term.term,
      tuition,
      subjectFees: perCredit,
      flatFees: flat,
      surcharge,
      total: tuition + perCredit + flat + surcharge,
    })
  }

  const oneTime = options.includeGraduationFee
    ? school.fees.oneTime.reduce((sum, fee) => sum + fee.amount, 0)
    : 0

  const tuitionTotal = perTerm.reduce((sum, t) => sum + t.tuition, 0)
  const feesTotal = perTerm.reduce((sum, t) => sum + t.subjectFees + t.flatFees, 0) + oneTime
  const surchargeTotal = perTerm.reduce((sum, t) => sum + t.surcharge, 0)

  return {
    perTerm,
    tuitionTotal,
    feesTotal,
    surchargeTotal,
    grandTotal: tuitionTotal + feesTotal + surchargeTotal,
  }
}

/**
 * Statutory excess-credit surcharge, where a state has one. Florida's
 * § 1009.286 charges a 100% surcharge on hours beyond 120% of the program's
 * length — the only place in America where excess credits carry an automatic,
 * computable dollar penalty, and no consumer tool models a student's exposure
 * to it. Missouri has none, so this returns zero at S&T.
 */
function surchargeForTerm(
  surcharge: ExcessCreditSurcharge | undefined,
  rate: TuitionRate,
  options: CostOptions,
  attemptedSoFar: number,
  termCredits: number,
): Cents {
  if (!surcharge || termCredits <= 0) return 0
  const threshold = options.programTotalCredits * surcharge.thresholdPct
  const after = attemptedSoFar + termCredits
  if (after <= threshold) return 0
  const surchargeable = Math.min(termCredits, after - Math.max(threshold, attemptedSoFar))
  const perCredit = options.residency === 'in-state' ? rate.perCreditInState : rate.perCreditOutOfState
  return Math.round(perCredit * surchargeable * surcharge.surchargePctOfTuition)
}

/** Dollars, for the render edge only. The domain never formats. */
export function formatCents(cents: Cents): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

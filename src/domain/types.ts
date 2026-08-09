/**
 * Runway — the complete domain type model.
 *
 * THE ONE ARCHITECTURAL RULE
 * Everything under src/domain/ is pure. No React, no fetch, no `new Date()`.
 * "Now" is an injected Term. That property is the whole answer to a provost
 * asking "how do you know these numbers are right?" — every figure in the app
 * is reproducible from committed inputs by a function with no hidden state.
 *
 * No LLM output ever reaches this layer. Claude parses transcripts and writes
 * the explanation prose; it never touches an allocation, a dollar figure, a
 * graduation date, a credit count, or an aid rule.
 */

// ─────────────────────────────── primitives ───────────────────────────────

/** Fall, Spring, Summer. S&T's own abbreviations. */
export type Season = 'FS' | 'SP' | 'SU'

/** A term is a {year, season} tuple, never a Date. This domain has no clock,
 *  and a date library would import timezone bugs into it for nothing. */
export interface Term {
  year: number
  season: Season
}

export type Grade =
  | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D+' | 'D' | 'D-' | 'F'
  | 'W'   // withdrawal — attempted, never earned. The reason SAP pace is brutal.
  | 'I'   // incomplete
  | 'S'   // satisfactory (pass/fail)
  | 'U'   // unsatisfactory
  | 'TR'  // transfer credit
  | 'CR'  // credit by exam (AP/IB/dual enrollment)

/** Normalized as the catalog prints it: "COMP SCI 1200", "MECH ENG 2113". */
export type CourseCode = string
/** The subject portion: "COMP SCI". Drives per-subject fee lookup at S&T. */
export type Subject = string

/** Money is integer cents everywhere inside the domain. Formatted only at the
 *  render edge. Floating-point dollars in a tool a CFO might read is an
 *  unforced error. */
export type Cents = number

/**
 * Every number the UI renders carries one of these. The citations panel is on
 * the "never cut" list: this audience is uniquely equipped to detect a stale
 * catalog figure, and a visible source with an as-of date is the difference
 * between "they did the work" and "they made it up".
 */
export interface Citation {
  id: string
  label: string
  url: string
  /** ISO date the figure was read off that page by a human. */
  asOf: string
  note?: string
  /**
   * A placeholder nobody has confirmed against the source yet. The UI renders
   * these with an unmissable badge, and every one must carry a `note` saying
   * what to check and where (enforced in tests/data.test.ts).
   *
   * Day 10 registrar-proofing is done when this returns nothing:
   *   grep -rn '"unverified": true' src/data/
   */
  unverified?: boolean
}

// ─────────────────────────────── transcript ───────────────────────────────

export interface CompletedCourse {
  /** Stable local id, survives edits in the transcript table. */
  id: string
  code: CourseCode
  subject: Subject
  title: string
  /** Credit hours AS ATTEMPTED. */
  credits: number
  grade: Grade
  term: Term

  /**
   * `earned` and `attempted` are two separate fields on purpose, rather than a
   * grade comparison repeated at call sites.
   *
   * The SAP maximum-timeframe denominator is ATTEMPTED credits (34 CFR
   * 668.34(a)(5)(ii)). That is the entire reason withdrawals, failures, and
   * credits from an abandoned major are permanent — they never leave the
   * denominator. Making it impossible to reach for the wrong one by accident
   * is worth the extra field.
   */
  earned: boolean
  attempted: boolean
  /** null for W / S / TR / CR — no grade points to average. */
  gradePoints: number | null

  source: 'parsed' | 'manual' | 'persona'
  /** 0–1, from the parser. Below 0.8 the row gets a "check this" affordance.
   *  The editable table is always shown; parsing is a reviewable artifact,
   *  not a black box you accept or reject. */
  confidence?: number
}

export type Residency = 'in-state' | 'out-of-state'

export interface Transcript {
  schoolId: string
  courses: CompletedCourse[]
  /** Accepted on transfer but not itemized on the pasted document. */
  transferCredits: number
  /** AP / IB / AICE / dual enrollment. Excluded from the Florida excess-credit
   *  surcharge, so it has to be tracked separately from ordinary transfer. */
  acceleratedCredits: number
  cumulativeGpa?: number
  asOfTerm: Term
  firstEnrolledTerm: Term
  residency: Residency
  /** Full-time-equivalent semesters of Pell already consumed. Students read
   *  this off StudentAid.gov; we ask rather than guess. */
  pellSemestersUsedFTE?: number
  institutionalScholarshipSemestersUsed?: number
}

// ───────────────────────── program requirements ─────────────────────────

export type CourseRef =
  /** One specific course. */
  | { kind: 'course'; code: CourseCode }
  /** "one of X, Y, Z" — also how cross-listed courses are expressed. */
  | { kind: 'anyOf'; codes: CourseCode[] }
  /** "any COMP SCI 3000 or above". */
  | { kind: 'pattern'; subject: Subject; minLevel?: number; maxLevel?: number; exclude?: CourseCode[] }

export interface Requirement {
  id: string
  /** Verbatim from the catalog. Never paraphrased — a registrar reads these. */
  label: string
  ref: CourseRef
  credits: number
  /** S&T requires a C or better in every CS course. A course below the floor
   *  is blocked from THIS requirement but stays in the absorption pool: a D in
   *  a CS course is still free-elective credit. */
  minGrade?: Grade
  note?: string
  citationId?: string
}

export type BlockKind =
  /** Named courses that must all be taken. */
  | 'core'
  /** "choose N of the following". */
  | 'chooseN'
  /** "18 hours of CS electives, min 9 at 5000+". */
  | 'creditBucket'
  /** "free electives 4–7 hrs" — the capacity that decides whether an orphaned
   *  credit is genuinely orphaned. This is the EAB mechanic, and the catalog
   *  prints the number right on the program page. */
  | 'freeElective'

export interface RequirementBlock {
  id: string
  kind: BlockKind
  label: string
  requirements?: Requirement[]
  chooseN?: number
  minCredits?: number
  capacityCredits?: number
  accepts?: CourseRef[]
  minGrade?: Grade
  /** Where bucket/elective credits have no named course, this decides which
   *  per-subject fee they are charged at. Absent ⇒ base rate, and the
   *  assumptions panel says so out loud. */
  feeSubjectHint?: Subject
  /** Allocation order: core 10 · chooseN 20 · creditBucket 30 · freeElective 40. */
  priority: number
  /**
   * This block satisfies part of the program's general education framework.
   *
   * Tagging rather than summing is what lets the CORE 42 delta fall out of the
   * allocation: when an engineering student's completed work is matched against
   * a psychology program, the gen-ed buckets engineering never required simply
   * come back unfilled, and the engine reports the shortfall it actually found
   * instead of asserting a 42-minus-31 difference.
   */
  isGenEd?: boolean
  citationId?: string
}

/**
 * The hidden-extra-credits mechanic. S&T states that "Bachelor of Science
 * degrees in engineering, business and IST, and chemistry typically do not
 * follow Core 42 due to their accreditation requirements" — so engineering
 * carries a 31-hour general education core while most other BS degrees carry
 * Missouri's 42-hour CORE 42. An engineering→psychology switch silently swaps
 * the entire framework, and no what-if audit explains why.
 *
 * REFERENCE DATA, NOT ADDITIVE. A program's published plan of study already
 * contains its general education courses, so these blocks are never summed
 * into a program's total — doing so would double-count. The framework exists
 * to name which system a program follows, to carry its citation, and to let
 * the explanation layer say *why* the shortfall appeared.
 */
export interface GenEdFramework {
  id: string
  label: string
  totalCredits: number
  blocks: RequirementBlock[]
  citationId: string
}

export interface Program {
  id: string
  schoolId: string
  /** "Computer Science, B.S." */
  name: string
  degree: 'BS' | 'BA'
  /** MechE 128 · CS 127 · IST / Business / Psych / Bio 120. */
  totalCredits: number
  genEdFrameworkId: string
  /**
   * Which TuitionRate this major is billed at. The single highest-leverage
   * field in the file: it is what makes a major change move a student's
   * per-semester tuition, up or down.
   */
  rateId: string
  blocks: RequirementBlock[]

  /**
   * COARSE BY DESIGN. Depth is "how many terms of prerequisite chain sit above
   * this course", not a dependency DAG. 0 means takeable in term one.
   *
   * Hand-encoded for five core sequences only (CS 1500→1575→2500→3800;
   * Calc I→II→III→DiffEq; Physics; Chem; statics→dynamics→machine design).
   * Everything else is depth 0. Generic prerequisite parsing — the catalog
   * states prerequisites as prose inside course descriptions — is where this
   * project would die, so we do not attempt it. The assumptions panel says so.
   */
  prereqDepth: Record<CourseCode, number>
  /** Only where a once-a-year offering actually binds the projection. */
  offeredIn?: Record<CourseCode, Season[]>
  maxCreditsPerTerm: number

  catalogUrl: string
  citationId: string
  asOf: string
}

// ───────────────────────────── school policy ─────────────────────────────

/**
 * A named tuition rate that some set of programs is billed at.
 *
 * THE LOCAL MECHANIC, resolved from the official Fall 2026 / Spring 2027 fee
 * schedule: Missouri S&T bills tuition by **rate tier assigned to the major**,
 * not by course subject. Three tiers, and the spread is large — a full-time
 * in-state semester is $7,451 at Rate 1 and $9,747 at Rate 3.
 *
 * So the same fifteen credits genuinely cost different amounts in different
 * majors, and a switch can move a student between tiers in either direction.
 * Engineering → Psychology is $2,296 cheaper per semester while simultaneously
 * adding CORE 42 credits: the two effects pull opposite ways, which is exactly
 * the kind of answer a student cannot work out on their own.
 */
export interface TuitionRate {
  id: string
  /** Verbatim from the fee schedule: "Rate 1", "Rate 3". */
  label: string
  perCreditInState: Cents
  perCreditOutOfState: Cents
  /** S&T bills a flat plateau across 12–18 hours. */
  plateau?: {
    minCredits: number
    maxCredits: number
    flatInState: Cents
    flatOutOfState: Cents
  }
  /**
   * S&T: "Over 18 hours will be assessed at plateau rate plus per credit hour
   * rate for additional hours over 18."
   */
  overPlateauChargesPerCredit: boolean
  /** Program ids billed at this rate, for display and for a coverage test. */
  programIds: string[]
}

export interface TuitionModel {
  rates: Record<string, TuitionRate>
  /** Used when a program names no rate — should never be hit; tests enforce it. */
  defaultRateId: string
  citationId: string
}

/** A fee charged per credit hour that may stop accruing past a threshold.
 *  S&T's Activity & Facility fee is $42/credit hour, capped at 12 hours. */
export interface PerCreditFee {
  label: string
  amountPerCredit: Cents
  cappedAtCredits?: number
}

export interface FlatFee {
  label: string
  amount: Cents
  /** Prorated below full time. */
  proratedBelowCredits?: number
}

export interface FeeSchedule {
  perCreditFees: PerCreditFee[]
  flatPerTerm: FlatFee[]
  /** Charged once, at graduation. */
  oneTime: FlatFee[]
  /**
   * Supplemental fees charged by course subject. Not how S&T bills — kept
   * because other schools do, and the engine costs bucket credits against it
   * when present.
   */
  perCreditBySubject?: Record<Subject, Cents>
  /** Where per-subject fees apply, which one a cross-listed course is charged. */
  crossListedRule?: 'higher' | 'primary'
  citationId: string
}

/**
 * 34 CFR 668.34. The live 150% rule.
 *
 * Not to be confused with the Direct Subsidized Loan 150% limit (SULA), which
 * was REPEALED by the FAFSA Simplification Act effective July 1, 2021 and
 * reversed retroactively. The two are constantly conflated. SULA must never
 * appear anywhere in this codebase; tests/aid.test.ts asserts its absence.
 */
export interface SapPolicy {
  maxTimeframePct: 1.5
  /** Literal type: there is no other correct value. The denominator is
   *  attempted credits, per 668.34(a)(5)(ii). */
  denominator: 'attempted'
  /** 0.75 at S&T — notably stricter than the ~0.67 most institutions use. */
  pacePct: number
  gpaTiers: { minAttempted: number; requiredGpa: number }[]
  appealAvailable: boolean
  appealWindowWeeks?: number
  academicPlanTerms?: number

  /**
   * 668.34 is SILENT on how credits from an abandoned major count toward
   * maximum timeframe. Schools set that policy, usually resolving it through
   * an appeal with an academic plan.
   *
   * The default MUST be 'unspecified'. Because this is a data field rather
   * than a UI string, the interface structurally cannot assert a policy the
   * regulation does not contain.
   */
  majorChangePolicy: 'unspecified' | 'excludesPriorMajor' | 'includesAll'
  citationId: string
}

/** Pell Lifetime Eligibility Used. 600% ≈ 12 full-time semesters. Unlike SAP,
 *  there is no appeal — a hard wall where SAP is a soft one. */
export interface PellPolicy {
  lifetimeEligibilityPct: 600
  appealable: false
  citationId: string
}

export interface InstitutionalAidProgram {
  id: string
  label: string
  /** S&T merit scholarships: 8 semesters. */
  maxSemesters: number
  countsTerms: Season[]
  requiresFullTime: boolean
  minCreditsForFullTime: number
  /**
   * At S&T, aid is not issued during a co-op and most scholarships are FROZEN
   * rather than consumed. That is good news students do not know they have,
   * and it is the reason a co-op term is not simply "a lost semester".
   */
  frozenDuringCoop: boolean
  /** If true, ask the user one yes/no question. Never guess whether an award
   *  is tied to a department. */
  majorRestricted: boolean
  citationId: string
}

export interface StateAidProgram {
  id: string
  label: string
  /** Access Missouri: 10 semesters. Bright Flight: 10 semesters. */
  maxSemesters?: number
  /** Access Missouri also dies at 150 COMPLETED credit hours, whichever comes
   *  first — a credit-hour cap independent of semesters. */
  maxCompletedCredits?: number
  citationId: string
}

/** Fla. Stat. § 1009.286. The most dramatic computable penalty in the space,
 *  and the reason a second school proves the model generalizes. */
export interface ExcessCreditSurcharge {
  /** 1.2 for summer 2019 onward. NOT the older 1.1 threshold. */
  thresholdPct: number
  /** 1.0 = a 100% surcharge, i.e. double tuition on the excess. */
  surchargePctOfTuition: number
  countsAttempted: true
  excludes: (
    | 'ap' | 'ib' | 'aice' | 'dualEnrollment'
    | 'remedial' | 'rotc' | 'militaryActiveDuty' | 'medicalWithdrawal'
  )[]
  citationId: string
}

export interface School {
  id: string
  name: string
  ipedsId: string
  /**
   * Every subject code the school actually uses.
   *
   * This exists because a requirement pattern built on a subject the school
   * does not offer matches nothing, silently — the block simply never fills,
   * and no total changes to give it away. An early draft of the general
   * education files accepted SOC for sociology, which Missouri S&T does not
   * offer; six dead patterns rode that mistake into four files before a
   * verification pass caught it. tests/data.test.ts now rejects any subject
   * code absent from this list.
   */
  subjects: Subject[]
  tuition: TuitionModel
  fees: FeeSchedule
  sap: SapPolicy
  pell: PellPolicy
  institutionalAid: InstitutionalAidProgram[]
  stateAid: StateAidProgram[]
  /** undefined for Missouri S&T; Missouri has no excess-credit surcharge. */
  excessCreditSurcharge?: ExcessCreditSurcharge
  genEdFrameworks: Record<string, GenEdFramework>
  gradRates?: { fourYear: number; sixYear: number; citationId: string }
  citations: Record<string, Citation>
  asOf: string
}

// ──────────────────────────── scenario inputs ────────────────────────────

/**
 * Three decisions, one engine. B and C are scenario inputs to the same
 * simulate(), not separate engines — which is the entire thesis and the
 * second act of the Summit keynote.
 */
export type Scenario =
  /** A. Switch majors. The flagship. */
  | { kind: 'switchMajor'; targetProgramId: string; switchAfterTerms: number }
  /** B. Take a co-op. Zero attempted credits, so SAP pace is untouched;
   *     scholarships freeze rather than burn; graduation moves a term. */
  | { kind: 'coop'; startAfterTerms: number; termCount: number }
  /** C. Bank accelerated BS→MS shared credits. They count toward both degrees
   *     at undergraduate tuition rates, but still consume undergrad attempted
   *     credits against the SAP ceiling — and Pell ends at the bachelor's. */
  | { kind: 'acceleratedMs'; sharedCredits: number; startAfterTerms: number }

export interface SimulateOptions {
  /** Credit hours per term the student plans to carry. */
  load: number
  includeSummer: boolean
  /** Injected. The domain never reads a system clock. */
  now: Term
}

// ───────────────────────────── engine output ─────────────────────────────

/**
 * The three-way taxonomy is the correctness linchpin of the whole product.
 *
 * EAB's 78,000-student study (How Late Is Too Late?, p.5): "In most cases,
 * courses that no longer fulfill major requirements after a switch are simply
 * converted to fulfill general electives. These credits will not become
 * unproductive unless the student has already fulfilled all elective
 * requirements."
 *
 * So a tool that reports "21 credits die" is wrong, and a registrar will say
 * so. Modelling elective capacity explicitly is what lets Runway report the
 * truth — usually "most of your credits survive" — and it is the only reason
 * the tool can cite the study that contradicts the obvious pitch.
 */
export type CourseFate =
  | {
      kind: 'satisfies'
      requirementId: string
      blockId: string
      blockLabel: string
      requirementLabel: string
    }
  | { kind: 'absorbed'; blockId: string; blockLabel: string }
  | { kind: 'orphaned'; reason: 'electiveCapacityFull' | 'gradeTooLow' | 'notApplicable' }

export interface CourseAllocation {
  courseId: string
  code: CourseCode
  credits: number
  fate: CourseFate
}

export interface ElectiveSlack {
  capacityCredits: number
  usedCredits: number
  remainingCredits: number
  /** > 0 is the only condition under which a credit is genuinely orphaned. */
  overflowCredits: number
}

export interface RemainingWork {
  blocks: { blockId: string; label: string; credits: number; items: string[] }[]
  totalCredits: number
  /** The CORE 42 delta, surfaced as a number rather than hidden in a total. */
  addedByGenEdSwitch: number
}

export interface PlannedTerm {
  term: Term
  credits: number
  items: string[]
  isSummer: boolean
  /** A co-op term: zero credits, no tuition, scholarship frozen. */
  isCoop: boolean
}

export interface CostBreakdown {
  perTerm: {
    term: Term
    tuition: Cents
    subjectFees: Cents
    flatFees: Cents
    surcharge: Cents
    total: Cents
  }[]
  tuitionTotal: Cents
  feesTotal: Cents
  surchargeTotal: Cents
  grandTotal: Cents
}

export interface AidFlag {
  id: string
  severity: 'info' | 'watch' | 'critical'
  title: string
  detail: string
  citationId: string
}

export type RunwayStatus = 'ok' | 'tight' | 'exceeded'

export interface AidRunway {
  sap: {
    attemptedNow: number
    attemptedAtGraduation: number
    /** totalCredits × 1.5. CS 190.5 · MechE 192 · a 120-hour degree 180. */
    ceiling: number
    headroomCredits: number
    status: RunwayStatus
    /** Rendered from SapPolicy.majorChangePolicy. Never empty. */
    caveat: string
  }
  pell: {
    percentUsedNow: number
    percentUsedAtGraduation: number
    cap: 600
    remainingPct: number
    status: RunwayStatus
    appealable: false
  }
  institutional: {
    programId: string
    label: string
    semestersUsed: number
    semestersAtGraduation: number
    cap: number
    termsUnfunded: number
    status: RunwayStatus
  }[]
  stateAid: {
    programId: string
    label: string
    status: 'ok' | 'tight' | 'ineligibleAt'
    boundHitAt?: Term
    reason: string
  }[]
  flags: AidFlag[]
}

export interface PathProjection {
  pathId: 'stay' | 'switch'
  programId: string
  programName: string
  allocations: CourseAllocation[]
  electiveSlack: ElectiveSlack
  /** satisfies + absorbed. Deliberately NOT called "credits that survive the
   *  switch" in any user-facing string without the absorbed breakdown beside
   *  it — the distinction is the whole honesty argument. */
  survivingCredits: number
  absorbedCredits: number
  orphanedCredits: number
  remaining: RemainingWork
  plan: PlannedTerm[]
  graduationTerm: Term
  termsRemaining: number
  cost: CostBreakdown
  aid: AidRunway
  /** Rendered verbatim into the "What this model assumes" panel. */
  assumptions: string[]
}

export interface TimingPoint {
  switchAfterTerms: number
  switchTerm: Term
  graduationTerm: Term
  totalCost: Cents
  deltaCostVsNow: Cents
  orphanedCredits: number
  /** Constraints that bind at this timing but did not at the previous one. */
  newlyBindingConstraints: string[]
  isCliff: boolean
}

export interface Comparison {
  stay: PathProjection
  switch: PathProjection
  delta: {
    extraTerms: number
    extraCost: Cents
    /** Genuinely orphaned only — never the raw "does not apply" count. */
    creditsOrphaned: number
  }
  timing: TimingPoint[]
  citations: Citation[]
  modelVersion: string
}

/** What the explanation endpoint returns. Claude receives final numbers and is
 *  forbidden from recomputing or contradicting any of them. */
export interface Explanation {
  explanation: string
  /** Exactly five, each citing a specific number from the Comparison. */
  questions: string[]
  source: 'fallback' | 'claude' | 'prebaked'
}

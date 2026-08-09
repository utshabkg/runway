/**
 * Zod mirrors of the domain types, used to validate hand-authored catalog and
 * policy JSON at module load.
 *
 * This is the highest-leverage file in the build. Six degree programs get
 * transformed by hand from CourseLeaf plan-of-study pages into requirement
 * specs; typos in that transcription are the single highest-frequency bug
 * class, and they are exactly the kind of error a registrar in the audience is
 * uniquely equipped to spot. Catching them at test time instead of on stage is
 * worth the duplication between these schemas and src/domain/types.ts.
 */
import { z } from 'zod'

// ─────────────────────────────── primitives ───────────────────────────────

export const seasonSchema = z.enum(['SP', 'SU', 'FS'])

export const termSchema = z.object({
  year: z.int().min(1900).max(2100),
  season: seasonSchema,
})

export const gradeSchema = z.enum([
  'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F',
  'W', 'I', 'S', 'U', 'TR', 'CR',
])

/** Integer cents. Rejects floats outright so a stray dollar amount cannot slip
 *  into the money path. */
export const centsSchema = z.int().min(0)

export const citationSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    url: z.url(),
    asOf: z.iso.date(),
    note: z.string().optional(),
    unverified: z.boolean().optional(),
  })
  .refine((c) => !c.unverified || (c.note && c.note.length > 10), {
    message:
      'An unverified citation must carry a note saying what to check and where. ' +
      'A placeholder without instructions is how a wrong number reaches the demo.',
    path: ['note'],
  })

// ───────────────────────── program requirements ─────────────────────────

export const courseRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('course'), code: z.string().min(1) }),
  z.object({ kind: z.literal('anyOf'), codes: z.array(z.string().min(1)).min(2) }),
  z.object({
    kind: z.literal('pattern'),
    subject: z.string().min(1),
    minLevel: z.int().optional(),
    maxLevel: z.int().optional(),
    exclude: z.array(z.string()).optional(),
  }),
])

export const requirementSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  ref: courseRefSchema,
  credits: z.number().min(0).max(20),
  minGrade: gradeSchema.optional(),
  note: z.string().optional(),
  citationId: z.string().optional(),
})

export const blockKindSchema = z.enum(['core', 'chooseN', 'creditBucket', 'freeElective'])

/** Allocation order. Named requirements get first claim on a course; free
 *  electives absorb whatever is left. */
export const BLOCK_PRIORITY = { core: 10, chooseN: 20, creditBucket: 30, freeElective: 40 } as const

export const requirementBlockSchema = z
  .object({
    id: z.string().min(1),
    kind: blockKindSchema,
    label: z.string().min(1),
    requirements: z.array(requirementSchema).optional(),
    chooseN: z.int().min(1).optional(),
    minCredits: z.number().min(0).optional(),
    capacityCredits: z.number().min(0).optional(),
    accepts: z.array(courseRefSchema).optional(),
    minGrade: gradeSchema.optional(),
    feeSubjectHint: z.string().optional(),
    priority: z.int(),
    isGenEd: z.boolean().optional(),
    citationId: z.string().optional(),
  })
  // Each block kind carries a different payload; a block missing its payload
  // silently contributes zero credits, which is the worst possible failure —
  // the total still looks plausible.
  .superRefine((b, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message })

    if (b.kind === 'core' && !b.requirements?.length) {
      fail(`core block "${b.id}" has no requirements`)
    }
    if (b.kind === 'chooseN') {
      if (!b.requirements?.length) fail(`chooseN block "${b.id}" has no options`)
      if (b.chooseN === undefined) fail(`chooseN block "${b.id}" is missing chooseN`)
      if (b.chooseN !== undefined && b.requirements && b.chooseN > b.requirements.length) {
        fail(`chooseN block "${b.id}" asks for ${b.chooseN} of ${b.requirements.length} options`)
      }
    }
    if (b.kind === 'creditBucket') {
      if (b.minCredits === undefined) fail(`creditBucket "${b.id}" is missing minCredits`)
      if (!b.accepts?.length) fail(`creditBucket "${b.id}" is missing accepts`)
    }
    if (b.kind === 'freeElective' && b.capacityCredits === undefined) {
      // This is the number that decides whether an orphaned credit is genuinely
      // orphaned. The catalog prints it on the program page; there is no excuse
      // for it to be missing.
      fail(`freeElective block "${b.id}" is missing capacityCredits`)
    }
    if (b.priority !== BLOCK_PRIORITY[b.kind]) {
      fail(`block "${b.id}" has priority ${b.priority}; ${b.kind} must be ${BLOCK_PRIORITY[b.kind]}`)
    }
  })

export const genEdFrameworkSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  totalCredits: z.number().min(0),
  blocks: z.array(requirementBlockSchema),
  citationId: z.string().min(1),
})

export const programSchema = z.object({
  id: z.string().min(1),
  schoolId: z.string().min(1),
  name: z.string().min(1),
  degree: z.enum(['BS', 'BA']),
  totalCredits: z.number().min(1).max(300),
  genEdFrameworkId: z.string().min(1),
  rateId: z.string().min(1),
  blocks: z.array(requirementBlockSchema).min(1),
  prereqDepth: z.record(z.string(), z.int().min(0).max(8)),
  offeredIn: z.record(z.string(), z.array(seasonSchema)).optional(),
  maxCreditsPerTerm: z.number().min(1).max(30),
  catalogUrl: z.url(),
  citationId: z.string().min(1),
  asOf: z.iso.date(),
})

// ───────────────────────────── school policy ─────────────────────────────

export const tuitionRateSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  perCreditInState: centsSchema,
  perCreditOutOfState: centsSchema,
  plateau: z
    .object({
      minCredits: z.number().min(1),
      maxCredits: z.number().min(1),
      flatInState: centsSchema,
      flatOutOfState: centsSchema,
    })
    .optional(),
  overPlateauChargesPerCredit: z.boolean(),
  programIds: z.array(z.string()),
})

export const tuitionModelSchema = z
  .object({
    rates: z.record(z.string(), tuitionRateSchema),
    defaultRateId: z.string().min(1),
    citationId: z.string().min(1),
  })
  .superRefine((t, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message })
    if (!(t.defaultRateId in t.rates)) fail(`defaultRateId "${t.defaultRateId}" is not a defined rate`)
    for (const [key, rate] of Object.entries(t.rates)) {
      if (rate.id !== key) fail(`rates["${key}"].id is "${rate.id}"`)
      // Out-of-state costs more than in-state at every school modelled here;
      // a transposed pair is the likeliest transcription error in this table.
      if (rate.perCreditOutOfState < rate.perCreditInState) {
        fail(`rate "${key}" has out-of-state cheaper than in-state — check for transposed columns`)
      }
      if (rate.plateau && rate.plateau.flatOutOfState < rate.plateau.flatInState) {
        fail(`rate "${key}" plateau has out-of-state cheaper than in-state`)
      }
      // The plateau is a discount for full-time study: a full plateau load
      // should never cost more than paying per credit for the same hours.
      if (rate.plateau && rate.plateau.flatInState > rate.perCreditInState * rate.plateau.maxCredits) {
        fail(`rate "${key}" plateau costs more than per-credit at ${rate.plateau.maxCredits} hours`)
      }
    }
  })

export const feeScheduleSchema = z.object({
  perCreditFees: z.array(
    z.object({
      label: z.string().min(1),
      amountPerCredit: centsSchema,
      cappedAtCredits: z.number().min(0).optional(),
    }),
  ),
  flatPerTerm: z.array(
    z.object({
      label: z.string().min(1),
      amount: centsSchema,
      proratedBelowCredits: z.number().optional(),
    }),
  ),
  oneTime: z.array(z.object({ label: z.string().min(1), amount: centsSchema })),
  perCreditBySubject: z.record(z.string(), centsSchema).optional(),
  crossListedRule: z.enum(['higher', 'primary']).optional(),
  citationId: z.string().min(1),
})

export const sapPolicySchema = z.object({
  maxTimeframePct: z.literal(1.5),
  // Literal, not an enum. There is no other correct value: 34 CFR
  // 668.34(a)(5)(ii) measures pace against attempted hours.
  denominator: z.literal('attempted'),
  pacePct: z.number().min(0).max(1),
  gpaTiers: z
    .array(z.object({ minAttempted: z.number().min(0), requiredGpa: z.number().min(0).max(4) }))
    .min(1),
  appealAvailable: z.boolean(),
  appealWindowWeeks: z.number().min(0).optional(),
  academicPlanTerms: z.number().min(0).optional(),
  // Default is deliberately the most conservative reading. 668.34 says nothing
  // about credits from an abandoned major; anything other than 'unspecified'
  // must be backed by a named institutional policy in the citation.
  majorChangePolicy: z.enum(['unspecified', 'excludesPriorMajor', 'includesAll']),
  citationId: z.string().min(1),
})

export const pellPolicySchema = z.object({
  lifetimeEligibilityPct: z.literal(600),
  appealable: z.literal(false),
  citationId: z.string().min(1),
})

export const institutionalAidProgramSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  maxSemesters: z.int().min(1),
  countsTerms: z.array(seasonSchema).min(1),
  requiresFullTime: z.boolean(),
  minCreditsForFullTime: z.number().min(0),
  frozenDuringCoop: z.boolean(),
  majorRestricted: z.boolean(),
  citationId: z.string().min(1),
})

export const stateAidProgramSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    maxSemesters: z.int().min(1).optional(),
    maxCompletedCredits: z.number().min(1).optional(),
    citationId: z.string().min(1),
  })
  .refine((s) => s.maxSemesters !== undefined || s.maxCompletedCredits !== undefined, {
    message: 'a state aid program with no cap at all does not need modelling',
  })

export const excessCreditSurchargeSchema = z.object({
  // Fla. Stat. 1009.286 is 120% for summer 2019 onward. The 110% threshold is
  // the pre-2019 rule and citing it would be a dated, checkable error.
  thresholdPct: z.number().min(1).max(2),
  surchargePctOfTuition: z.number().min(0).max(2),
  countsAttempted: z.literal(true),
  excludes: z.array(
    z.enum(['ap', 'ib', 'aice', 'dualEnrollment', 'remedial', 'rotc', 'militaryActiveDuty', 'medicalWithdrawal']),
  ),
  citationId: z.string().min(1),
})

export const schoolSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  ipedsId: z.string().min(1),
  tuition: tuitionModelSchema,
  fees: feeScheduleSchema,
  sap: sapPolicySchema,
  pell: pellPolicySchema,
  institutionalAid: z.array(institutionalAidProgramSchema),
  stateAid: z.array(stateAidProgramSchema),
  excessCreditSurcharge: excessCreditSurchargeSchema.optional(),
  genEdFrameworks: z.record(z.string(), genEdFrameworkSchema),
  gradRates: z
    .object({
      fourYear: z.number().min(0).max(100),
      sixYear: z.number().min(0).max(100),
      citationId: z.string().min(1),
    })
    .optional(),
  citations: z.record(z.string(), citationSchema),
  asOf: z.iso.date(),
})

// ─────────────────────────── cross-file integrity ───────────────────────────

/** Every credit a block can contribute, for reconciling against totalCredits. */
export function blockCredits(block: z.infer<typeof requirementBlockSchema>): number {
  switch (block.kind) {
    case 'core':
      return (block.requirements ?? []).reduce((sum, r) => sum + r.credits, 0)
    case 'chooseN': {
      // Take the N cheapest options: the conservative reading, and the one that
      // will not quietly inflate a program's total.
      const credits = (block.requirements ?? []).map((r) => r.credits).sort((a, b) => a - b)
      return credits.slice(0, block.chooseN ?? 0).reduce((sum, c) => sum + c, 0)
    }
    case 'creditBucket':
      return block.minCredits ?? 0
    case 'freeElective':
      return block.capacityCredits ?? 0
  }
}

export interface IntegrityProblem {
  file: string
  problem: string
}

/**
 * Checks that hold *across* files and therefore cannot live in a single schema:
 * program credits reconcile to the published total, and every citationId
 * actually resolves.
 */
export function checkProgramIntegrity(
  program: z.infer<typeof programSchema>,
  genEd: z.infer<typeof genEdFrameworkSchema>,
  citations: Record<string, unknown>,
): IntegrityProblem[] {
  const problems: IntegrityProblem[] = []
  const file = `${program.id}`

  // Program blocks alone must reconcile: the published plan of study already
  // includes the program's general education courses, so adding the gen-ed
  // framework's blocks on top would double-count them.
  const authored = program.blocks.reduce((sum, b) => sum + blockCredits(b), 0)
  if (Math.abs(authored - program.totalCredits) > 0.5) {
    problems.push({
      file,
      problem:
        `blocks total ${authored} credits but the catalog publishes ${program.totalCredits}. ` +
        `A program whose blocks do not reconcile will silently mis-report remaining work.`,
    })
  }

  if (!program.blocks.some((b) => b.isGenEd)) {
    problems.push({
      file,
      problem:
        `no block is tagged isGenEd, so a switch into or out of this program cannot attribute ` +
        `a general-education shortfall to the framework change that caused it.`,
    })
  }

  const ids = new Set<string>()
  for (const b of program.blocks) {
    if (b.citationId) ids.add(b.citationId)
    for (const r of b.requirements ?? []) if (r.citationId) ids.add(r.citationId)
  }
  ids.add(program.citationId)
  ids.add(genEd.citationId)
  for (const id of ids) {
    if (!(id in citations)) problems.push({ file, problem: `citationId "${id}" does not resolve` })
  }

  // prereqDepth keys must name a course the program actually requires, or the
  // projection is pacing against a course that is never scheduled.
  const known = new Set<string>()
  for (const b of program.blocks) {
    for (const r of b.requirements ?? []) {
      if (r.ref.kind === 'course') known.add(r.ref.code)
      if (r.ref.kind === 'anyOf') for (const c of r.ref.codes) known.add(c)
    }
  }
  for (const code of Object.keys(program.prereqDepth)) {
    if (!known.has(code)) {
      problems.push({ file, problem: `prereqDepth names "${code}", which no requirement references` })
    }
  }

  return problems
}

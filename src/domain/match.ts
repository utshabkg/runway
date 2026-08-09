/**
 * Course-to-requirement allocation — the correctness linchpin of the product.
 *
 * Given a student's completed coursework and a target program, decide what
 * happens to every credit they already hold. Three outcomes, and the
 * distinction between the second and third is the whole honesty argument:
 *
 *   satisfies  — fills a named requirement in the target program
 *   absorbed   — does not fill a requirement, but fits inside the program's
 *                remaining free-elective capacity, so it still counts toward
 *                the degree
 *   orphaned   — genuinely does not count, because elective capacity is
 *                exhausted or the grade is too low
 *
 * EAB studied 78,000 students across ten institutions and found (How Late Is
 * Too Late?, p.5) that "in most cases, courses that no longer fulfill major
 * requirements after a switch are simply converted to fulfill general
 * electives. These credits will not become unproductive unless the student has
 * already fulfilled all elective requirements." A tool that reports "21 credits
 * die" is usually wrong, and a registrar will say so. Modelling capacity
 * explicitly is what lets this one report the truth.
 *
 * At Missouri S&T that truth swings hard on the target: Psychological Science
 * carries 29 hours of free-elective capacity while Mechanical Engineering
 * carries none at all — the phrase "free elective" does not appear anywhere on
 * its catalog page. Same transcript, opposite outcomes.
 *
 * STANDING INVARIANT: bias every ambiguous call against the tool's own
 * impressiveness. When allocation is uncertain a credit is absorbed rather than
 * credited to a named requirement, so someone who checks finds this
 * conservative rather than wrong.
 *
 * This is a bipartite assignment problem and this is NOT an optimal solver. It
 * is greedy with most-constrained-first ordering. What it does guarantee is
 * local optimality — no credit is left absorbed or orphaned while a requirement
 * that would have taken it sits open — and `misplacedCredits` measures that
 * rather than asserting it.
 */
import type {
  CompletedCourse,
  CourseAllocation,
  CourseRef,
  ElectiveSlack,
  Grade,
  Program,
  RemainingWork,
  Requirement,
  RequirementBlock,
} from './types.ts'

// ───────────────────────────── grade handling ─────────────────────────────

/** Ordinal for grade-floor comparisons. Higher is better. */
const GRADE_RANK: Partial<Record<Grade, number>> = {
  A: 12, 'A-': 11, 'B+': 10, B: 9, 'B-': 8,
  'C+': 7, C: 6, 'C-': 5, 'D+': 4, D: 3, 'D-': 2, F: 0,
}

/**
 * Passing marks that carry no letter grade. They satisfy a requirement but have
 * no rank, so a grade floor cannot be evaluated against them — the registrar
 * convention is that transfer and pass/fail credit accepted toward a degree
 * already cleared whatever floor applied when it was awarded.
 */
const UNGRADED_PASS: ReadonlySet<Grade> = new Set<Grade>(['S', 'TR', 'CR'])

function meetsGradeFloor(course: CompletedCourse, floor: Grade | undefined): boolean {
  if (!floor) return true
  if (UNGRADED_PASS.has(course.grade)) return true
  const held = GRADE_RANK[course.grade]
  const required = GRADE_RANK[floor]
  if (held === undefined || required === undefined) return false
  return held >= required
}

// ───────────────────────────── course matching ─────────────────────────────

/** The numeric portion of a course code: "COMP SCI 3800" -> 3800. */
export function courseLevel(code: string): number | null {
  const match = /(\d{3,4})\s*$/.exec(code.trim())
  return match ? Number(match[1]) : null
}

export function matchesRef(course: CompletedCourse, ref: CourseRef): boolean {
  switch (ref.kind) {
    case 'course':
      return course.code === ref.code
    case 'anyOf':
      return ref.codes.includes(course.code)
    case 'pattern': {
      if (course.subject !== ref.subject) return false
      if (ref.exclude?.includes(course.code)) return false
      const level = courseLevel(course.code)
      if (ref.minLevel !== undefined && (level === null || level < ref.minLevel)) return false
      if (ref.maxLevel !== undefined && (level === null || level > ref.maxLevel)) return false
      return true
    }
  }
}

function matchesAny(course: CompletedCourse, refs: readonly CourseRef[] | undefined): boolean {
  return (refs ?? []).some((ref) => matchesRef(course, ref))
}

// ───────────────────────────── working state ─────────────────────────────

interface OpenRequirement {
  block: RequirementBlock
  requirement: Requirement
  /** Credits still needed. Falls to zero once filled. */
  remaining: number
}

interface Assignment {
  courseId: string
  blockId: string
  requirementId?: string
}

export interface AllocationResult {
  allocations: CourseAllocation[]
  electiveSlack: ElectiveSlack
  survivingCredits: number
  absorbedCredits: number
  orphanedCredits: number
  remaining: RemainingWork
  /**
   * Credits that ended up absorbed or orphaned even though some named
   * requirement was still open and would have accepted them.
   *
   * This is a local-optimality check, not a bound on the optimal assignment —
   * and it is the property greedy actually promises. A non-zero value means the
   * ordering genuinely dropped a credit on the floor, which is a bug. A crude
   * "could this course have matched anything" bound was tried first and proved
   * useless: it ignored that buckets have capacity, so it flagged courses that
   * had nowhere left to go.
   */
  misplacedCredits: number
}

/** Blocks a requirement can be drawn from, in allocation order. */
function orderedBlocks(program: Program): RequirementBlock[] {
  return [...program.blocks].sort((a, b) => a.priority - b.priority)
}

// ───────────────────────────── the allocator ─────────────────────────────

export function allocate(courses: readonly CompletedCourse[], program: Program): AllocationResult {
  const blocks = orderedBlocks(program)
  const assignment = new Map<string, Assignment>()
  const byId = new Map(courses.map((c) => [c.id, c]))

  // ── Pass 0: eligibility ──────────────────────────────────────────────────
  // A withdrawal, failure or unsatisfactory mark never fills a requirement, but
  // it was still attempted — which is why it keeps consuming aid runway even
  // though it earns nothing. Courses that fail a grade floor stay in the pool:
  // a D in a Computer Science course does not satisfy S&T's C-or-better rule
  // but is still free-elective credit.
  const usable = courses.filter((c) => c.earned)

  const isFree = (b: RequirementBlock) => b.kind === 'freeElective'
  const namedBlocks = blocks.filter((b) => !isFree(b))

  // ── Passes 1-3: named requirements, most-constrained first ───────────────
  const open: OpenRequirement[] = []
  for (const block of namedBlocks) {
    if (block.kind !== 'core' && block.kind !== 'chooseN') continue
    for (const requirement of block.requirements ?? []) {
      open.push({ block, requirement, remaining: requirement.credits })
    }
  }

  const eligibleFor = (req: OpenRequirement, course: CompletedCourse) =>
    !assignment.has(course.id) &&
    matchesRef(course, req.requirement.ref) &&
    meetsGradeFloor(course, req.requirement.minGrade ?? req.block.minGrade)

  const chooseNQuota = new Map<string, number>()
  for (const block of namedBlocks) {
    if (block.kind === 'chooseN') chooseNQuota.set(block.id, block.chooseN ?? 0)
  }
  const chooseNFilled = new Map<string, number>()

  // Sort requirements by how few held courses could possibly fill them. A
  // requirement only one course can satisfy must claim that course before a
  // broad bucket eats it. Ten lines, and the single highest-value heuristic
  // in the engine.
  const candidateCount = (req: OpenRequirement) => usable.filter((c) => eligibleFor(req, c)).length
  const ranked = [...open].sort((a, b) => {
    const byCandidates = candidateCount(a) - candidateCount(b)
    if (byCandidates !== 0) return byCandidates
    return a.block.priority - b.block.priority
  })

  for (const req of ranked) {
    if (req.remaining <= 0) continue
    if (req.block.kind === 'chooseN') {
      const quota = chooseNQuota.get(req.block.id) ?? 0
      if ((chooseNFilled.get(req.block.id) ?? 0) >= quota) continue
    }
    // Among eligible courses prefer the one with the fewest alternative homes,
    // then the better grade, then the earlier term.
    const candidates = usable
      .filter((c) => eligibleFor(req, c))
      .sort((a, b) => {
        const homesA = ranked.filter((r) => r !== req && eligibleFor(r, a)).length
        const homesB = ranked.filter((r) => r !== req && eligibleFor(r, b)).length
        if (homesA !== homesB) return homesA - homesB
        const gradeA = GRADE_RANK[a.grade] ?? -1
        const gradeB = GRADE_RANK[b.grade] ?? -1
        if (gradeA !== gradeB) return gradeB - gradeA
        return a.term.year - b.term.year
      })

    const picked = candidates[0]
    if (!picked) continue
    assignment.set(picked.id, {
      courseId: picked.id,
      blockId: req.block.id,
      requirementId: req.requirement.id,
    })
    req.remaining = 0
    if (req.block.kind === 'chooseN') {
      chooseNFilled.set(req.block.id, (chooseNFilled.get(req.block.id) ?? 0) + 1)
    }
  }

  // ── Pass 4: credit buckets, largest course first ─────────────────────────
  const bucketFilled = new Map<string, number>()
  for (const block of namedBlocks) {
    if (block.kind !== 'creditBucket') continue
    const need = block.minCredits ?? 0
    let filled = 0
    const candidates = usable
      .filter((c) => !assignment.has(c.id) && matchesAny(c, block.accepts) && meetsGradeFloor(c, block.minGrade))
      .sort((a, b) => b.credits - a.credits)
    for (const course of candidates) {
      if (filled >= need) break
      assignment.set(course.id, { courseId: course.id, blockId: block.id })
      filled += course.credits
    }
    bucketFilled.set(block.id, filled)
  }

  // ── Pass 5: free-elective absorption, the EAB layer ──────────────────────
  const freeBlock = blocks.find(isFree)
  const capacity = freeBlock?.capacityCredits ?? 0
  let absorbed = 0
  let overflow = 0
  const orphanReason = new Map<string, 'electiveCapacityFull' | 'gradeTooLow' | 'notApplicable'>()

  // Oldest first, so the fate list reads chronologically.
  const leftovers = usable
    .filter((c) => !assignment.has(c.id))
    .sort((a, b) => a.term.year - b.term.year || a.code.localeCompare(b.code))

  for (const course of leftovers) {
    if (freeBlock && absorbed + course.credits <= capacity) {
      assignment.set(course.id, { courseId: course.id, blockId: freeBlock.id })
      absorbed += course.credits
    } else {
      overflow += course.credits
      orphanReason.set(course.id, freeBlock ? 'electiveCapacityFull' : 'notApplicable')
    }
  }

  // ── Pass 6: build the fate list ──────────────────────────────────────────
  const blockById = new Map(blocks.map((b) => [b.id, b]))
  const requirementById = new Map<string, Requirement>()
  for (const block of blocks) for (const r of block.requirements ?? []) requirementById.set(r.id, r)

  const allocations: CourseAllocation[] = courses.map((course) => {
    const placed = assignment.get(course.id)
    if (!placed) {
      const reason =
        !course.earned
          ? 'notApplicable'
          : (orphanReason.get(course.id) ?? 'notApplicable')
      return { courseId: course.id, code: course.code, credits: course.credits, fate: { kind: 'orphaned', reason } }
    }
    const block = blockById.get(placed.blockId)!
    if (placed.requirementId) {
      const requirement = requirementById.get(placed.requirementId)!
      return {
        courseId: course.id,
        code: course.code,
        credits: course.credits,
        fate: {
          kind: 'satisfies',
          requirementId: requirement.id,
          blockId: block.id,
          blockLabel: block.label,
          requirementLabel: requirement.label,
        },
      }
    }
    // A credit bucket is a named degree requirement, so filling one satisfies
    // the degree; only the free-elective block is absorption.
    if (isFree(block)) {
      return {
        courseId: course.id,
        code: course.code,
        credits: course.credits,
        fate: { kind: 'absorbed', blockId: block.id, blockLabel: block.label },
      }
    }
    return {
      courseId: course.id,
      code: course.code,
      credits: course.credits,
      fate: {
        kind: 'satisfies',
        requirementId: block.id,
        blockId: block.id,
        blockLabel: block.label,
        requirementLabel: block.label,
      },
    }
  })

  const creditsWhere = (predicate: (a: CourseAllocation) => boolean) =>
    allocations.filter(predicate).reduce((sum, a) => sum + a.credits, 0)

  const absorbedCredits = creditsWhere((a) => a.fate.kind === 'absorbed')
  const satisfiesCredits = creditsWhere((a) => a.fate.kind === 'satisfies')
  const orphanedCredits = creditsWhere((a) => a.fate.kind === 'orphaned')

  // ── Remaining work ───────────────────────────────────────────────────────
  const remainingBlocks: RemainingWork['blocks'] = []
  let addedByGenEdSwitch = 0

  for (const block of blocks) {
    let credits = 0
    const items: string[] = []
    if (block.kind === 'core') {
      for (const requirement of block.requirements ?? []) {
        const filled = [...assignment.values()].some((a) => a.requirementId === requirement.id)
        if (!filled) {
          credits += requirement.credits
          items.push(requirement.label)
        }
      }
    } else if (block.kind === 'chooseN') {
      const need = block.chooseN ?? 0
      const got = chooseNFilled.get(block.id) ?? 0
      const shortfall = Math.max(0, need - got)
      if (shortfall > 0) {
        const cheapest = [...(block.requirements ?? [])].sort((a, b) => a.credits - b.credits)
        credits += cheapest.slice(0, shortfall).reduce((sum, r) => sum + r.credits, 0)
        items.push(`${shortfall} more from ${block.label}`)
      }
    } else if (block.kind === 'creditBucket') {
      const shortfall = Math.max(0, (block.minCredits ?? 0) - (bucketFilled.get(block.id) ?? 0))
      if (shortfall > 0) {
        credits += shortfall
        items.push(`${shortfall} credits of ${block.label}`)
      }
    }
    if (credits > 0) {
      remainingBlocks.push({ blockId: block.id, label: block.label, credits, items })
      // The general-education shortfall falls out of the allocation rather than
      // being asserted: buckets the source program never required simply come
      // back unfilled. That is why isGenEd is a tag and not an addition.
      if (block.isGenEd) addedByGenEdSwitch += credits
    }
  }

  const remaining: RemainingWork = {
    blocks: remainingBlocks,
    totalCredits: remainingBlocks.reduce((sum, b) => sum + b.credits, 0),
    addedByGenEdSwitch,
  }

  // Local-optimality check. For every credit that did not fill a named
  // requirement, was there a requirement still OPEN that would have taken it?
  // Greedy guarantees there is not; anything else is a real defect.
  const filledRequirementIds = new Set(
    [...assignment.values()].map((a) => a.requirementId).filter(Boolean) as string[],
  )
  const stillOpen = open.filter((r) => !filledRequirementIds.has(r.requirement.id))
  const bucketHasRoom = (b: RequirementBlock) => (bucketFilled.get(b.id) ?? 0) < (b.minCredits ?? 0)
  const openBuckets = namedBlocks.filter((b) => b.kind === 'creditBucket' && bucketHasRoom(b))

  const misplacedCredits = allocations
    .filter((a) => a.fate.kind !== 'satisfies')
    .filter((a) => {
      const course = byId.get(a.courseId)
      if (!course?.earned) return false
      const fitsOpenRequirement = stillOpen.some((r) => {
        if (r.block.kind === 'chooseN') {
          const quota = chooseNQuota.get(r.block.id) ?? 0
          if ((chooseNFilled.get(r.block.id) ?? 0) >= quota) return false
        }
        return (
          matchesRef(course, r.requirement.ref) &&
          meetsGradeFloor(course, r.requirement.minGrade ?? r.block.minGrade)
        )
      })
      const fitsOpenBucket = openBuckets.some(
        (b) => matchesAny(course, b.accepts) && meetsGradeFloor(course, b.minGrade),
      )
      return fitsOpenRequirement || fitsOpenBucket
    })
    .reduce((sum, a) => sum + a.credits, 0)

  return {
    allocations,
    electiveSlack: {
      capacityCredits: capacity,
      usedCredits: absorbed,
      remainingCredits: Math.max(0, capacity - absorbed),
      overflowCredits: overflow,
    },
    survivingCredits: satisfiesCredits + absorbedCredits,
    absorbedCredits,
    orphanedCredits,
    remaining,
    misplacedCredits,
  }
}

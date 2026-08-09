/**
 * Loads and validates every hand-authored data file at module load.
 *
 * Validation happens on import, not on demand, so a malformed catalog file
 * fails immediately in dev and fails the test suite in CI — which, because
 * `build` runs vitest first, means it cannot reach production.
 */
import { z } from 'zod'
import type { Citation, GenEdFramework, Program, School } from '../domain/types.ts'
import { genEdFrameworkSchema, programSchema, schoolSchema } from './schema.ts'

import mstJson from './schools/mst.json'
import mstGenEd31Json from './geneds/mst-gened31.json'
import core42Json from './geneds/mo-core42.json'

import mstComputerScienceJson from './programs/mst-computer-science.json'

/**
 * On disk a school file carries no gen-ed frameworks; those live in their own
 * files so two schools in the same state can share CORE 42. The composed
 * School object holds them, so the engine only ever sees one shape.
 */
const schoolFileSchema = schoolSchema.omit({ genEdFrameworks: true })

function parseOrThrow<T extends z.ZodType>(schema: T, value: unknown, what: string): z.infer<T> {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new Error(`${what} failed validation:\n${z.prettifyError(result.error)}`)
  }
  return result.data
}

// ── gen-ed frameworks ──────────────────────────────────────────────────────

const GEN_ED_FILES: readonly unknown[] = [mstGenEd31Json, core42Json]

export const genEdFrameworks: Record<string, GenEdFramework> = Object.fromEntries(
  GEN_ED_FILES.map((file) => {
    const parsed = parseOrThrow(genEdFrameworkSchema, file, 'gen-ed framework')
    return [parsed.id, parsed as GenEdFramework]
  }),
)

// ── schools ────────────────────────────────────────────────────────────────

const SCHOOL_FILES: readonly unknown[] = [mstJson]

export const schools: Record<string, School> = Object.fromEntries(
  SCHOOL_FILES.map((file) => {
    const parsed = parseOrThrow(schoolFileSchema, file, 'school')
    const composed = { ...parsed, genEdFrameworks } as School
    return [composed.id, composed]
  }),
)

// ── programs ───────────────────────────────────────────────────────────────

/** Populated as each S&T major is transformed from the catalog. */
const PROGRAM_FILES: readonly unknown[] = [mstComputerScienceJson]

export const programs: Record<string, Program> = Object.fromEntries(
  PROGRAM_FILES.map((file) => {
    const parsed = parseOrThrow(programSchema, file, 'program')
    return [parsed.id, parsed as Program]
  }),
)

// ── lookups ────────────────────────────────────────────────────────────────

export function getSchool(id: string): School {
  const school = schools[id]
  if (!school) throw new Error(`unknown school "${id}"`)
  return school
}

export function getProgram(id: string): Program {
  const program = programs[id]
  if (!program) throw new Error(`unknown program "${id}"`)
  return program
}

export function getGenEdFramework(id: string): GenEdFramework {
  const framework = genEdFrameworks[id]
  if (!framework) throw new Error(`unknown gen-ed framework "${id}"`)
  return framework
}

export function programsForSchool(schoolId: string): Program[] {
  return Object.values(programs).filter((p) => p.schoolId === schoolId)
}

/** Every citation a path's rendered numbers depend on, deduplicated. */
export function citationsFor(schoolId: string, programIds: string[]): Citation[] {
  const school = getSchool(schoolId)
  const wanted = new Set<string>()

  for (const key of ['tuition', 'fees', 'sap', 'pell'] as const) {
    wanted.add(school[key].citationId)
  }
  for (const aid of [...school.institutionalAid, ...school.stateAid]) wanted.add(aid.citationId)
  if (school.excessCreditSurcharge) wanted.add(school.excessCreditSurcharge.citationId)
  if (school.gradRates) wanted.add(school.gradRates.citationId)

  for (const programId of programIds) {
    const program = getProgram(programId)
    wanted.add(program.citationId)
    const genEd = getGenEdFramework(program.genEdFrameworkId)
    wanted.add(genEd.citationId)
    for (const block of [...genEd.blocks, ...program.blocks]) {
      if (block.citationId) wanted.add(block.citationId)
      for (const req of block.requirements ?? []) if (req.citationId) wanted.add(req.citationId)
    }
  }

  return [...wanted]
    .map((id) => school.citations[id])
    .filter((c): c is Citation => c !== undefined)
    .sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * Placeholders that have not been confirmed against their source yet. The UI
 * badges these loudly, and Day 10 registrar-proofing is not done until this
 * returns empty for every school.
 */
export function unverifiedCitations(schoolId: string): Citation[] {
  return Object.values(getSchool(schoolId).citations).filter((c) => c.unverified === true)
}

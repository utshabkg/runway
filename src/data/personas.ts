/**
 * Demo students.
 *
 * SYNTHETIC. Every one of these is invented. Official Rules §8 forbids putting
 * institutional data, student records or anyone else's personal information in
 * a submission, and a tool about financial aid has no business demonstrating
 * itself on a real transcript regardless.
 *
 * The courses and credit hours are real Missouri S&T courses at their catalog
 * credit values, so the allocation a judge sees is genuine even though the
 * student is not.
 *
 * These are also the zero-network path: a judge clicking a persona never
 * touches the API, so the demo works with the serverless function down.
 */
import type { CompletedCourse, Grade, Term, Transcript } from '../domain/types.ts'

export interface Persona {
  id: string
  name: string
  /** One line a judge reads before clicking. */
  blurb: string
  /** The question this student is actually asking. */
  question: string
  transcript: Transcript
  stayProgramId: string
  switchProgramId: string
  /** Present when the decision is a co-op rather than a major change: both
   *  paths run the same program and only one of them steps out for a term. */
  coop?: { startAfterTerms: number; termCount: number }
  load: number
}

const FS24: Term = { year: 2024, season: 'FS' }
const SP25: Term = { year: 2025, season: 'SP' }
const FS25: Term = { year: 2025, season: 'FS' }
const SP26: Term = { year: 2026, season: 'SP' }
const NOW: Term = { year: 2026, season: 'FS' }

let seq = 0
function c(code: string, credits: number, grade: Grade, term: Term): CompletedCourse {
  const earned = !['F', 'W', 'U', 'I'].includes(grade)
  const points: Partial<Record<Grade, number>> = {
    A: 4, 'A-': 3.7, 'B+': 3.3, B: 3, 'B-': 2.7, 'C+': 2.3, C: 2, 'C-': 1.7, D: 1, F: 0,
  }
  return {
    id: `p${seq++}`,
    code,
    subject: code.replace(/\s+\d.*$/, '').trim(),
    title: code,
    credits,
    grade,
    term,
    earned,
    attempted: true,
    gradePoints: points[grade] ?? null,
    source: 'persona',
  }
}

function transcript(courses: CompletedCourse[], extra: Partial<Transcript> = {}): Transcript {
  return {
    schoolId: 'mst',
    courses,
    transferCredits: 0,
    acceleratedCredits: 0,
    asOfTerm: NOW,
    firstEnrolledTerm: FS24,
    residency: 'in-state',
    pellSemestersUsedFTE: 4,
    institutionalScholarshipSemestersUsed: 4,
    ...extra,
  }
}

export const PERSONAS: Persona[] = [
  {
    id: 'jordan',
    name: 'Jordan',
    blurb: 'Mechanical Engineering junior, 62 hours done, thinking about Psychology.',
    question: 'Everyone says switching this late will cost me a fortune. Will it?',
    stayProgramId: 'mst-mechanical-engineering',
    switchProgramId: 'mst-psychology',
    load: 15,
    transcript: transcript([
      c('CHEM 1305', 4, 'B', FS24), c('CHEM 1319', 1, 'A', FS24),
      c('ENGLISH 1120', 3, 'A-', FS24), c('FR ENG 1100', 1, 'A', FS24),
      c('MATH 1214', 4, 'B-', FS24), c('HISTORY 1300', 3, 'B+', FS24),
      c('MATH 1215', 4, 'C+', SP25), c('MECH ENG 1720', 3, 'B', SP25),
      c('PHYSICS 1135', 4, 'C', SP25), c('PHILOS 1105', 3, 'A', SP25),
      c('CIV ENG 2200', 3, 'C', FS25), c('MATH 2222', 4, 'C-', FS25),
      c('MECH ENG 1761', 1, 'B', FS25), c('MECH ENG 2653', 3, 'C', FS25),
      c('PHYSICS 2135', 4, 'D', FS25),
      c('MATH 3304', 3, 'C', SP26), c('MECH ENG 2360', 3, 'C-', SP26),
      c('MECH ENG 2519', 3, 'B-', SP26), c('MECH ENG 2761', 2, 'B', SP26),
      c('MET ENG 2110', 3, 'C+', SP26), c('COMP SCI 1570', 3, 'B+', SP26),
    ]),
  },
  {
    id: 'sam',
    name: 'Sam',
    blurb: 'Psychology sophomore, 31 hours done, thinking about Computer Science.',
    // Deliberately the inverse of Jordan: this switch runs Rate 1 to Rate 3
    // and into a program with 7 hours of elective capacity instead of 29.
    // A tool that only ever says "switch" is not measuring anything.
    question: 'Switching into engineering-priced CS — what does that actually cost me?',
    stayProgramId: 'mst-psychology',
    switchProgramId: 'mst-computer-science',
    load: 15,
    transcript: transcript(
      [
        c('ENGLISH 1120', 3, 'B', FS24), c('MATH 1214', 4, 'B', FS24),
        c('CHEM 1305', 4, 'C+', FS24), c('CHEM 1319', 1, 'B', FS24),
        c('POL SCI 1200', 3, 'A-', FS24),
        c('ENGLISH 1160', 3, 'B+', SP25), c('MATH 1215', 4, 'C', SP25),
        c('PSYCH 1101', 3, 'A', SP25), c('ECON 1100', 3, 'B', SP25),
        c('SP&M S 1185', 3, 'B+', SP25),
      ],
      { pellSemestersUsedFTE: 2, institutionalScholarshipSemestersUsed: 2 },
    ),
  },
  {
    id: 'alex',
    name: 'Alex',
    blurb: 'Computer Science junior weighing a co-op against finishing straight through.',
    question: 'If I take a co-op semester, what does it actually cost me?',
    stayProgramId: 'mst-computer-science',
    switchProgramId: 'mst-computer-science',
    coop: { startAfterTerms: 1, termCount: 1 },
    load: 15,
    transcript: transcript([
      c('COMP SCI 1010', 1, 'A', FS24), c('COMP SCI 1500', 3, 'B+', FS24),
      c('ENGLISH 1120', 3, 'B', FS24), c('FR ENG 1100', 1, 'A', FS24),
      c('MATH 1214', 4, 'B', FS24), c('CHEM 1305', 4, 'C+', FS24),
      c('COMP SCI 1200', 3, 'A-', SP25), c('COMP SCI 1570', 3, 'B', SP25),
      c('COMP SCI 1580', 1, 'A', SP25), c('ENGLISH 1160', 3, 'B', SP25),
      c('HISTORY 1310', 3, 'B-', SP25), c('MATH 1215', 4, 'C+', SP25),
      c('COMP ENG 2210', 3, 'B', FS25), c('COMP SCI 1575', 3, 'B+', FS25),
      c('COMP SCI 1585', 1, 'A', FS25), c('MATH 3108', 3, 'C+', FS25),
      c('PHYSICS 1135', 4, 'C', FS25),
      c('COMP SCI 2300', 3, 'B', SP26), c('COMP SCI 2500', 3, 'B-', SP26),
      c('COMP SCI 2580', 1, 'A-', SP26), c('PHILOS 3225', 3, 'B+', SP26),
      c('STAT 3113', 3, 'C+', SP26),
    ]),
  },
]

export function personaById(id: string): Persona | undefined {
  return PERSONAS.find((p) => p.id === id)
}

/** The term every persona is "now" at. Injected into the engine so the demo
 *  cannot drift when the real semester rolls over. */
export const DEMO_NOW: Term = NOW

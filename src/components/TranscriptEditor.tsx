/**
 * Paste a transcript, check what came back, fix anything wrong.
 *
 * The editable table is ALWAYS shown — the parse result is never applied
 * silently. That turns the failure mode into a feature: a student who can see
 * and correct the rows trusts the numbers downstream, and a parse that goes
 * badly costs them a few keystrokes rather than a dead end.
 *
 * Three ways in, in decreasing order of convenience and increasing order of
 * reliability: the model, a regex, and typing. None of them can leave the user
 * stuck.
 */
import { useState } from 'react'
import type { CompletedCourse, Grade, Season, Term } from '../domain/types.ts'

const GRADES: Grade[] = [
  'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F', 'W', 'I', 'S', 'U', 'TR', 'CR',
]
const EARNED_FAILS: Grade[] = ['F', 'W', 'U', 'I']
const POINTS: Partial<Record<Grade, number>> = {
  A: 4, 'A-': 3.7, 'B+': 3.3, B: 3, 'B-': 2.7, 'C+': 2.3, C: 2, 'C-': 1.7, 'D+': 1.3, D: 1, 'D-': 0.7, F: 0,
}

let nextId = 0
export function makeCourse(partial: Partial<CompletedCourse> = {}): CompletedCourse {
  const code = partial.code ?? ''
  const grade = partial.grade ?? 'B'
  return {
    id: `u${nextId++}`,
    code,
    subject: code.replace(/\s+\d.*$/, '').trim(),
    title: partial.title ?? code,
    credits: partial.credits ?? 3,
    grade,
    term: partial.term ?? { year: 2025, season: 'FS' },
    earned: !EARNED_FAILS.includes(grade),
    attempted: true,
    gradePoints: POINTS[grade] ?? null,
    source: partial.source ?? 'manual',
    ...(partial.confidence !== undefined ? { confidence: partial.confidence } : {}),
  }
}

/**
 * Last-resort extractor, used when the model is unavailable or declines.
 * Deliberately crude: it only has to get enough rows on screen that correcting
 * them beats typing from scratch.
 */
export function regexExtract(text: string): CompletedCourse[] {
  const rows: CompletedCourse[] = []
  // Grades are ordered LONGEST FIRST and carry no trailing \b. Alternation is
  // ordered, so a bare "A" would otherwise win against "A-"; and a word
  // boundary cannot exist after "A-" or "B+" at all, because the characters on
  // both sides of it are non-word. Getting that wrong silently drops every
  // plus and minus grade — which is most of a real transcript.
  const line =
    /^\s*([A-Z][A-Z&\s]{1,10}?)\s+(\d{3,4})\s+(.*?)\s+(\d{1,2}(?:\.\d)?)\s+.*?(A-|A|B\+|B-|B|C\+|C-|C|D\+|D-|D|F|W|I|S|U|TR|CR)\s*$/
  for (const raw of text.split('\n')) {
    const m = line.exec(raw)
    if (!m) continue
    rows.push(
      makeCourse({
        code: `${m[1]!.trim()} ${m[2]}`,
        title: m[3]!.trim(),
        credits: Number(m[4]),
        grade: m[5] as Grade,
        source: 'parsed',
        confidence: 0.5,
      }),
    )
  }
  return rows
}

interface ParsedRow {
  normalizedCode?: string
  printedCode?: string
  title?: string
  credits?: number
  grade?: string
  termYear?: number | null
  termSeason?: Season | null
  confidence?: number
}

function fromParsed(rows: ParsedRow[]): CompletedCourse[] {
  return rows.map((r) =>
    makeCourse({
      code: (r.normalizedCode ?? r.printedCode ?? '').toUpperCase().trim(),
      title: r.title ?? '',
      credits: Number(r.credits ?? 0),
      grade: (GRADES as string[]).includes(r.grade ?? '') ? (r.grade as Grade) : 'B',
      term: { year: r.termYear ?? 2025, season: r.termSeason ?? 'FS' },
      source: 'parsed',
      confidence: r.confidence ?? 0.5,
    }),
  )
}

export function TranscriptEditor({
  courses,
  onChange,
}: {
  courses: CompletedCourse[]
  onChange: (next: CompletedCourse[]) => void
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  async function parse() {
    setBusy(true)
    setNotice(null)
    try {
      const res = await fetch('/api/parse-transcript', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const data = await res.json()
      if (data?.ok && Array.isArray(data.courses) && data.courses.length > 0) {
        onChange(fromParsed(data.courses))
        const low = data.courses.filter((c: ParsedRow) => (c.confidence ?? 1) < 0.8).length
        setNotice(
          `Read ${data.courses.length} courses.` +
            (low > 0 ? ` ${low} need checking — they are marked below.` : ' Check them before you rely on the result.'),
        )
        return
      }
      throw new Error(data?.reason ?? 'unavailable')
    } catch {
      // Never a dead end: fall back to the regex, and to typing if that fails.
      const rows = regexExtract(text)
      onChange(rows)
      setNotice(
        rows.length > 0
          ? `Automatic reading was unavailable, so this is a rough pass: ${rows.length} courses. Check every row.`
          : 'Could not read that. Add your courses below by hand.',
      )
    } finally {
      setBusy(false)
    }
  }

  function update(id: string, patch: Partial<CompletedCourse>) {
    onChange(
      courses.map((c) => {
        if (c.id !== id) return c
        const merged = { ...c, ...patch }
        // Keep the derived fields honest: earned and grade points follow the
        // grade, and the SAP denominator depends on getting this right.
        merged.subject = merged.code.replace(/\s+\d.*$/, '').trim()
        merged.earned = !EARNED_FAILS.includes(merged.grade)
        merged.gradePoints = POINTS[merged.grade] ?? null
        return merged
      }),
    )
  }

  const attempted = courses.reduce((s, c) => s + c.credits, 0)
  const earned = courses.filter((c) => c.earned).reduce((s, c) => s + c.credits, 0)

  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <h3 className="font-display text-lg">Your own transcript</h3>
      <p className="mt-1 text-sm text-ink-2">
        Paste the course list from your unofficial transcript. It is read once to structure it and never stored.
        Student IDs and dates of birth are stripped before it is sent.
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        placeholder={'FALL 2024\nCOMP SCI 1570  Introduction To C++   3.0   B+\nMATH 1214      Calculus I           4.0   C'}
        className="mt-3 w-full rounded-lg border border-rule bg-plane p-3 font-mono text-xs"
        aria-label="Transcript text"
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={parse}
          disabled={busy || text.trim().length < 20}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-surface disabled:opacity-40"
        >
          {busy ? 'Reading…' : 'Read my transcript'}
        </button>
        <button
          type="button"
          onClick={() => onChange([...courses, makeCourse()])}
          className="rounded-lg border border-rule px-4 py-2 text-sm font-semibold"
        >
          Add a course by hand
        </button>
        {notice && <span className="text-sm text-ink-2">{notice}</span>}
      </div>

      {courses.length > 0 && (
        <>
          <table className="mt-5 w-full text-sm">
            <caption className="sr-only">Your courses. Every field is editable.</caption>
            <thead>
              <tr className="text-left text-xs tracking-wide text-muted uppercase">
                <th scope="col" className="py-1 pr-2">Course</th>
                <th scope="col" className="py-1 pr-2">Credits</th>
                <th scope="col" className="py-1 pr-2">Grade</th>
                <th scope="col" className="py-1 pr-2">Term</th>
                <th scope="col" className="py-1"><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {courses.map((c) => {
                const uncertain = (c.confidence ?? 1) < 0.8
                return (
                  <tr
                    key={c.id}
                    className="border-t border-line"
                    style={uncertain ? { borderLeft: '3px solid var(--color-warn)' } : undefined}
                  >
                    <td className="py-1 pr-2">
                      <input
                        value={c.code}
                        onChange={(e) => update(c.id, { code: e.target.value.toUpperCase() })}
                        aria-label="Course code"
                        className="w-40 rounded border border-line bg-plane px-2 py-1 font-mono text-xs"
                      />
                      {uncertain && <span className="ml-2 text-xs font-semibold text-muted">check this</span>}
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        type="number"
                        min={0}
                        max={20}
                        step={0.5}
                        value={c.credits}
                        onChange={(e) => update(c.id, { credits: Number(e.target.value) })}
                        aria-label="Credits"
                        className="w-16 rounded border border-line bg-plane px-2 py-1 text-xs tabular-nums"
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <select
                        value={c.grade}
                        onChange={(e) => update(c.id, { grade: e.target.value as Grade })}
                        aria-label="Grade"
                        className="rounded border border-line bg-plane px-2 py-1 text-xs"
                      >
                        {GRADES.map((g) => (
                          <option key={g} value={g}>{g}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1 pr-2">
                      <select
                        value={`${c.term.season}${c.term.year}`}
                        onChange={(e) => {
                          const season = e.target.value.slice(0, 2) as Season
                          const year = Number(e.target.value.slice(2))
                          update(c.id, { term: { year, season } as Term })
                        }}
                        aria-label="Term"
                        className="rounded border border-line bg-plane px-2 py-1 text-xs"
                      >
                        {[2022, 2023, 2024, 2025, 2026].flatMap((y) =>
                          (['SP', 'SU', 'FS'] as Season[]).map((s) => (
                            <option key={`${s}${y}`} value={`${s}${y}`}>{`${s} ${y}`}</option>
                          )),
                        )}
                      </select>
                    </td>
                    <td className="py-1 text-right">
                      <button
                        type="button"
                        onClick={() => onChange(courses.filter((x) => x.id !== c.id))}
                        aria-label={`Remove ${c.code}`}
                        className="px-2 text-muted hover:text-ink"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="mt-3 text-sm text-ink-2">
            <strong className="tabular-nums">{attempted}</strong> hours attempted,{' '}
            <strong className="tabular-nums">{earned}</strong> earned.{' '}
            {attempted !== earned && (
              <span className="text-muted">
                The difference is withdrawals and failures — they still count against your federal aid ceiling.
              </span>
            )}
          </p>
        </>
      )}
    </div>
  )
}

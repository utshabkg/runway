/**
 * Day 5 gate: an ugly but complete end-to-end. Pick a student, see both
 * futures, every number produced by the real engine from committed catalog
 * data. The design system lands on Day 7; this exists so the whole path is
 * proven on the live URL first.
 */
import { useMemo, useState } from 'react'
import { DEMO_NOW, PERSONAS, type Persona } from './data/personas.ts'
import { citationsFor, getProgram, getSchool, programsForSchool } from './data/registry.ts'
import { formatCents } from './domain/cost.ts'
import { simulate } from './domain/simulate.ts'
import { graduationLabel, termLabel } from './domain/terms.ts'
import type { PathProjection } from './domain/types.ts'

const school = getSchool('mst')
const programs = programsForSchool('mst')

function Row({ label, stay, sw, emphasis }: { label: string; stay: string; sw: string; emphasis?: boolean }) {
  return (
    <tr className={emphasis ? 'font-semibold' : undefined}>
      <th scope="row" className="border-b border-line py-2 pr-4 text-left font-normal text-muted">
        {label}
      </th>
      <td className="border-b border-line py-2 pr-4 text-right tabular-nums">{stay}</td>
      <td className="border-b border-line py-2 text-right tabular-nums">{sw}</td>
    </tr>
  )
}

function fates(path: PathProjection) {
  const satisfies = path.survivingCredits - path.absorbedCredits
  return { satisfies, absorbed: path.absorbedCredits, orphaned: path.orphanedCredits }
}

export default function App() {
  const [personaId, setPersonaId] = useState<string>(PERSONAS[0]!.id)
  const persona = PERSONAS.find((p) => p.id === personaId) as Persona
  const [switchTo, setSwitchTo] = useState<string>(persona.switchProgramId)

  const target = programs.some((p) => p.id === switchTo) ? switchTo : persona.switchProgramId

  const result = useMemo(
    () =>
      simulate(
        persona.transcript,
        getProgram(persona.stayProgramId),
        getProgram(target),
        school,
        {
          load: persona.load,
          includeSummer: false,
          now: DEMO_NOW,
          ...(persona.coop ? { switchCoop: persona.coop } : {}),
        },
        citationsFor('mst', [persona.stayProgramId, target]),
      ),
    [persona, target],
  )

  const stayF = fates(result.stay)
  const swF = fates(result.switch)
  const cheaper = result.delta.extraCost < 0
  const isCoop = Boolean(persona.coop)

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <p className="text-sm tracking-widest text-muted uppercase">Runway</p>
      <h1 className="mt-1 text-3xl font-semibold text-balance">
        Every academic decision spends from the same budget. Nobody shows you the balance.
      </h1>

      <section className="mt-8">
        <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">Try a student</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {PERSONAS.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setPersonaId(p.id)
                setSwitchTo(p.switchProgramId)
              }}
              className={`rounded-lg border p-3 text-left transition ${
                p.id === personaId ? 'border-ink bg-ink/5' : 'border-line hover:border-muted'
              }`}
            >
              <div className="font-semibold">{p.name}</div>
              <div className="mt-1 text-sm text-muted">{p.blurb}</div>
            </button>
          ))}
        </div>
        <p className="mt-4 text-lg italic">“{persona.question}”</p>
      </section>

      {!isCoop && (
        <section className="mt-8">
          <label htmlFor="target" className="text-sm font-semibold tracking-wide text-muted uppercase">
            Switch to
          </label>
          <select
            id="target"
            value={target}
            onChange={(e) => setSwitchTo(e.target.value)}
            className="mt-2 block w-full max-w-md rounded-lg border border-line bg-surface p-2"
          >
            {programs
              .filter((p) => p.id !== persona.stayProgramId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </section>
      )}

      <section className="mt-10">
        <table className="w-full text-sm">
          <caption className="mb-3 text-left text-lg font-semibold">
            {isCoop ? 'Straight through, or take the co-op' : 'Two futures'}
          </caption>
          <thead>
            <tr>
              <td />
              <th scope="col" className="border-b-2 border-stay py-2 pr-4 text-right">
                {isCoop ? 'Straight through' : `Stay: ${result.stay.programName}`}
              </th>
              <th scope="col" className="border-b-2 border-switch py-2 text-right">
                {isCoop ? 'With a co-op' : `Switch: ${result.switch.programName}`}
              </th>
            </tr>
          </thead>
          <tbody>
            <Row
              label="Graduate"
              stay={graduationLabel(result.stay.graduationTerm)}
              sw={graduationLabel(result.switch.graduationTerm)}
              emphasis
            />
            <Row
              label="Terms remaining"
              stay={String(result.stay.termsRemaining)}
              sw={String(result.switch.termsRemaining)}
            />
            <Row
              label="Cost to finish"
              stay={formatCents(result.stay.cost.grandTotal)}
              sw={formatCents(result.switch.cost.grandTotal)}
              emphasis
            />
            <Row
              label="Per full-time term"
              stay={formatCents(result.stay.cost.perTerm.find((t) => t.tuition > 0)?.total ?? 0)}
              sw={formatCents(result.switch.cost.perTerm.find((t) => t.tuition > 0)?.total ?? 0)}
            />
            <Row label="Credits that fill a requirement" stay={String(stayF.satisfies)} sw={String(swF.satisfies)} />
            <Row label="Credits absorbed as electives" stay={String(stayF.absorbed)} sw={String(swF.absorbed)} />
            <Row label="Credits genuinely orphaned" stay={String(stayF.orphaned)} sw={String(swF.orphaned)} emphasis />
            <Row
              label="Elective room left"
              stay={`${result.stay.electiveSlack.remainingCredits} of ${result.stay.electiveSlack.capacityCredits}`}
              sw={`${result.switch.electiveSlack.remainingCredits} of ${result.switch.electiveSlack.capacityCredits}`}
            />
            <Row
              label="Federal aid runway (attempted hrs)"
              stay={`${result.stay.aid.sap.headroomCredits} left of ${result.stay.aid.sap.ceiling}`}
              sw={`${result.switch.aid.sap.headroomCredits} left of ${result.switch.aid.sap.ceiling}`}
              emphasis
            />
            <Row
              label="Pell used at graduation"
              stay={`${result.stay.aid.pell.percentUsedAtGraduation}% of 600%`}
              sw={`${result.switch.aid.pell.percentUsedAtGraduation}% of 600%`}
            />
            <Row
              label="Scholarship semesters"
              stay={`${result.stay.aid.institutional[0]?.semestersAtGraduation ?? 0} of ${result.stay.aid.institutional[0]?.cap ?? 0}`}
              sw={`${result.switch.aid.institutional[0]?.semestersAtGraduation ?? 0} of ${result.switch.aid.institutional[0]?.cap ?? 0}`}
            />
          </tbody>
        </table>

        <p className="mt-4 text-lg">
          {isCoop ? 'The co-op ' : 'Switching '}
          <strong>{cheaper ? 'saves' : 'costs'} {formatCents(Math.abs(result.delta.extraCost))}</strong>
          {result.delta.extraTerms === 0
            ? ' and finishes in the same term.'
            : ` and takes ${Math.abs(result.delta.extraTerms)} ${Math.abs(result.delta.extraTerms) === 1 ? 'term' : 'terms'} ${result.delta.extraTerms > 0 ? 'longer' : 'less'}.`}
        </p>
      </section>

      {result.switch.aid.flags.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">Aid warnings</h2>
          <ul className="mt-2 space-y-2">
            {result.switch.aid.flags.map((f) => (
              <li key={f.id} className="rounded border-l-4 border-warn bg-warn/5 py-2 pl-3">
                <div className="font-semibold">{f.title}</div>
                <div className="text-sm text-muted">{f.detail}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!isCoop && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">When to switch</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {result.timing.map((t) => (
              <li key={t.switchAfterTerms} className="flex gap-3">
                <span className="w-40 text-muted">
                  {t.switchAfterTerms === 0 ? 'Now' : `Wait ${t.switchAfterTerms} (${termLabel(t.switchTerm)})`}
                </span>
                <span className="tabular-nums">{formatCents(t.totalCost)}</span>
                {t.switchAfterTerms > 0 && (
                  <span className="text-muted tabular-nums">+{formatCents(t.deltaCostVsNow)}</span>
                )}
                {t.isCliff && <span className="font-semibold text-warn">← a limit binds here</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">What this model assumes</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
          {result.switch.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </section>

      <section className="mt-8 mb-16">
        <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">Sources</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {result.citations.map((c) => (
            <li key={c.id}>
              <a href={c.url} className="underline hover:no-underline" target="_blank" rel="noreferrer">
                {c.label}
              </a>{' '}
              <span className="text-muted">— read {c.asOf}</span>
              {c.unverified && <span className="ml-2 font-semibold text-warn">UNVERIFIED</span>}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted">
          Runway prepares you for an advising conversation. It does not replace one, and it is not an official
          degree audit. Confirm every figure with your advisor and your financial aid office.
        </p>
      </section>
    </main>
  )
}

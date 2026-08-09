import { useEffect, useMemo, useState } from 'react'
import { CreditFateBar, ElectiveSlackMeter, RunwayGauge } from './components/Charts.tsx'
import { TranscriptEditor } from './components/TranscriptEditor.tsx'
import { DEMO_NOW, PERSONAS, type Persona } from './data/personas.ts'
import { citationsFor, getProgram, getSchool, programsForSchool } from './data/registry.ts'
import { formatCents } from './domain/cost.ts'
import { explainFallback } from './domain/explainFallback.ts'
import { simulate } from './domain/simulate.ts'
import { graduationLabel, termLabel } from './domain/terms.ts'
import type { CompletedCourse, Comparison, Explanation, PathProjection, Transcript } from './domain/types.ts'

const school = getSchool('mst')
const programs = programsForSchool('mst')

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div>
      <div className="text-xs tracking-wide text-muted uppercase">{label}</div>
      <div className="mt-1 font-display text-2xl leading-none" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-ink-2">{sub}</div>}
    </div>
  )
}

function PathCard({
  path,
  heading,
  accent,
  perTerm,
}: {
  path: PathProjection
  heading: string
  accent: string
  perTerm: string
}) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5" style={{ borderTopWidth: 3, borderTopColor: accent }}>
      <h3 className="font-display text-lg leading-tight">{heading}</h3>
      <p className="mt-0.5 text-sm text-muted">{path.programName}</p>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <Stat label="Graduate" value={graduationLabel(path.graduationTerm)} sub={`${path.termsRemaining} terms`} />
        <Stat label="Cost to finish" value={formatCents(path.cost.grandTotal)} sub={`${perTerm} per full term`} />
      </div>

      <h4 className="mt-5 text-xs tracking-wide text-muted uppercase">What happens to the work you have done</h4>
      <CreditFateBar path={path} />
      <ElectiveSlackMeter slack={path.electiveSlack} />
      <RunwayGauge path={path} />
    </section>
  )
}

export default function App() {
  const [personaId, setPersonaId] = useState(PERSONAS[0]!.id)
  const persona = PERSONAS.find((p) => p.id === personaId) as Persona
  const [switchTo, setSwitchTo] = useState(persona.switchProgramId)

  // Own-transcript mode. Kept beside the personas rather than replacing them:
  // a judge should reach a full result in one click, and only then discover
  // they can run their own.
  const [own, setOwn] = useState<CompletedCourse[] | null>(null)
  const [ownStay, setOwnStay] = useState(programs[0]!.id)
  const usingOwn = own !== null

  const stayProgramId = usingOwn ? ownStay : persona.stayProgramId
  const fallbackTarget = usingOwn
    ? (programs.find((p) => p.id !== ownStay)!.id)
    : persona.switchProgramId
  const target = programs.some((p) => p.id === switchTo) && switchTo !== stayProgramId ? switchTo : fallbackTarget
  const isCoop = !usingOwn && Boolean(persona.coop)

  const transcript: Transcript = useMemo(
    () => (usingOwn ? { ...persona.transcript, courses: own } : persona.transcript),
    [usingOwn, own, persona],
  )

  const result: Comparison = useMemo(
    () =>
      simulate(
        transcript,
        getProgram(stayProgramId),
        getProgram(target),
        school,
        {
          load: persona.load,
          includeSummer: false,
          now: DEMO_NOW,
          ...(isCoop && persona.coop ? { switchCoop: persona.coop } : {}),
        },
        citationsFor('mst', [stayProgramId, target]),
      ),
    [transcript, stayProgramId, target, persona, isCoop],
  )

  // The deterministic explanation renders immediately; Claude upgrades it in
  // place if it answers. Nothing ever waits on the network.
  const fallback = useMemo(() => explainFallback(result, isCoop), [result, isCoop])
  const [explanation, setExplanation] = useState<Explanation>(fallback)

  useEffect(() => {
    setExplanation(fallback)
    let live = true
    const controller = new AbortController()
    fetch('/api/explain', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ comparison: result, isCoop }),
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (live && data?.ok && typeof data.explanation === 'string' && Array.isArray(data.questions)) {
          setExplanation({ explanation: data.explanation, questions: data.questions, source: 'claude' })
        }
      })
      .catch(() => {
        /* The fallback is already on screen. */
      })
    return () => {
      live = false
      controller.abort()
    }
  }, [result, fallback, isCoop])

  const cheaper = result.delta.extraCost < 0
  const stayPerTerm = formatCents(result.stay.cost.perTerm.find((t) => t.tuition > 0)?.total ?? 0)
  const swPerTerm = formatCents(result.switch.cost.perTerm.find((t) => t.tuition > 0)?.total ?? 0)

  return (
    <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
      <header>
        <p className="text-xs tracking-[0.2em] text-muted uppercase">Runway</p>
        <h1 className="mt-2 max-w-3xl font-display text-3xl leading-[1.15] text-balance sm:text-4xl">
          Every academic decision spends from the same budget. Nobody shows you the balance.
        </h1>
        <p className="mt-3 max-w-2xl text-ink-2">
          Attempted credits, aid semesters, scholarship terms, dollars. Missouri University of Science and
          Technology.
        </p>
      </header>

      <section className="no-print mt-8">
        <h2 className="text-xs tracking-wide text-muted uppercase">Try a student</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {PERSONAS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={p.id === personaId && !usingOwn}
              onClick={() => {
                setPersonaId(p.id)
                setSwitchTo(p.switchProgramId)
                setOwn(null)
              }}
              className={`rounded-xl border p-4 text-left transition ${
                p.id === personaId && !usingOwn
                  ? 'border-ink bg-surface shadow-sm'
                  : 'border-line bg-surface/60 hover:border-rule'
              }`}
            >
              <div className="font-display text-lg">{p.name}</div>
              <div className="mt-1 text-sm text-ink-2">{p.blurb}</div>
            </button>
          ))}
        </div>
      </section>

      {!usingOwn && (
        <p className="mt-6 max-w-2xl font-display text-xl leading-snug">“{persona.question}”</p>
      )}

      <section className="no-print mt-6">
        {!usingOwn ? (
          <button
            type="button"
            onClick={() => setOwn([])}
            className="text-sm font-semibold underline hover:no-underline"
          >
            Or use your own transcript
          </button>
        ) : (
          <>
            <TranscriptEditor courses={own} onChange={setOwn} />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label htmlFor="stay" className="text-sm text-ink-2">
                Currently in
              </label>
              <select
                id="stay"
                value={ownStay}
                onChange={(e) => setOwnStay(e.target.value)}
                className="rounded-lg border border-rule bg-surface px-3 py-1.5 text-sm"
              >
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setOwn(null)}
                className="text-sm underline hover:no-underline"
              >
                back to the demo students
              </button>
            </div>
          </>
        )}
      </section>

      {!isCoop && (
        <div className="no-print mt-5 flex flex-wrap items-center gap-3">
          <label htmlFor="target" className="text-sm text-ink-2">
            Switch to
          </label>
          <select
            id="target"
            value={target}
            onChange={(e) => setSwitchTo(e.target.value)}
            className="rounded-lg border border-rule bg-surface px-3 py-1.5 text-sm"
          >
            {programs
              .filter((p) => p.id !== stayProgramId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </div>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <PathCard
          path={result.stay}
          heading={isCoop ? 'Straight through' : 'Stay'}
          accent="var(--color-stay)"
          perTerm={stayPerTerm}
        />
        <PathCard
          path={result.switch}
          heading={isCoop ? 'Take the co-op' : 'Switch'}
          accent="var(--color-switch)"
          perTerm={swPerTerm}
        />
      </div>

      <section className="mt-6 rounded-xl border border-line bg-surface p-5">
        <p className="font-display text-2xl leading-snug">
          {isCoop ? 'The co-op ' : 'Switching '}
          <strong style={{ color: cheaper ? 'var(--color-good)' : 'var(--color-switch)' }}>
            {cheaper ? 'saves' : 'costs'} {formatCents(Math.abs(result.delta.extraCost))}
          </strong>
          {result.delta.extraTerms === 0
            ? ' and finishes in the same term.'
            : ` and takes ${Math.abs(result.delta.extraTerms)} ${
                Math.abs(result.delta.extraTerms) === 1 ? 'term' : 'terms'
              } ${result.delta.extraTerms > 0 ? 'longer' : 'less'}.`}
        </p>
        <div className="mt-4 space-y-3 text-ink-2">
          {explanation.explanation.split('\n\n').map((p) => (
            <p key={p.slice(0, 40)}>{p}</p>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">
          {explanation.source === 'claude'
            ? 'Written by Claude from the numbers above. Claude never computes them.'
            : 'Written from the numbers above by the engine itself.'}
        </p>
      </section>

      {result.switch.aid.flags.length > 0 && (
        <section className="mt-6">
          <h2 className="text-xs tracking-wide text-muted uppercase">Watch out for</h2>
          <ul className="mt-2 space-y-2">
            {result.switch.aid.flags.map((f) => (
              <li
                key={f.id}
                className="rounded-lg border border-line bg-surface p-3"
                style={{ borderLeftWidth: 4, borderLeftColor: f.severity === 'critical' ? 'var(--color-critical)' : 'var(--color-serious)' }}
              >
                <div className="flex items-baseline gap-2">
                  <span aria-hidden>{f.severity === 'critical' ? '⚠' : '!'}</span>
                  <span className="font-semibold">{f.title}</span>
                </div>
                <p className="mt-1 text-sm text-ink-2">{f.detail}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!isCoop && (
        <section className="mt-6 rounded-xl border border-line bg-surface p-5">
          <h2 className="text-xs tracking-wide text-muted uppercase">When to decide</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {result.timing.map((t) => (
              <li key={t.switchAfterTerms} className="flex flex-wrap items-baseline gap-x-3">
                <span className="w-36 text-ink-2">
                  {t.switchAfterTerms === 0 ? 'Decide now' : `Wait until ${termLabel(t.switchTerm)}`}
                </span>
                <span className="font-semibold tabular-nums">{formatCents(t.totalCost)}</span>
                {t.switchAfterTerms > 0 && (
                  <span className="text-muted tabular-nums">+{formatCents(t.deltaCostVsNow)}</span>
                )}
                {t.isCliff && t.newlyBindingConstraints.length > 0 && (
                  <span className="text-xs font-semibold" style={{ color: 'var(--color-serious)' }}>
                    a limit binds here
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6 rounded-xl border border-line bg-surface p-5">
        <h2 className="font-display text-xl">Take these to your advisor</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-ink-2">
          {explanation.questions.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ol>
        <button
          type="button"
          onClick={() => window.print()}
          className="no-print mt-4 rounded-lg border border-rule px-4 py-2 text-sm font-semibold hover:bg-plane"
        >
          Print this page for advising
        </button>
      </section>

      <section className="mt-6">
        <h2 className="text-xs tracking-wide text-muted uppercase">What this model assumes</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-2">
          {result.switch.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </section>

      <section className="sources mt-6 mb-16">
        <h2 className="text-xs tracking-wide text-muted uppercase">Every number above came from here</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {result.citations.map((c) => (
            <li key={c.id}>
              <a href={c.url} target="_blank" rel="noreferrer" className="underline hover:no-underline">
                {c.label}
              </a>
              <span className="text-muted"> — read {c.asOf}</span>
              {c.unverified && (
                <span className="ml-2 rounded px-1.5 py-0.5 text-xs font-semibold" style={{ background: 'var(--color-warn)', color: '#0b0b0b' }}>
                  UNVERIFIED
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-4 max-w-2xl text-sm text-muted">
          Runway prepares you for an advising conversation. It does not replace one, and it is not an official
          degree audit. Confirm every figure with your advisor and your financial aid office.
        </p>
      </section>
    </div>
  )
}

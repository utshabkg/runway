/**
 * Hand-written SVG. No charting library: there are three small bespoke visuals
 * here and the annotation layer is the part that carries the meaning, which is
 * exactly what a library fights you on.
 *
 * The palette came out of the data-viz validator, not out of taste. Credit fate
 * is an ORDINAL ramp — one hue, monotone lightness — because the categories are
 * ordered by how much they count. Orphaned credit is NEUTRAL, not red: a credit
 * that does not count is inert, and painting it as a failure would argue the
 * opposite of what the evidence says about switching majors.
 */
import type { ElectiveSlack, PathProjection } from '../domain/types.ts'

const GAP = 2 // surface gap between stacked segments, per the mark spec

interface Segment {
  label: string
  value: number
  fill: string
  hint: string
}

/** Ordered worst-to-best is wrong here: the reader wants the good news first,
 *  and the ordering is the argument. */
function segmentsFor(path: PathProjection): Segment[] {
  const satisfies = path.survivingCredits - path.absorbedCredits
  return [
    {
      label: 'Fills a requirement',
      value: satisfies,
      fill: 'var(--color-fate-satisfies)',
      hint: `${satisfies} hours count directly toward ${path.programName}.`,
    },
    {
      label: 'Absorbed as elective',
      value: path.absorbedCredits,
      fill: 'var(--color-fate-absorbed)',
      hint: `${path.absorbedCredits} hours still count, using the program's elective room.`,
    },
    {
      label: 'Does not count',
      value: path.orphanedCredits,
      fill: 'var(--color-fate-orphaned)',
      hint:
        path.electiveSlack.capacityCredits === 0
          ? `${path.orphanedCredits} hours have nowhere to go: this program has no elective room at all.`
          : `${path.orphanedCredits} hours exceed the program's ${path.electiveSlack.capacityCredits} elective hours.`,
    },
  ].filter((s) => s.value > 0)
}

export function CreditFateBar({ path, height = 34 }: { path: PathProjection; height?: number }) {
  const segments = segmentsFor(path)
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  if (total === 0) return <p className="text-sm text-muted">No completed coursework yet.</p>

  let x = 0
  return (
    <figure className="mt-2">
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={segments.map((s) => `${s.label}: ${s.value} hours`).join('. ')}
        className="h-[34px] w-full"
      >
        {segments.map((s, i) => {
          const w = (s.value / total) * 100
          const isFirst = i === 0
          const isLast = i === segments.length - 1
          const gap = isLast ? 0 : GAP / 4
          const rect = (
            <rect
              key={s.label}
              x={x}
              y={0}
              width={Math.max(0, w - gap)}
              height={height}
              fill={s.fill}
              rx={isFirst || isLast ? 1 : 0}
            >
              <title>{s.hint}</title>
            </rect>
          )
          x += w
          return rect
        })}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {segments.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: s.fill }} />
            <span className="text-ink-2">{s.label}</span>
            <span className="font-semibold tabular-nums">{s.value}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  )
}

/**
 * The elective slack meter. Directly beneath the fate bar, because the visual
 * relationship between the two IS the argument: credits orphan only once this
 * meter is full.
 */
export function ElectiveSlackMeter({ slack }: { slack: ElectiveSlack }) {
  const { capacityCredits, usedCredits, remainingCredits, overflowCredits } = slack

  if (capacityCredits === 0) {
    return (
      <p className="mt-2 text-sm">
        <span className="font-semibold">No elective room at all.</span>{' '}
        <span className="text-ink-2">
          Every hour in this program is spoken for, so anything that does not fill a requirement does not count.
        </span>
      </p>
    )
  }

  const usedPct = Math.min(100, (usedCredits / capacityCredits) * 100)
  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-ink-2">Elective room</span>
        <span className="tabular-nums">
          <span className="font-semibold">{usedCredits}</span>
          <span className="text-muted"> of {capacityCredits} hours used</span>
        </span>
      </div>
      <svg viewBox="0 0 100 8" preserveAspectRatio="none" role="img" className="mt-1 h-2 w-full"
        aria-label={`${usedCredits} of ${capacityCredits} elective hours used`}>
        <rect x={0} y={0} width={100} height={8} rx={1} fill="var(--color-line)" />
        <rect x={0} y={0} width={usedPct} height={8} rx={1} fill="var(--color-fate-absorbed)" />
      </svg>
      <p className="mt-1 text-xs text-ink-2">
        {overflowCredits > 0 ? (
          <>
            Full. <span className="font-semibold">{overflowCredits} hours overflow</span> and stop counting.
          </>
        ) : (
          <>{remainingCredits} hours of room still free.</>
        )}
      </p>
    </div>
  )
}

/**
 * Aid runway as a fuel gauge. The one number nothing else in higher education
 * shows a student: attempted hours against the federal ceiling.
 */
export function RunwayGauge({ path }: { path: PathProjection }) {
  const { attemptedAtGraduation, ceiling, headroomCredits, status } = path.aid.sap
  const usedPct = Math.min(100, (attemptedAtGraduation / ceiling) * 100)
  const fill =
    status === 'exceeded' ? 'var(--color-critical)' : status === 'tight' ? 'var(--color-serious)' : 'var(--color-stay)'

  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-ink-2">Federal aid runway</span>
        <span className="tabular-nums">
          <span className="font-semibold">{Math.round(headroomCredits)}</span>
          <span className="text-muted"> hours left of {ceiling}</span>
        </span>
      </div>
      <svg viewBox="0 0 100 8" preserveAspectRatio="none" role="img" className="mt-1 h-2 w-full"
        aria-label={`${attemptedAtGraduation} attempted hours of a ${ceiling} hour ceiling`}>
        <rect x={0} y={0} width={100} height={8} rx={1} fill="var(--color-line)" />
        <rect x={0} y={0} width={usedPct} height={8} rx={1} fill={fill} />
      </svg>
      <p className="mt-1 text-xs text-ink-2">
        {attemptedAtGraduation} attempted hours at graduation
        {status !== 'ok' && (
          <>
            {' '}
            <span aria-hidden>·</span>{' '}
            <span className="font-semibold" style={{ color: fill }}>
              {status === 'exceeded' ? 'over the ceiling' : 'running tight'}
            </span>
          </>
        )}
      </p>
    </div>
  )
}

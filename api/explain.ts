/**
 * Computed numbers in, plain English out.
 *
 * The client has already rendered the deterministic fallback by the time this
 * is called, so a failure here is invisible and a slow response costs nothing.
 * The model receives figures that are already final and is forbidden from
 * recomputing them.
 */
import { EXPLAIN_MODEL, clientKey, getClient, fail, hasApiKey, rateLimit } from './_lib/anthropic.js'
import { EXPLAIN_SCHEMA, EXPLAIN_SYSTEM } from './_lib/prompts.js'

interface Req {
  method?: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}
interface Res {
  status: (code: number) => Res
  json: (body: unknown) => void
  setHeader: (name: string, value: string) => void
}

/** Money reaches the model ALREADY FORMATTED, in the same form the page shows.
 *  Handing over raw cents invites it to render $55,233.54 beside a table that
 *  says $55,234 — prose disagreeing with the figure above it is worse than no
 *  prose at all. Same reason the term label is pre-rendered. */
const usd = (cents: unknown): string =>
  typeof cents === 'number'
    ? (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
    : 'unknown'

const MONTH: Record<string, string> = { SP: 'May', SU: 'August', FS: 'December' }
const gradLabel = (t: unknown): string => {
  const term = t as { year?: number; season?: string } | undefined
  return term?.season && term?.year ? `${MONTH[term.season] ?? term.season} ${term.year}` : 'unknown'
}

/** Send aggregates and flags, not the per-course allocation list. The model
 *  does not need 60 rows to write three paragraphs, and the shorter prompt is
 *  both cheaper and less likely to invite invention. */
function pruned(comparison: Record<string, unknown>): unknown {
  const path = (p: Record<string, unknown>) => ({
    programName: p['programName'],
    graduatesIn: gradLabel(p['graduationTerm']),
    termsRemaining: p['termsRemaining'],
    survivingCredits: p['survivingCredits'],
    absorbedCredits: p['absorbedCredits'],
    orphanedCredits: p['orphanedCredits'],
    electiveSlack: p['electiveSlack'],
    remainingCredits: (p['remaining'] as Record<string, unknown> | undefined)?.['totalCredits'],
    addedByGenEdSwitch: (p['remaining'] as Record<string, unknown> | undefined)?.['addedByGenEdSwitch'],
    costToFinish: usd((p['cost'] as Record<string, unknown> | undefined)?.['grandTotal']),
    aid: p['aid'],
    assumptions: p['assumptions'],
  })
  return {
    stay: path(comparison['stay'] as Record<string, unknown>),
    switch: path(comparison['switch'] as Record<string, unknown>),
    delta: {
      ...(comparison['delta'] as Record<string, unknown>),
      extraCostFormatted: usd((comparison['delta'] as Record<string, unknown>)['extraCost']),
    },
    timing: (comparison['timing'] as Record<string, unknown>[]).map((t) => ({
      switchAfterTerms: t['switchAfterTerms'],
      totalCost: usd(t['totalCost']),
      extraVsDecidingNow: usd(t['deltaCostVsNow']),
      isCliff: t['isCliff'],
      newlyBindingConstraints: t['newlyBindingConstraints'],
    })),
    citations: comparison['citations'],
  }
}

export default async function handler(req: Req, res: Res): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json(fail('Use POST.'))
    return
  }
  if (!hasApiKey()) {
    res.status(503).json(fail('Explanation service not configured.'))
    return
  }

  const limit = rateLimit(clientKey(req.headers), Date.now())
  if (!limit.ok) {
    res.setHeader('retry-after', String(limit.retryAfterSeconds))
    res.status(429).json(fail('Too many requests.'))
    return
  }

  const body = (typeof req.body === 'string' ? safeJson(req.body) : req.body) as
    | { comparison?: Record<string, unknown>; isCoop?: boolean }
    | undefined
  if (!body?.comparison || typeof body.comparison !== 'object') {
    res.status(400).json(fail('Missing comparison.'))
    return
  }

  try {
    const message = await getClient().messages.create({
      model: EXPLAIN_MODEL,
      // Sonnet 5 thinks by default and a measured run spent 1,136 of 1,809
      // output tokens on it — which at max_tokens 2000 left the text block
      // nothing to fit in and returned a response with no usable content.
      // Headroom plus shallow effort: this task is prose from numbers that are
      // already final, so deep reasoning buys nothing and costs latency.
      max_tokens: 8000,
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: EXPLAIN_SCHEMA },
      },
      system: [{ type: 'text', text: EXPLAIN_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content:
            (body.isCoop
              ? 'This student is deciding whether to take a co-op term, not whether to change major. Both paths are the same program.\n\n'
              : '') + JSON.stringify(pruned(body.comparison)),
        },
      ],
    })

    if (message.stop_reason === 'refusal') {
      res.status(422).json(fail('Declined.'))
      return
    }
    const block = message.content.find((b) => b.type === 'text')
    if (!block || block.type !== 'text') {
      res.status(502).json(fail('No usable result.'))
      return
    }
    const parsed = JSON.parse(block.text) as { explanation: string; questions: string[] }
    // The schema cannot pin the count, so check it here. Returning four
    // questions where the page promises five is worse than returning nothing:
    // the client already holds a deterministic five and keeps them on a 502.
    if (!Array.isArray(parsed.questions) || parsed.questions.length < 5 || !parsed.explanation?.trim()) {
      res.status(502).json(fail('Incomplete explanation.'))
      return
    }
    res.status(200).json({ ok: true, explanation: parsed.explanation, questions: parsed.questions.slice(0, 5), source: 'claude' })
  } catch {
    res.status(502).json(fail('Explanation unavailable.'))
  }
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

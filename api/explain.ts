/**
 * Computed numbers in, plain English out.
 *
 * The client has already rendered the deterministic fallback by the time this
 * is called, so a failure here is invisible and a slow response costs nothing.
 * The model receives figures that are already final and is forbidden from
 * recomputing them.
 */
import { EXPLAIN_MODEL, clientKey, client, fail, hasApiKey, rateLimit } from './_lib/anthropic.ts'
import { EXPLAIN_SCHEMA, EXPLAIN_SYSTEM } from './_lib/prompts.ts'

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

/** Send aggregates and flags, not the per-course allocation list. The model
 *  does not need 60 rows to write three paragraphs, and the shorter prompt is
 *  both cheaper and less likely to invite invention. */
function pruned(comparison: Record<string, unknown>): unknown {
  const path = (p: Record<string, unknown>) => ({
    programName: p['programName'],
    graduationTerm: p['graduationTerm'],
    termsRemaining: p['termsRemaining'],
    survivingCredits: p['survivingCredits'],
    absorbedCredits: p['absorbedCredits'],
    orphanedCredits: p['orphanedCredits'],
    electiveSlack: p['electiveSlack'],
    remainingCredits: (p['remaining'] as Record<string, unknown> | undefined)?.['totalCredits'],
    addedByGenEdSwitch: (p['remaining'] as Record<string, unknown> | undefined)?.['addedByGenEdSwitch'],
    grandTotalCents: (p['cost'] as Record<string, unknown> | undefined)?.['grandTotal'],
    aid: p['aid'],
    assumptions: p['assumptions'],
  })
  return {
    stay: path(comparison['stay'] as Record<string, unknown>),
    switch: path(comparison['switch'] as Record<string, unknown>),
    delta: comparison['delta'],
    timing: comparison['timing'],
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
    const message = await client.messages.create({
      model: EXPLAIN_MODEL,
      max_tokens: 1200,
      system: [{ type: 'text', text: EXPLAIN_SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: EXPLAIN_SCHEMA } },
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
    res.status(200).json({ ok: true, ...parsed, source: 'claude' })
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

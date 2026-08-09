/**
 * Transcript text in, structured rows out.
 *
 * The result is never trusted blind: the client always renders it in an
 * editable table with low-confidence rows flagged. Parsing is a reviewable
 * artifact, not a black box you accept or reject — which turns the failure mode
 * into a feature rather than a dead end.
 */
import {
  MAX_INPUT_BYTES,
  PARSE_MODEL,
  clientKey,
  getClient,
  fail,
  hasApiKey,
  rateLimit,
  redact,
} from './_lib/anthropic.js'
import { PARSE_FEWSHOT, PARSE_SCHEMA, PARSE_SYSTEM } from './_lib/prompts.js'

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

export default async function handler(req: Req, res: Res): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json(fail('Use POST.'))
    return
  }
  if (!hasApiKey()) {
    res.status(503).json(fail('Transcript parsing is not configured on this deployment. Enter your courses manually.'))
    return
  }

  const limit = rateLimit(clientKey(req.headers), Date.now())
  if (!limit.ok) {
    res.setHeader('retry-after', String(limit.retryAfterSeconds))
    res.status(429).json(fail(`Too many requests. Try again in ${limit.retryAfterSeconds}s, or enter courses manually.`))
    return
  }

  const body = (typeof req.body === 'string' ? safeJson(req.body) : req.body) as { text?: unknown } | undefined
  const raw = typeof body?.text === 'string' ? body.text : ''
  if (raw.trim().length < 20) {
    res.status(400).json(fail('That does not look like a transcript. Paste the course list, or enter courses manually.'))
    return
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_INPUT_BYTES) {
    res.status(413).json(fail('That transcript is too long. Paste just the course list.'))
    return
  }

  // Identifiers are stripped before anything leaves this box. Nothing is logged.
  const text = redact(raw)

  try {
    const message = await getClient().messages.create({
      model: PARSE_MODEL,
      max_tokens: 8000,
      system: [
        // Cached prefix: the instructions and the example never vary, so
        // repeated pastes read them at a tenth of the price.
        { type: 'text', text: PARSE_SYSTEM },
        { type: 'text', text: PARSE_FEWSHOT, cache_control: { type: 'ephemeral' } },
      ],
      output_config: { format: { type: 'json_schema', schema: PARSE_SCHEMA } },
      messages: [{ role: 'user', content: `<transcript>\n${text}\n</transcript>` }],
    })

    if (message.stop_reason === 'refusal') {
      res.status(422).json(fail('That input was declined. Enter your courses manually.'))
      return
    }

    const block = message.content.find((b) => b.type === 'text')
    if (!block || block.type !== 'text') {
      res.status(502).json(fail('No usable result. Enter your courses manually.'))
      return
    }

    res.status(200).json({ ok: true, ...JSON.parse(block.text) })
  } catch {
    // Deliberately opaque and deliberately unlogged: the input is somebody's
    // transcript. The client falls back to the editable table either way.
    res.status(502).json(fail('Could not read that transcript. Enter your courses manually.'))
  }
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

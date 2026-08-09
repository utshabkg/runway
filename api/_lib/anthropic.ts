/**
 * Shared server-side Claude client and request guards.
 *
 * Never imported from src/ — this is the only place an API key exists, and it
 * lives on the server. Vercel exposes nothing here to the browser as long as
 * the variable is not prefixed VITE_.
 */
import Anthropic from '@anthropic-ai/sdk'

/** Transcript parsing is schema-constrained extraction, which is squarely
 *  Haiku's job at a tenth of Opus pricing. */
export const PARSE_MODEL = 'claude-haiku-4-5'
/** The explanation is the prose a judge reads, so it gets a stronger model. */
export const EXPLAIN_MODEL = 'claude-sonnet-5'

let cached: Anthropic | undefined

/** Constructed on first use, not at module load. An eager client throws when
 *  the key is absent, which turns what should be a graceful 503 into a
 *  cold-start crash and a 500 with no explanation. */
export function getClient(): Anthropic {
  cached ??= new Anthropic({
    apiKey: process.env['ANTHROPIC_API_KEY'] ?? '',
    timeout: 25_000,
    maxRetries: 2,
  })
  return cached
}

export function hasApiKey(): boolean {
  return Boolean(process.env['ANTHROPIC_API_KEY'])
}

// ─────────────────────────────── rate limiting ───────────────────────────────

/** In-memory token bucket. Resets when the function cold-starts, which is fine:
 *  this is a credit-burn guard on a demo, not a security control. */
const buckets = new Map<string, { count: number; resetAt: number }>()
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 10

export function rateLimit(key: string, now: number): { ok: boolean; retryAfterSeconds: number } {
  const bucket = buckets.get(key)
  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return { ok: true, retryAfterSeconds: 0 }
  }
  if (bucket.count >= MAX_PER_WINDOW) {
    return { ok: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) }
  }
  bucket.count++
  return { ok: true, retryAfterSeconds: 0 }
}

export function clientKey(headers: Record<string, string | string[] | undefined>): string {
  const forwarded = headers['x-forwarded-for']
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded
  return (value ?? 'unknown').split(',')[0]!.trim()
}

// ─────────────────────────────── redaction ───────────────────────────────

/**
 * Strip anything that looks like an identifier before text leaves this box.
 *
 * A transcript is pasted by a real person and may carry a student ID, a date of
 * birth or a national identifier. None of that helps the parser, and Official
 * Rules section 8 forbids third-party personal information in a submission.
 * Course codes are protected because they are exactly the digit runs that
 * matter — "COMP SCI 1570" must survive.
 */
export function redact(text: string): string {
  return (
    text
      // 9+ consecutive digits: student and national identifiers.
      .replace(/\b\d{9,}\b/g, '[redacted]')
      // Explicitly labelled identifiers, however they are punctuated.
      .replace(/\b(student\s*(id|number|no\.?)|ssn|social\s*security)\b\s*[:#-]?\s*[\w-]+/gi, '$1: [redacted]')
      // Dates of birth.
      .replace(/\b(dob|date\s+of\s+birth)\b\s*[:#-]?\s*[\d/.-]+/gi, '$1: [redacted]')
      .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, '[redacted email]')
  )
}

export const MAX_INPUT_BYTES = 40_000

export interface ApiError {
  ok: false
  reason: string
}

export function fail(reason: string): ApiError {
  return { ok: false, reason }
}

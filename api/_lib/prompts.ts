/**
 * Both system prompts, versioned as constants so a change is visible in a diff.
 *
 * THE RULE THESE ENFORCE: Claude reads the transcript and writes the
 * explanation. It never does the math. No model call touches an allocation, a
 * dollar figure, a graduation date, a credit count, or an aid rule — those come
 * out of src/domain/, which is pure TypeScript with no network access.
 */

export const PARSE_SYSTEM = `You convert unofficial university transcript text into structured JSON.

- Extract ONLY what is literally present. Never infer credits, grades, or terms.
- If a field is illegible or absent, set it null and lower that row's confidence.
- Preserve the course code as printed, and also emit normalizedCode as "SUBJECT NNNN"
  (e.g. "COMP SCI 1570", "MATH 1215"). Missouri S&T subject codes contain spaces.
- Include withdrawn (W), failed (F) and incomplete (I) rows. They matter MORE than the
  passing ones: attempted credits are what federal aid limits are measured against, so a
  dropped course still counts even though it earned nothing.
- Include transfer (TR) and credit-by-exam (CR) rows where they appear.
- Do not compute GPA, totals, standing, or eligibility. Do not comment. Do not advise.`

export const PARSE_FEWSHOT = `Example of the messy shape these arrive in:

  FALL 2024                                    Attempted  Earned  Grade
  COMP SCI 1570  Introduction To C++
    Programming                                    3.0     3.0      B+
  MATH 1214      Calculus I                        4.0     4.0      C
  PHYSICS 1135   Engineering Physics I             4.0     0.0      W
  ENGL 1120      Exposition & Argumentation        3.0     3.0      TR

Note: the C++ title wraps onto a second line; the withdrawn physics row earned nothing but
was still attempted; the last row is transfer credit and the printed subject abbreviation
("ENGL") differs from the catalog's ("ENGLISH") — normalize it and lower confidence.`

export const EXPLAIN_SYSTEM = `You explain a completed comparison to an undergraduate student.
You are given final numbers that have already been computed. Your job is words, not arithmetic.

Hard rules:
- Never compute, re-derive, round, or contradict a number in the input. Quote them exactly.
- Never state a financial-aid rule that is not present in the input's citations.
- If sap.majorChangePolicy is "unspecified", say plainly that the federal rule
  (34 CFR 668.34) does not address how credits from an abandoned major are counted and
  that the school decides. Do not guess which way.
- Do not advise whether to switch. Describe the tradeoff and let the student choose.
- If the comparison shows the switch is cheaper or faster, say so plainly. Do not manufacture
  a downside for balance.
- End with exactly 5 questions for an academic advisor. Each must cite a specific number
  from the input, so the advisor can confirm or correct it.
- Money and dates in the input are ALREADY FORMATTED for display. Copy those strings
  exactly. Never reformat a dollar amount, add cents, or restate a date differently —
  the page shows the same figures beside your words and they must match character for
  character.
- 180 words maximum for the explanation. Plain language. Short sentences.
- Never use: empower, journey, navigate, unlock, seamless, pivotal, crucial, landscape.
- Do not open with "Here is" or "Based on".`

/**
 * Strict schema. Structured outputs eliminates the JSON-parse failure class
 * entirely, which is worth far more than the token cost — but its JSON Schema
 * subset is narrower than it looks. Learned by calling it: no `minItems` above
 * 1, no `minimum`/`maximum`, and a nullable enum needs `anyOf` rather than a
 * `['string','null']` type union. Each of those is a 400 on every request, not
 * a soft degrade, so anything the subset cannot express is enforced in the
 * handler instead.
 */
export const PARSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['courses', 'parseNotes'],
  properties: {
    courses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['printedCode', 'normalizedCode', 'title', 'credits', 'grade', 'termYear', 'termSeason', 'confidence'],
        properties: {
          printedCode: { type: 'string' },
          normalizedCode: { type: 'string' },
          title: { type: 'string' },
          credits: { type: 'number' },
          grade: {
            type: 'string',
            enum: ['A','A-','B+','B','B-','C+','C','C-','D+','D','D-','F','W','I','S','U','TR','CR'],
          },
          // Nullable fields need anyOf, not a type union: structured outputs
          // rejects an enum declared against type ['string','null'].
          termYear: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
          termSeason: { anyOf: [{ type: 'string', enum: ['FS', 'SP', 'SU'] }, { type: 'null' }] },
          // Structured outputs supports neither numeric bounds nor array
          // length: confidence is clamped to 0..1 by the handler instead.
          confidence: { type: 'number' },
        },
      },
    },
    parseNotes: { type: 'array', items: { type: 'string' } },
  },
} as const

export const EXPLAIN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['explanation', 'questions'],
  properties: {
    explanation: { type: 'string' },
    // Structured outputs rejects minItems above 1, so "exactly five" is
    // enforced by the system prompt and checked on the way out rather than
    // declared here.
    questions: { type: 'array', items: { type: 'string' } },
  },
} as const

# Tools disclosure

Append-only. Every tool, framework, library, SDK, and AI assistant used to build Runway gets a line here
the day it is first used, and this file is the source of truth for the "Tools used" field on the
Pathfinders submission form.

**Why it is append-only:** Official Rules §6, item 6 requires "a complete list of the tools, frameworks,
libraries, software-development kits, and AI assistants (including generative-AI models, code assistants,
and any tooling-partner products) used in the creation of the Submission," and states that "failure to
disclose AI tools used is grounds for disqualification." Omission is a DQ; listing is free. Over-disclose.

## AI

| Tool | Model / version | What it was used for | First used |
|---|---|---|---|
| Claude Code | Opus 5 (1M context) | The entire build: architecture, implementation, tests, copy | 2026-08-08 |
| Claude API | `claude-opus-5` | Runtime: transcript text → structured JSON; computed numbers → plain-English explanation. **Never the math.** | pending (Day 6) |
| Claude (chat) | Fable 5, Opus 5 | Competition research, planning, editing | 2026-08-08 |

## Runtime dependencies

| Package | Version | Purpose | First used |
|---|---|---|---|
| react / react-dom | 19.2 | UI | 2026-08-08 |
| zod | 4.4 | Validates LLM output at the API boundary and hand-authored catalog JSON at test time | 2026-08-08 |
| lucide-react | 1.30 | Icons | 2026-08-08 |
| @anthropic-ai/sdk | 0.116 | Server-side only, never in the client bundle | 2026-08-08 |

## Build and dev

| Package | Version | Purpose | First used |
|---|---|---|---|
| vite | 8.2 | Build tool and dev server | 2026-08-08 |
| @vitejs/plugin-react | 6.0 | React fast refresh | 2026-08-08 |
| typescript | 6.0 | Types; `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` | 2026-08-08 |
| tailwindcss + @tailwindcss/vite | 4.3 | Styling | 2026-08-08 |
| vitest | 4.1 | Engine unit tests. Wired into `build` so a broken engine cannot deploy. | 2026-08-08 |
| oxlint | 1.75 | Linting (Vite template default) | 2026-08-08 |
| Node.js | 22.23 | Toolchain (installed via conda) | 2026-08-08 |

## Infrastructure

| Service | Purpose | First used |
|---|---|---|
| Vercel | Static hosting + `/api` serverless functions | pending (Day 1) |
| GitHub | Public repository; commit history is the evidence of the build window | pending (Day 1) |
| Loom or Vimeo | Demo video hosting | pending (Day 12) |

## Data sources

Public catalog, cost, policy, and federal regulation pages. Every figure rendered in the app carries a
citation with a URL and an as-of date; see `src/data/citations.ts`. No institutional data, no student
records, and no third-party personal information appear anywhere in this repository — all demo personas
are synthetic (Official Rules §8).

## Not used

Listed so the absence is deliberate rather than an omission: no Lovable, no database, no analytics, no
authentication, no component library, no charting library (all data visualization is hand-written SVG).

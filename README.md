# Runway

**Every academic decision spends from the same budget — attempted credits, aid semesters, scholarship
terms, dollars. Nobody shows you the balance.**

Built for the [Stellic Pathfinders Challenge 2026](https://www.stellic.com/pathfinders) · Category:
Overcome Obstacles · Solo · Missouri University of Science and Technology.

---

## What it does

You paste an unofficial transcript (or click a demo student), pick a decision, and Runway shows both
futures side by side: graduation date, dollars, which credits apply, and — the part nothing else
computes — **how much federal aid eligibility you have left afterward.**

Three decisions, one engine:

1. **Switch majors.** Credit fate, elective slack, new graduation date, cost, aid runway, and the
   cheapest term to do it.
2. **Take a co-op.** Zero attempted credits, so SAP pace is untouched; at S&T most scholarships are
   *frozen* rather than consumed. Graduation moves a term.
3. **Bank accelerated BS→MS shared credits.** They count toward both degrees at undergraduate tuition
   rates, but still consume undergraduate attempted credits against the SAP ceiling — and Pell ends at
   the bachelor's.

## Why this and not a degree audit

Degree audits are everywhere. DegreeWorks, uAchieve, Workday, Anthology and Stellic all ship "what-if"
major simulations, and Missouri S&T runs two of them. None of them, and no consumer tool I could find,
answers the question underneath the decision:

> Every institution runs a degree audit. Every institution is federally required (HEOA 2008) to run a net
> price calculator. In fifteen years nobody connected them.

So Runway is not an audit. It is the consequence layer on top of one:

- **SAP maximum timeframe** — 150% of published program length, measured in *attempted* credits
  ([34 CFR 668.34](https://www.law.cornell.edu/cfr/text/34/668.34)). Withdrawals, failures and credits
  from an abandoned major never leave the denominator. A 127-hour degree has a 190.5-hour ceiling.
- **Pell Lifetime Eligibility Used** — 600%, roughly 12 full-time semesters, and unlike SAP there is
  **no appeal** ([FSA Handbook 2025-26, Vol. 7 Ch. 8](https://fsapartners.ed.gov/knowledge-center/fsa-handbook/2025-2026/vol7/ch8-pell-grant-lifetime-eligibility-used-leu)).
- **Institutional and state caps** — S&T merit aid is 8 semesters; Access Missouri dies at 10 semesters
  *or* 150 completed credit hours, whichever comes first.

### On honesty

The obvious version of this product tells you your credits die. The best evidence says that is usually
false. EAB studied 78,000 students across 10 institutions and found (*How Late Is Too Late?*, p.5):

> "In most cases, courses that no longer fulfill major requirements after a switch are simply converted
> to fulfill general electives. These credits will not become unproductive unless the student has already
> fulfilled all elective requirements."

Same report: median time-to-degree is flat for switches through the first semester of junior year, and
students who switch graduate at 82–84% against 78.45% for students who never do.

So the engine models free-elective capacity explicitly and sorts every completed course into one of three
fates — **satisfies** a named requirement, **absorbed** into remaining elective capacity, or genuinely
**orphaned** because capacity is exhausted. Most of the time it reports that most credits survive. It
also says the second-order thing that is true either way: orphaned or not, those credits still count as
*attempted*, so they consume aid runway regardless.

Two more places the app refuses to overclaim:

- 34 CFR 668.34 is **silent** on how credits from an abandoned major count toward maximum timeframe.
  Schools set that policy, usually through an appeal with an academic plan. That uncertainty is encoded
  as a data field (`SapPolicy.majorChangePolicy: 'unspecified'`), not a UI string, so the interface
  structurally cannot assert a rule the regulation does not contain.
- The Direct Subsidized Loan 150% limit (SULA) was **repealed** effective July 1, 2021 and reversed
  retroactively. It is constantly confused with the SAP rule. It appears nowhere in this codebase, and
  `tests/aid.test.ts` asserts its absence permanently.

**Standing invariant: every ambiguous call is biased against the tool's own impressiveness.** Under-count
surviving credits, over-count cost, round graduation later. Someone who checks should find it
conservative, not wrong.

## How it is built

```
src/domain/     pure TypeScript. no React, no fetch, no `new Date()`.
                "now" is an injected Term. this is why the numbers are reproducible.
src/data/       hand-authored catalog, policy and citation JSON, zod-validated at load
api/            two Vercel functions, both Claude, neither one doing arithmetic
```

`npm run build` runs `vitest run` **first**, so a broken engine physically cannot deploy.

**Where the AI is, and is not.** Claude reads the transcript and writes the explanation. It never does
the math. No LLM call touches an allocation, a dollar figure, a graduation date, a credit count, or an
aid rule; the explanation endpoint receives numbers that are already final and is instructed that it may
not recompute or contradict them. The demo personas ship with pre-baked explanations and make **zero
network calls**, so the demo works with the API down.

## Running it

```bash
npm install
npm run dev        # dev server
npm test           # engine unit tests
npm run build      # tests, then typecheck, then build
```

## Status

Under active development through Aug 20, 2026. See `TOOLS.md` for the complete tool disclosure.

Runway prepares you for an advising conversation. It does not replace one, and it is not an official
degree audit — every figure carries its source and an as-of date, and every one of them should be
confirmed with your advisor and your financial aid office.

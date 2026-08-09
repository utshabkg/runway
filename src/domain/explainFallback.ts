/**
 * Plain-English explanation, computed rather than generated.
 *
 * This exists BEFORE the Claude route and is what the page renders first. The
 * API call then upgrades it in place. One design choice solves three problems
 * at once: there is no latency to hide, an outage degrades to prose that is
 * still correct, and the demo personas never touch the network.
 *
 * It also guarantees a property the model cannot: every number here came out of
 * the engine, so the fallback can never contradict the table above it.
 */
import { formatCents } from './cost.ts'
import { graduationLabel, termLabel } from './terms.ts'
import type { Comparison, Explanation, PathProjection } from './types.ts'

function creditWord(n: number): string {
  return n === 1 ? '1 credit hour' : `${n} credit hours`
}

function termWord(n: number): string {
  return n === 1 ? '1 term' : `${n} terms`
}

function fateSentence(path: PathProjection): string {
  const satisfies = path.survivingCredits - path.absorbedCredits
  const { absorbed, orphanedCredits: orphaned, electiveSlack } = {
    absorbed: path.absorbedCredits,
    orphanedCredits: path.orphanedCredits,
    electiveSlack: path.electiveSlack,
  }

  if (orphaned === 0 && absorbed === 0) {
    return `All ${creditWord(satisfies)} you have already earned fill a requirement in ${path.programName}.`
  }
  if (orphaned === 0) {
    return (
      `Of the work you have already done, ${creditWord(satisfies)} fill a requirement in ${path.programName} ` +
      `and ${absorbed} more count as elective credit. Nothing is wasted — this program has ` +
      `${creditWord(electiveSlack.capacityCredits)} of elective room and your work fits inside it.`
    )
  }
  if (electiveSlack.capacityCredits === 0) {
    return (
      `${creditWord(satisfies)} fill a requirement in ${path.programName}. The remaining ${orphaned} do not count ` +
      `toward anything, because this program has no free elective hours at all — every slot in it is spoken for.`
    )
  }
  return (
    `${creditWord(satisfies)} fill a requirement in ${path.programName} and ${absorbed} more are absorbed as ` +
    `elective credit, which uses up all ${electiveSlack.capacityCredits} elective hours the program allows. ` +
    `That leaves ${creditWord(orphaned)} that do not count toward the degree — not because they were bad ` +
    `courses, but because there is nowhere left to put them.`
  )
}

function aidSentence(path: PathProjection): string {
  const { sap, pell, institutional } = path.aid
  const parts: string[] = [
    `After this path you would have attempted ${sap.attemptedAtGraduation} hours against a federal aid ` +
      `ceiling of ${sap.ceiling}, leaving ${Math.round(sap.headroomCredits)} hours of runway.`,
  ]
  if (pell.percentUsedNow > 0) {
    parts.push(
      `Pell would sit at ${pell.percentUsedAtGraduation}% of the 600% lifetime limit` +
        (pell.status === 'ok' ? '.' : ', and there is no appeal past 600%.'),
    )
  }
  const cliff = institutional.find((a) => a.termsUnfunded > 0)
  if (cliff) {
    parts.push(
      `Your ${cliff.label} covers ${cliff.cap} semesters and this path uses ${cliff.semestersAtGraduation}, ` +
        `so ${termWord(cliff.termsUnfunded)} would be unfunded.`,
    )
  }
  return parts.join(' ')
}

export function explainFallback(comparison: Comparison, isCoop = false): Explanation {
  const { stay, switch: sw, delta } = comparison
  const cheaper = delta.extraCost < 0
  const money = formatCents(Math.abs(delta.extraCost))
  const action = isCoop ? 'Taking the co-op' : 'Switching'

  const timing =
    delta.extraTerms === 0
      ? 'finishes in the same term'
      : `takes ${termWord(Math.abs(delta.extraTerms))} ${delta.extraTerms > 0 ? 'longer' : 'less'}`

  const headline =
    `${action} ${cheaper ? 'saves you' : 'costs you'} ${money} and ${timing}. ` +
    `Staying finishes in ${graduationLabel(stay.graduationTerm)}; ` +
    `${isCoop ? 'the co-op path' : 'the switch'} finishes in ${graduationLabel(sw.graduationTerm)}.`

  const rateNote =
    stay.cost.perTerm.find((t) => t.tuition > 0)?.tuition !== sw.cost.perTerm.find((t) => t.tuition > 0)?.tuition
      ? ' Part of that difference is the tuition rate itself: this school charges by the rate tier it assigns to your major, so the same fifteen credits cost a different amount in a different program.'
      : ''

  const soonest = comparison.timing.find((t) => t.switchAfterTerms === 1)
  const waiting =
    !isCoop && soonest && soonest.deltaCostVsNow > 0
      ? ` Waiting one more term before deciding adds about ${formatCents(soonest.deltaCostVsNow)}, because that term is billed at your current major's rate.`
      : ''

  const explanation = [headline + rateNote, fateSentence(sw), aidSentence(sw) + waiting].join('\n\n')

  // Exactly five, each anchored to a number the engine produced. A question a
  // student cannot tie to a figure is a question an advisor cannot answer.
  const questions: string[] = [
    `My degree audit says ${sw.survivingCredits - sw.absorbedCredits} of my hours fill a requirement in ${sw.programName} and ${sw.absorbedCredits} count as electives. Does yours agree?`,
    sw.orphanedCredits > 0
      ? `Is there any way to apply the ${creditWord(sw.orphanedCredits)} that currently do not count toward anything — a substitution, a minor, or an emphasis area?`
      : `Is the elective room in ${sw.programName} really ${sw.electiveSlack.capacityCredits} hours, or does my catalog year differ?`,
    `I would reach ${sw.aid.sap.attemptedAtGraduation} attempted hours against the ${sw.aid.sap.ceiling}-hour maximum timeframe. Do hours from my previous major count against that ceiling here?`,
    sw.aid.institutional.some((a) => a.termsUnfunded > 0)
      ? `This path runs ${sw.aid.institutional.find((a) => a.termsUnfunded > 0)!.semestersAtGraduation} semesters against an ${sw.aid.institutional.find((a) => a.termsUnfunded > 0)!.cap}-semester scholarship. What happens in the semesters past the cap?`
      : `My scholarship covers ${sw.aid.institutional[0]?.cap ?? 8} semesters and this path uses ${sw.aid.institutional[0]?.semestersAtGraduation ?? 0}. Is that count right?`,
    !isCoop && comparison.timing.length > 1
      ? `If I decide by ${termLabel(comparison.timing[1]!.switchTerm)} instead of now, does anything change other than the cost of the extra term?`
      : `Would a co-op term change my scholarship or my satisfactory academic progress standing in any way I have not accounted for?`,
  ]

  return { explanation, questions, source: 'fallback' }
}

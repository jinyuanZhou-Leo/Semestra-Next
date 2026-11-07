import { CornerDownRight, MessageCircleQuestion } from 'lucide-react'
import { m } from '@/paraglide/messages'
import type { Asked, citationsOf } from '../transcript'
import { Markdown } from './Markdown'
import { answerOf, questionOf } from './PendingDock'

/**
 * What Sem said before asking, then each question it asked with the user's answer. A question
 * still waiting is in the input's place (`PendingDock`), so only its lead-in shows here.
 */
export function AskedBlock({
  asked,
  citations,
}: {
  asked: Asked
  citations: ReturnType<typeof citationsOf>
}) {
  return (
    <>
      {asked.text ? <Markdown text={asked.text} citations={citations} /> : null}
      {asked.questions.map((step) => {
        const proposal = step.proposal
        if (!proposal || proposal.status === 'pending') return null
        const answer = answerOf(proposal)
        return (
          <div key={step.callId} className="space-y-1 text-sm">
            <p className="flex items-start gap-2 text-muted-foreground">
              <MessageCircleQuestion className="mt-0.5 size-4 shrink-0" aria-hidden />
              {questionOf(proposal).question}
            </p>
            <p className="flex items-start gap-2 pl-0.5">
              <CornerDownRight
                className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                aria-hidden
              />
              {answer === null ? (
                <span className="text-muted-foreground">
                  {proposal.status === 'rejected'
                    ? m.assistant_question_skipped()
                    : m.assistant_question_unanswered()}
                </span>
              ) : (
                <span className="font-medium whitespace-pre-wrap">{answer}</span>
              )}
            </p>
          </div>
        )
      })}
    </>
  )
}

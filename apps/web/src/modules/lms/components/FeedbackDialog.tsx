import type { Assessment, FeedbackOut } from '@semestra/api-client'
import { lmsCourseLinkGetOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { useState } from 'react'
import type { AssessmentColumnDialogProps } from '@/modules/grading/types'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog'
import { feedbackListOptions, useFeedbackParam } from '../feedback'
import { useProviderName } from '../providers'
import { SubmissionFeedback } from './SubmissionFeedback'

type Shown = { assessment: Assessment; feedback: FeedbackOut }

/**
 * The teacher's feedback on an assessment of the gradebook (M03 §5.1), as the sync kept it, with
 * a way to the platform. Open while the URL names the assessment (`?feedback=`); what it shows is
 * kept while it fades out after leaving the URL.
 */
export default function FeedbackDialog({ courseId, assessments }: AssessmentColumnDialogProps) {
  const param = useFeedbackParam()
  const link = useQuery(lmsCourseLinkGetOptions({ path: { course_id: courseId } })).data?.link
  const provider = useProviderName(link?.provider) ?? link?.provider ?? ''
  const feedback = useQuery({
    ...feedbackListOptions(courseId),
    select: (list) => list.items.find((f) => f.assessment_id === param.assessmentId),
  }).data
  const assessment = assessments.find((a) => a.id === param.assessmentId)
  const current = assessment && feedback ? { assessment, feedback } : null
  const [shown, setShown] = useState<Shown | null>(null)
  if (
    current &&
    (current.assessment !== shown?.assessment || current.feedback !== shown?.feedback)
  ) {
    setShown(current)
  }
  const target = current ?? shown
  return (
    <Dialog
      open={current !== null}
      onOpenChange={(open) => {
        if (!open) param.close()
      }}
      onOpenChangeComplete={(open) => {
        if (!open) setShown(null)
      }}
    >
      <DialogContent className="max-h-[85vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{target?.assessment.title}</DialogTitle>
          <DialogDescription>{m.lms_feedback_from({ provider })}</DialogDescription>
        </DialogHeader>
        <div className="-mx-4 overflow-y-auto px-4">
          {target ? (
            <SubmissionFeedback submission={target.feedback} assignment={target.feedback} />
          ) : null}
        </div>
        {target?.feedback.web_url ? (
          <DialogFooter>
            <Button
              variant="outline"
              nativeButton={false}
              render={
                // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- labelled by the button's text
                <a href={target.feedback.web_url} target="_blank" rel="noreferrer" />
              }
            >
              {m.lms_open_in({ provider })}
              <ExternalLink aria-hidden />
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

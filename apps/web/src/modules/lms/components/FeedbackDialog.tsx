import type { Assessment, AssignmentOut } from '@semestra/api-client'
import { lmsCourseLinkGetOptions, lmsSubmissionGetOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { CircleAlert, ExternalLink } from 'lucide-react'
import type { DialogTargetProps } from '@/lib/dialog-target'
import { m } from '@/paraglide/messages'
import { Alert, AlertTitle } from '@/ui/alert'
import { Button } from '@/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog'
import { Skeleton } from '@/ui/skeleton'
import { useProviderName } from '../providers'
import { SubmissionFeedback } from './SubmissionFeedback'

/**
 * The teacher's feedback on an assessment that follows an LMS assignment, opened from the
 * gradebook (M03 §5.1): read from the platform, with a way to it.
 */
export default function FeedbackDialog({
  assessment,
  assignment,
  ...props
}: DialogTargetProps & { assessment: Assessment; assignment: AssignmentOut }) {
  const courseId = assessment.course_id
  const link = useQuery(lmsCourseLinkGetOptions({ path: { course_id: courseId } })).data?.link
  const provider = useProviderName(link?.provider) ?? link?.provider ?? ''
  const submission = useQuery(
    lmsSubmissionGetOptions({
      path: { course_id: courseId, assignment_id: assignment.external_id },
    }),
  )
  return (
    <Dialog {...props}>
      <DialogContent className="max-h-[85vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{assessment.title}</DialogTitle>
          <DialogDescription>{m.lms_feedback_from({ provider })}</DialogDescription>
        </DialogHeader>
        <div className="-mx-4 overflow-y-auto px-4">
          {submission.data ? (
            <SubmissionFeedback submission={submission.data} assignment={assignment} />
          ) : submission.isError ? (
            <Alert variant="destructive">
              <CircleAlert aria-hidden />
              <AlertTitle>{m.common_load_failed()}</AlertTitle>
            </Alert>
          ) : (
            <div className="space-y-3">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}
        </div>
        {assignment.web_url ? (
          <DialogFooter>
            <Button
              variant="outline"
              nativeButton={false}
              render={
                // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- labelled by the button's text
                <a href={assignment.web_url} target="_blank" rel="noreferrer" />
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

import { Lock } from 'lucide-react'
import { useState } from 'react'
import { SEGMENT, SEGMENTED } from '@/lib/segmented'
import { courseLabel } from '@/modules/academics/color'
import { HideGrades } from '@/modules/grading/components/GradeValue'
import { m } from '@/paraglide/messages'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/ui/drawer'
import { Skeleton } from '@/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'
import type { AssignmentDetailsProps } from '../assignment/AssignmentHost'
import {
  AssignmentError,
  AssignmentFacts,
  AssignmentStatus,
  KeptNote,
  MySubmission,
  PlatformButton,
} from '../assignment/parts'
import { submitsOnline } from '../assignment/status'
import type { AssignmentTarget, AssignmentView } from '../assignment/target'
import { useDetails } from '../assignment/use-details'
import { SubmissionFeedback } from '../components/SubmissionFeedback'
import { LmsContentContext } from '../content/context'
import { LmsHtml } from '../content/LmsContent'

/**
 * The assignment details on a phone (M17): a page that slides up from the bottom, one column.
 * Where the user is and the facts come first, then the description or the submission with the
 * feedback. Its places in Semestra are left out: the phone has no gradebook to go to.
 */
export default function AssignmentSheet({ target, onClose }: AssignmentDetailsProps) {
  const [shown, setShown] = useState(target)
  if (target && (target.courseId !== shown?.courseId || target.assignmentId !== shown.assignmentId))
    setShown(target)
  const current = target ?? shown
  return (
    <Drawer open={target !== null} onOpenChange={(open) => !open && onClose()} showSwipeHandle>
      <DrawerContent className="h-[92dvh]">
        {current ? (
          <Details
            key={`${current.courseId}:${current.assignmentId}`}
            target={current}
            onClose={onClose}
          />
        ) : null}
      </DrawerContent>
    </Drawer>
  )
}

// The drawer centres its header; the page under it is left-aligned, so the header is too.
const HEADER = 'pb-4 group-data-[swipe-axis=y]/drawer-popup:text-left'

function Details({ target, onClose }: { target: AssignmentTarget; onClose: () => void }) {
  const [view, setView] = useState<AssignmentView>(target.view)
  const d = useDetails(target, onClose, { pages: false })
  if (!d.detail) {
    return (
      <>
        <DrawerHeader className={HEADER}>
          <DrawerTitle>{m.lms_assignment_details()}</DrawerTitle>
          <DrawerDescription className="sr-only">{m.lms_assignment_details()}</DrawerDescription>
        </DrawerHeader>
        {d.error ? (
          <div className="p-4">
            <AssignmentError error={d.error} onRetry={d.refetch} />
          </div>
        ) : (
          <div className="space-y-3 p-4">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-32" />
          </div>
        )}
      </>
    )
  }
  const { detail, course, provider, practice } = d
  const { assignment: a, submission: s } = detail
  const tab = practice ? 'details' : view
  return (
    <HideGrades hidden={d.hideGrades}>
      <LmsContentContext value={d.content}>
        <DrawerHeader className={HEADER}>
          <DrawerDescription>
            {[course ? courseLabel(course) : null, a.group_name].filter(Boolean).join(' · ')}
          </DrawerDescription>
          <DrawerTitle className="font-heading text-lg leading-snug">{a.name}</DrawerTitle>
        </DrawerHeader>
        <div className="flex min-h-0 flex-col gap-5 overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
          <div className="space-y-3">
            <AssignmentStatus assignment={a} submission={s} practice={practice} now={d.now} />
            <PlatformButton assignment={a} submission={s} provider={provider} practice={practice} />
          </div>
          <AssignmentFacts assignment={a} submission={s} quiz={detail.quiz} />
          <KeptNote detail={detail} provider={provider} />
          {practice ? null : (
            <ToggleGroup
              className={`${SEGMENTED} w-full`}
              value={[tab]}
              onValueChange={(value) => value[0] && setView(value[0] as AssignmentView)}
            >
              <ToggleGroupItem value="details" className={`${SEGMENT} flex-1`}>
                {m.lms_assignment_tab_description()}
              </ToggleGroupItem>
              <ToggleGroupItem value="feedback" className={`${SEGMENT} flex-1`}>
                {m.lms_assignment_tab_feedback()}
              </ToggleGroupItem>
            </ToggleGroup>
          )}
          {tab === 'details' ? (
            <div className="space-y-4">
              {a.locked ? (
                <p className="flex items-start gap-2 rounded-xl bg-muted px-3 py-2 text-sm">
                  <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  {a.lock_explanation || m.lms_assignment_locked({ provider })}
                </p>
              ) : null}
              {a.html ? (
                <LmsHtml html={a.html} />
              ) : (
                <p className="text-sm text-muted-foreground">{m.lms_assignment_no_description()}</p>
              )}
            </div>
          ) : d.partial ? (
            <Skeleton className="h-24" />
          ) : (
            <div className="space-y-6">
              <MySubmission
                courseId={target.courseId}
                submission={s}
                kept={detail.kept ?? false}
                online={submitsOnline(a.submission_types)}
              />
              <SubmissionFeedback
                submission={s ?? { comments: [], rubric_scores: [] }}
                rubric={a.rubric ?? []}
              />
            </div>
          )}
        </div>
      </LmsContentContext>
    </HideGrades>
  )
}

import { FileText, Lock, RefreshCw, X } from 'lucide-react'

import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { useState } from 'react'
import { courseColor, courseLabel } from '@/modules/academics/color'
import { HideGrades } from '@/modules/grading/components/GradeValue'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog'
import { Skeleton } from '@/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { cn } from '@/lib/utils'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/tabs'
import { SubmissionFeedback } from '../components/SubmissionFeedback'
import { LmsContentContext } from '../content/context'
import { DisplayMenu, LmsHtml } from '../content/LmsContent'
import type { AssignmentDetailsProps } from './AssignmentHost'
import {
  AssignmentError,
  AssignmentFacts,
  AssignmentStatus,
  InSemestra,
  SourceNote,
  MySubmission,
  PlatformButton,
} from './parts'
import type { AssignmentTarget, AssignmentView } from './target'
import { useDetails } from './use-details'

/**
 * The assignment details (M09 §7.3): the one place the app shows an assignment, opened where
 * the user is. Two columns of a fixed height: what the assignment is (its description, or the
 * user's submission with the feedback) and, beside it, where the user is with it. Only the left
 * body scrolls, so nothing moves when a tab is picked or data arrives.
 */
export default function AssignmentDialog({ target, onClose }: AssignmentDetailsProps) {
  // What it shows stays while it fades out after the URL dropped the assignment.
  const [shown, setShown] = useState(target)
  if (target && !same(target, shown)) setShown(target)
  const current = target ?? shown
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(44rem,calc(100dvh-4rem))] gap-0 overflow-hidden p-0 sm:max-w-[62rem]"
      >
        {current ? (
          <Details
            key={`${current.courseId}:${current.assignmentId}:${current.held ?? ''}`}
            target={current}
            onClose={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

const same = (a: AssignmentTarget, b: AssignmentTarget | null) =>
  a.courseId === b?.courseId &&
  a.assignmentId === b.assignmentId &&
  a.view === b.view &&
  a.held === b.held

function Details({ target, onClose }: { target: AssignmentTarget; onClose: () => void }) {
  const [view, setView] = useState<AssignmentView>(target.view)
  const d = useDetails(target, onClose)
  const close = (
    <DialogClose
      render={
        <Button
          variant="ghost"
          size="icon-sm"
          className="-mt-1 -mr-2 shrink-0"
          aria-label={m.common_close()}
        />
      }
    >
      <X aria-hidden />
    </DialogClose>
  )
  if (!d.detail) {
    // The same two columns as the details, so nothing moves when they arrive.
    return (
      <>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="shrink-0 px-7 pt-6">
            <DialogDescription className="sr-only">{m.lms_assignment_details()}</DialogDescription>
            <DialogTitle className="sr-only">{m.lms_assignment_details()}</DialogTitle>
            {d.error ? null : (
              <>
                <Skeleton className="h-5 w-40" />
                <Skeleton className="mt-1 h-7 w-2/3" />
              </>
            )}
          </header>
          {d.error ? (
            <div className="px-7 py-5">
              <AssignmentError error={d.error} provider={d.provider} onRetry={d.refetch} />
            </div>
          ) : (
            <>
              <div className="mt-2 h-11 shrink-0 border-b" />
              <div className="space-y-3 px-7 py-5">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-5/6" />
                <Skeleton className="h-5 w-2/3" />
              </div>
            </>
          )}
        </div>
        <aside className="flex w-80 shrink-0 flex-col border-l bg-muted/30">
          <div className="space-y-3 p-5">
            <div className="flex items-start justify-between gap-2">
              {d.error ? <span /> : <Skeleton className="h-7 w-32" />}
              {close}
            </div>
            {d.error ? null : <Skeleton className="h-9 w-full" />}
          </div>
          {d.error ? null : (
            <div className="space-y-3 border-t px-5 py-4">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-2/3" />
            </div>
          )}
        </aside>
      </>
    )
  }
  const { detail, course, provider, practice } = d
  const { assignment: a, submission: s, state } = detail
  const tab = practice ? 'details' : view
  return (
    <HideGrades hidden={d.hideGrades}>
      <LmsContentContext value={d.content}>
        <Tabs
          value={tab}
          onValueChange={(value) => setView(value as AssignmentView)}
          className="min-w-0 flex-1 gap-0"
        >
          <header className="shrink-0 px-7 pt-6">
            <DialogDescription className="flex items-center gap-1.5 text-sm">
              {course ? (
                <>
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: courseColor(course) }}
                  />
                  <span className="truncate">{courseLabel(course)}</span>
                </>
              ) : null}
              {course && a.group_name ? <span aria-hidden>·</span> : null}
              {a.group_name ? <span className="truncate">{a.group_name}</span> : null}
            </DialogDescription>
            <DialogTitle className="mt-1 font-heading text-xl leading-snug font-semibold">
              {a.name}
            </DialogTitle>
          </header>
          <div className="mt-2 flex shrink-0 items-center justify-between border-b px-5">
            <TabsList variant="line" className="h-11">
              <TabsTrigger value="details" className="flex-none">
                {m.lms_assignment_tab_description()}
              </TabsTrigger>
              {practice ? null : (
                <TabsTrigger value="feedback" className="flex-none">
                  {m.lms_assignment_tab_feedback()}
                </TabsTrigger>
              )}
            </TabsList>
            {tab === 'details' && a.html ? <DisplayMenu /> : null}
          </div>
          <TabsContent
            value="details"
            className="flex min-h-0 flex-col gap-4 overflow-y-auto px-7 py-5"
          >
            <SourceNote detail={detail} provider={provider} />
            {a.locked ? (
              <p className="flex items-start gap-2 rounded-xl bg-muted px-3 py-2 text-sm">
                <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                {a.lock_explanation || m.lms_assignment_locked({ provider })}
              </p>
            ) : null}
            {a.html ? (
              <LmsHtml html={a.html} />
            ) : (
              <Empty className="border-0">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FileText />
                  </EmptyMedia>
                  <EmptyTitle>{m.lms_assignment_no_description()}</EmptyTitle>
                </EmptyHeader>
              </Empty>
            )}
          </TabsContent>
          <TabsContent value="feedback" className="min-h-0 space-y-6 overflow-y-auto px-7 py-5">
            <SourceNote detail={detail} provider={provider} />
            {d.partial ? (
              <div className="space-y-3">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-24" />
              </div>
            ) : (
              <>
                <MySubmission
                  courseId={target.courseId}
                  submission={s}
                  marks={detail.marks ?? []}
                  held={detail.held ?? false}
                  asOf={detail.submission_as_of}
                  online={a.online}
                />
                <SubmissionFeedback
                  submission={s ?? { comments: [], rubric_scores: [] }}
                  rubric={a.rubric ?? []}
                />
              </>
            )}
          </TabsContent>
        </Tabs>
        <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l bg-muted/30">
          <div className="space-y-3 p-5">
            <div className="flex items-start justify-between gap-2">
              <AssignmentStatus
                assignment={a}
                submission={s}
                state={state}
                marks={detail.marks ?? []}
                dueState={detail.due_state}
                practice={practice}
                now={d.now}
              />
              <div className="flex shrink-0 items-center gap-1">
                {d.refresh ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="-mt-1"
                          aria-label={m.lms_assignment_refresh()}
                          disabled={d.refreshing}
                          onClick={d.refresh}
                        />
                      }
                    >
                      <RefreshCw aria-hidden className={cn(d.refreshing && 'animate-spin')} />
                    </TooltipTrigger>
                    <TooltipContent>{m.lms_assignment_refresh()}</TooltipContent>
                  </Tooltip>
                ) : null}
                {close}
              </div>
            </div>
            <PlatformButton
              assignment={a}
              submission={s}
              state={state}
              provider={provider}
              practice={practice}
            />
          </div>
          <AssignmentFacts
            assignment={a}
            submission={s}
            state={state}
            quiz={detail.quiz}
            className="border-t px-5 py-4"
          />
          {practice ? null : (
            <div className="border-t px-5 py-4 empty:hidden">
              <InSemestra
                detail={detail}
                pending={d.partial}
                onOpenGrades={d.openGrades}
                onOpenTasks={d.openTasks}
                onImport={d.startImport}
              />
            </div>
          )}
        </aside>
      </LmsContentContext>
    </HideGrades>
  )
}

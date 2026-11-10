import type { Assessment } from '@semestra/api-client'
import {
  lmsAssignmentBindMutation,
  lmsAssignmentListOptions,
  lmsAssignmentUnbindMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardList, Search, SearchX } from 'lucide-react'
import { useId, useState } from 'react'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toastError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import type { AssessmentActionDialogProps } from '@/modules/grading/types'
import { invalidateGrading } from '@/modules/grading/queries'
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
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Field, FieldLabel } from '@/ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/ui/input-group'
import { RadioGroup, RadioGroupItem } from '@/ui/radio-group'
import { Spinner } from '@/ui/spinner'
import { useProgramProviderName } from '../providers'
import { invalidateLms } from '../queries'

/** A list this long gets a search box. */
const SEARCH_FROM = 8

/**
 * Picks the assignment an assessment made by hand follows from now on (M09 §4): the course's
 * assignments not imported yet. Nothing of the assessment changes; what the platform has
 * differently comes as updates to review.
 */
export function BindDialog({
  assessment,
  programId,
  close,
  ...props
}: AssessmentActionDialogProps) {
  const provider = useProgramProviderName(programId) ?? m.lms_platform()
  return (
    <Dialog {...props}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{m.lms_bind_title({ provider })}</DialogTitle>
          <DialogDescription>
            {m.lms_bind_description({ title: assessment?.title ?? '' })}
          </DialogDescription>
        </DialogHeader>
        {assessment ? (
          <AssignmentChoice key={assessment.id} assessment={assessment} close={close} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function AssignmentChoice({ assessment, close }: { assessment: Assessment; close: () => void }) {
  const id = useId()
  const queryClient = useQueryClient()
  const courseId = assessment.course_id
  const [picked, setPicked] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const assignments = useQuery(lmsAssignmentListOptions({ path: { course_id: courseId } }))
  const bind = useMutation({
    ...lmsAssignmentBindMutation(),
    onError: toastError,
    onSuccess: async () => {
      close()
      await Promise.all([invalidateGrading(queryClient), invalidateLms(queryClient, { courseId })])
    },
  })
  const open = (assignments.data?.items ?? []).filter((a) => a.imported_as == null)
  const needle = search.trim().toLocaleLowerCase()
  const shown = needle ? open.filter((a) => a.name.toLocaleLowerCase().includes(needle)) : open

  return (
    <>
      <AsyncBoundary
        query={assignments}
        isEmpty={() => open.length === 0}
        empty={
          <Empty className="border-0 p-0 py-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ClipboardList aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{m.lms_bind_empty()}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        }
      >
        {() => (
          <div className="flex min-h-0 flex-col gap-3">
            {open.length > SEARCH_FROM ? (
              <InputGroup>
                <InputGroupInput
                  aria-label={m.lms_bind_search()}
                  placeholder={m.lms_bind_search()}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <InputGroupAddon>
                  <Search aria-hidden />
                </InputGroupAddon>
              </InputGroup>
            ) : null}
            {shown.length === 0 ? (
              <Empty className="border-0 p-0 py-6">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <SearchX aria-hidden />
                  </EmptyMedia>
                  <EmptyTitle>{m.lms_bind_no_match()}</EmptyTitle>
                </EmptyHeader>
                <EmptyContent>
                  <Button variant="link" size="sm" onClick={() => setSearch('')}>
                    {m.common_clear_filters()}
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              <RadioGroup
                value={picked}
                onValueChange={(value) => setPicked(value as string)}
                className="max-h-80 gap-0 overflow-y-auto"
              >
                {shown.map((a) => {
                  const radio = `${id}-${a.external_id}`
                  const detail = [
                    a.group_name,
                    a.due_at ? formatDateTime(a.due_at) : m.lms_no_due_date(),
                    a.points != null ? m.lms_points({ points: a.points }) : null,
                  ].filter(Boolean)
                  return (
                    <Field
                      key={a.external_id}
                      orientation="horizontal"
                      className="rounded-xl px-2 py-1.5 hover:bg-muted/50"
                    >
                      <RadioGroupItem id={radio} value={a.external_id} />
                      <FieldLabel htmlFor={radio} className="min-w-0 flex-1 font-normal">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{a.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {detail.join(' · ')}
                          </span>
                        </span>
                      </FieldLabel>
                    </Field>
                  )
                })}
              </RadioGroup>
            )}
          </div>
        )}
      </AsyncBoundary>
      <DialogFooter>
        <Button variant="outline" onClick={close}>
          {m.common_cancel()}
        </Button>
        <Button
          disabled={picked === null || bind.isPending}
          onClick={() =>
            picked &&
            bind.mutate({
              path: { assessment_id: assessment.id },
              body: { assignment_id: picked },
            })
          }
        >
          {bind.isPending ? <Spinner /> : null}
          {m.lms_bind_confirm()}
        </Button>
      </DialogFooter>
    </>
  )
}

/** Unbinding keeps the assessment as it is: confirmed, since its updates stop (M00 §4.8). */
export function UnbindDialog({
  assessment,
  programId,
  close,
  ...props
}: AssessmentActionDialogProps) {
  const queryClient = useQueryClient()
  const provider = useProgramProviderName(programId) ?? m.lms_platform()
  const unbind = useMutation({
    ...lmsAssignmentUnbindMutation(),
    onError: toastError,
    onSuccess: async () => {
      close()
      await Promise.all([
        invalidateGrading(queryClient),
        invalidateLms(queryClient, { courseId: assessment?.course_id }),
      ])
    },
  })
  return (
    <ConfirmDialog
      {...props}
      title={m.lms_unbind_title()}
      description={m.lms_unbind_description({ title: assessment?.title ?? '', provider })}
      confirmLabel={m.lms_unbind_confirm()}
      pending={unbind.isPending}
      onConfirm={() => assessment && unbind.mutate({ path: { assessment_id: assessment.id } })}
    />
  )
}

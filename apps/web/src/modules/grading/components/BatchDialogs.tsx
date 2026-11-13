import type { Assessment } from '@semestra/api-client'
import {
  gradingAssessmentDeleteManyMutation,
  gradingAssessmentUpdateManyMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
import { ChoiceControl, SettingRow, SettingsGroup } from '@/app/settings'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import type { DialogTargetProps } from '@/lib/dialog-target'
import { toastError } from '@/lib/errors'
import { formatPercent } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog'
import { FieldError } from '@/ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/ui/input-group'
import { invalidateGrading } from '../queries'
import { parseDecimal } from '../score'

/** A batch action that asks first: the checked assessments, as they were when it started. */
export type BatchTarget = { kind: 'weight' | 'delete'; assessments: readonly Assessment[] }

type Props = DialogTargetProps & {
  courseId: string
  target: BatchTarget | null
  close: () => void
  /** After deleting: the checked rows are gone. */
  onDeleted: () => void
}

/** The gradebook's batch dialogs; the page keeps them, so they close smoothly. */
export function BatchDialogs({ target, ...props }: Props) {
  return (
    <>
      <WeightDialog
        {...props}
        open={props.open && target?.kind === 'weight'}
        assessments={target?.kind === 'weight' ? target.assessments : []}
      />
      <DeleteDialog
        {...props}
        open={props.open && target?.kind === 'delete'}
        assessments={target?.kind === 'delete' ? target.assessments : []}
      />
    </>
  )
}

type DialogProps = Omit<Props, 'target'> & { assessments: readonly Assessment[] }

function DeleteDialog({ courseId, assessments, close, onDeleted, ...props }: DialogProps) {
  const queryClient = useQueryClient()
  const remove = useMutation({
    ...gradingAssessmentDeleteManyMutation(),
    onError: toastError,
    onSuccess: async () => {
      close()
      onDeleted()
      await invalidateGrading(queryClient)
    },
  })
  return (
    <ConfirmDialog
      {...props}
      title={m.grading_batch_delete_title()}
      description={m.grading_batch_delete_confirm({ count: assessments.length })}
      confirmLabel={m.common_delete()}
      pending={remove.isPending}
      onConfirm={() =>
        remove.mutate({
          path: { course_id: courseId },
          body: { assessment_ids: assessments.map((a) => a.id) },
        })
      }
    />
  )
}

type Mode = 'each' | 'split'

/**
 * One weight for each checked assessment, or a total split evenly among the ones that count (the
 * server splits it to the hundredth so the shares add up exactly; dropped ones keep theirs). It
 * opens on their common weight; when they differ the field starts empty, so saving right away
 * cannot flatten them.
 */
function WeightDialog({ assessments, courseId, close, ...props }: DialogProps) {
  const queryClient = useQueryClient()
  const update = useMutation({
    ...gradingAssessmentUpdateManyMutation(),
    onError: toastError,
    onSuccess: async () => {
      close()
      await invalidateGrading(queryClient)
    },
  })
  return (
    <Dialog
      open={props.open}
      // Saving locks the dialog (M00 §4.8).
      onOpenChange={(next) => !update.isPending && props.onOpenChange(next)}
      onOpenChangeComplete={props.onOpenChangeComplete}
    >
      <DialogContent className="sm:max-w-lg" showCloseButton={!update.isPending}>
        <DialogHeader>
          <DialogTitle>{m.grading_weight_dialog_title()}</DialogTitle>
          <DialogDescription>
            {m.grading_weight_dialog_description({ count: assessments.length })}
          </DialogDescription>
        </DialogHeader>
        {assessments.length > 0 ? (
          <WeightForm
            // The form starts over from the assessments each time the dialog opens.
            key={assessments.map((a) => a.id).join()}
            assessments={assessments}
            pending={update.isPending}
            onSave={(body) =>
              update.mutate({
                path: { course_id: courseId },
                body: { assessment_ids: assessments.map((a) => a.id), ...body },
              })
            }
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

/** Whole hundredths: the server splits a total to the hundredth. */
const hundredths = (value: number) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6

function WeightForm({
  assessments,
  pending,
  onSave,
}: {
  assessments: readonly Assessment[]
  pending: boolean
  onSave: (body: { weight: number } | { total_weight: number }) => void
}) {
  const id = useId()
  const weights = new Set(assessments.map((a) => a.weight))
  const same = weights.size === 1
  const [mode, setMode] = useState<Mode>(same ? 'each' : 'split')
  const [text, setText] = useState(same ? String(assessments[0]!.weight) : '')
  const [touched, setTouched] = useState(false)
  // Dropped ones are left out of the course grade: they neither add to the total nor share it.
  const dropped = assessments.filter((a) => a.dropped).length
  const counted = assessments.length - dropped || assessments.length
  const value = parseDecimal(text)
  const error =
    value === null || value > 100 || (mode === 'each' && value * counted > 100)
      ? m.grading_weight_invalid()
      : mode === 'split' && !hundredths(value)
        ? m.grading_weight_decimals()
        : null
  let hint: string | null = null
  if (value !== null && mode === 'each') {
    const total = formatPercent((value * counted) / 100, 2)
    hint =
      dropped > 0 && dropped < assessments.length
        ? m.grading_weight_each_hint_dropped({ total, count: dropped })
        : m.grading_weight_each_hint({ total })
  } else if (value !== null) {
    const each = formatPercent(value / counted / 100, 2)
    hint =
      dropped > 0 && dropped < assessments.length
        ? m.grading_weight_total_hint_dropped({ each, count: dropped })
        : m.grading_weight_total_hint({ each })
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (error !== null || value === null) return
    onSave(mode === 'each' ? { weight: value } : { total_weight: value })
  }
  const showError = touched && error !== null
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <fieldset disabled={pending} className="contents">
        <SettingsGroup>
          <SettingRow label={m.grading_weight_mode()}>
            {(labelId) => (
              <ChoiceControl
                labelId={labelId}
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'each', label: m.grading_weight_mode_each() },
                  { value: 'split', label: m.grading_weight_mode_split() },
                ]}
              />
            )}
          </SettingRow>
          <SettingRow
            label={mode === 'each' ? m.grading_weight_each_label() : m.grading_weight_total_label()}
            htmlFor={`${id}-weight`}
            description={
              <span id={`${id}-weight-hint`} className="tabular-nums">
                {hint ?? '\u00a0'}
              </span>
            }
            note={showError ? <FieldError id={`${id}-weight-error`}>{error}</FieldError> : null}
          >
            <InputGroup className="w-28">
              <InputGroupInput
                id={`${id}-weight`}
                inputMode="decimal"
                value={text}
                aria-invalid={showError ? true : undefined}
                aria-describedby={showError ? `${id}-weight-error` : `${id}-weight-hint`}
                onChange={(event) => setText(event.target.value)}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText>%</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
          </SettingRow>
        </SettingsGroup>
      </fieldset>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>
          {m.common_cancel()}
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending ? m.common_saving() : m.common_save()}
        </Button>
      </DialogFooter>
    </form>
  )
}

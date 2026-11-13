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

const round2 = (value: number) => Math.round(value * 100) / 100

/**
 * One weight for each checked assessment, or a total split evenly among them (the server splits
 * it to the hundredth so the shares add up exactly). It opens on what they have now: their common
 * weight, or their total when they differ.
 */
function WeightDialog({ assessments, ...props }: DialogProps) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      onOpenChangeComplete={props.onOpenChangeComplete}
    >
      <DialogContent className="sm:max-w-lg">
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
            courseId={props.courseId}
            assessments={assessments}
            close={props.close}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function WeightForm({
  courseId,
  assessments,
  close,
}: Pick<DialogProps, 'courseId' | 'assessments' | 'close'>) {
  const id = useId()
  const queryClient = useQueryClient()
  const weights = new Set(assessments.map((a) => a.weight))
  const same = weights.size === 1
  const [mode, setMode] = useState<Mode>(same ? 'each' : 'split')
  const [text, setText] = useState(() =>
    String(same ? assessments[0]!.weight : round2(assessments.reduce((s, a) => s + a.weight, 0))),
  )
  const [touched, setTouched] = useState(false)
  const update = useMutation({
    ...gradingAssessmentUpdateManyMutation(),
    onError: toastError,
    onSuccess: async () => {
      close()
      await invalidateGrading(queryClient)
    },
  })
  const value = parseDecimal(text)
  const invalid =
    value === null || value > 100 || (mode === 'each' && value * assessments.length > 100)
  const count = assessments.length
  const hint =
    value === null
      ? null
      : mode === 'each'
        ? m.grading_weight_each_hint({ total: formatPercent((value * count) / 100, 2) })
        : m.grading_weight_total_hint({ each: formatPercent(value / count / 100, 2) })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (invalid) return
    const ids = assessments.map((a) => a.id)
    update.mutate({
      path: { course_id: courseId },
      body:
        mode === 'each'
          ? { assessment_ids: ids, weight: value }
          : { assessment_ids: ids, total_weight: value },
    })
  }
  const showError = touched && invalid
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
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
          note={
            showError ? (
              <FieldError id={`${id}-weight-error`}>{m.grading_weight_invalid()}</FieldError>
            ) : null
          }
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
      <DialogFooter>
        <DialogClose
          render={<Button type="button" variant="outline" disabled={update.isPending} />}
        >
          {m.common_cancel()}
        </DialogClose>
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? m.common_saving() : m.common_save()}
        </Button>
      </DialogFooter>
    </form>
  )
}

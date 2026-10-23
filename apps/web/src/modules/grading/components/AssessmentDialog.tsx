import type { Assessment, AssessmentCategory } from '@semestra/api-client'
import {
  gradingAssessmentCreateMutation,
  gradingAssessmentUpdateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDownIcon, Clock2 } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { toastError } from '@/lib/errors'
import { firstDayOfWeek, formatDate } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Calendar } from '@/ui/calendar'
import { Checkbox } from '@/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/ui/input-group'
import { TIME_INPUT } from '@/lib/time-input'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select'
import { Textarea } from '@/ui/textarea'
import { categoryName } from '../display'
import { invalidateGrading } from '../queries'
import { parseDecimal, parseScore, scorePatch, scoreText } from '../score'

const NO_CATEGORY = '__none__'

/** A stored `yyyy-MM-dd` as a local calendar day. The picker never sees the string. */
function dueDateToDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return undefined
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function dateToDueDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Add or edit an assessment with every field (M03 §5.1); quick edits happen in the table. */
export function AssessmentDialog({
  courseId,
  categories,
  assessment,
  open,
  onOpenChange,
}: {
  courseId: string
  categories: readonly AssessmentCategory[]
  /** The assessment to edit; none adds a new one. */
  assessment?: Assessment
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {assessment ? m.grading_assessment_edit() : m.grading_assessment_add()}
          </DialogTitle>
        </DialogHeader>
        {/* Remounted per assessment so the form always starts from the stored values. */}
        <AssessmentForm
          key={assessment ? `${assessment.id}-${assessment.updated_at}` : 'new'}
          courseId={courseId}
          categories={categories}
          assessment={assessment}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function AssessmentForm({
  courseId,
  categories,
  assessment,
  onDone,
}: {
  courseId: string
  categories: readonly AssessmentCategory[]
  assessment?: Assessment
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const id = useId()
  const [title, setTitle] = useState(assessment?.title ?? '')
  const [categoryId, setCategoryId] = useState(assessment?.category_id ?? NO_CATEGORY)
  const [dueDate, setDueDate] = useState(assessment?.due_date ?? '')
  const [dueTime, setDueTime] = useState(assessment?.due_time ?? '')
  const [weight, setWeight] = useState(assessment ? String(assessment.weight) : '')
  const initialScore = assessment ? scoreText(assessment) : ''
  const [score, setScore] = useState(initialScore)
  const [dropped, setDropped] = useState(assessment?.dropped ?? false)
  const [note, setNote] = useState(assessment?.note ?? '')
  const [touched, setTouched] = useState(false)

  const done = async () => {
    await invalidateGrading(queryClient)
    onDone()
  }
  const create = useMutation({
    ...gradingAssessmentCreateMutation(),
    onError: toastError,
    onSuccess: done,
  })
  const update = useMutation({
    ...gradingAssessmentUpdateMutation(),
    onError: toastError,
    onSuccess: done,
  })
  const pending = create.isPending || update.isPending

  const parsedWeight = weight.trim() === '' ? 0 : parseDecimal(weight)
  const weightInvalid = parsedWeight === null || parsedWeight > 100
  const weightValue = parsedWeight ?? 0
  const parsed = parseScore(score)
  const scoreInvalid = parsed.kind === 'invalid'
  const titleMissing = title.trim() === ''
  const selectable = categories.filter((c) => !c.archived || c.id === assessment?.category_id)
  const items = [
    { value: NO_CATEGORY, label: m.grading_category_none() },
    ...selectable.map((c) => ({ value: c.id, label: categoryName(c) })),
  ]

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (titleMissing || weightInvalid || scoreInvalid) return
    const common = {
      title: title.trim(),
      category_id: categoryId === NO_CATEGORY ? null : categoryId,
      due_date: dueDate || null,
      due_time: dueDate && dueTime ? dueTime : null,
      weight: weightValue,
      dropped,
      note: note.trim() || null,
    }
    if (assessment) {
      // Leave the score alone unless it was edited, so a points score keeps its points.
      const changed = score.trim() !== initialScore.trim()
      update.mutate({
        path: { assessment_id: assessment.id },
        body: { ...common, ...(changed ? scorePatch(parsed) : {}) },
      })
      return
    }
    const patch = scorePatch(parsed) ?? {}
    create.mutate({
      path: { course_id: courseId },
      body: {
        ...common,
        score_percentage: patch.score_percentage ?? null,
        points_earned: patch.points_earned ?? null,
        points_possible: patch.points_possible ?? null,
      },
    })
  }

  return (
    <form noValidate onSubmit={submit}>
      <FieldGroup className="gap-4">
        <Field data-invalid={touched && titleMissing ? true : undefined}>
          <FieldLabel htmlFor={`${id}-title`}>{m.grading_assessment_title()}</FieldLabel>
          <Input
            id={`${id}-title`}
            aria-invalid={touched && titleMissing ? true : undefined}
            aria-describedby={touched && titleMissing ? `${id}-title-error` : undefined}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          {touched && titleMissing ? (
            <FieldError id={`${id}-title-error`}>{m.grading_required()}</FieldError>
          ) : null}
        </Field>
        <Field>
          <FieldLabel>{m.grading_assessment_category()}</FieldLabel>
          <Select
            value={categoryId}
            items={items}
            onValueChange={(next) => setCategoryId(String(next ?? NO_CATEGORY))}
          >
            <SelectTrigger aria-label={m.grading_assessment_category()} className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {items.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <div className="flex flex-wrap gap-4">
          <Field className="w-44">
            <FieldLabel htmlFor={`${id}-due-date`}>{m.grading_assessment_due_date()}</FieldLabel>
            <Popover>
              <PopoverTrigger
                render={
                  <Button
                    variant="outline"
                    id={`${id}-due-date`}
                    data-empty={!dueDate}
                    className="justify-between text-left font-normal data-[empty=true]:text-muted-foreground"
                  />
                }
              >
                {dueDate ? formatDate(dueDate) : m.grading_assessment_due_date_placeholder()}
                <ChevronDownIcon data-icon="inline-end" />
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={dueDateToDate(dueDate)}
                  onSelect={(day) => setDueDate(day ? dateToDueDate(day) : '')}
                  defaultMonth={dueDateToDate(dueDate)}
                  weekStartsOn={(firstDayOfWeek() % 7) as 0 | 1}
                />
              </PopoverContent>
            </Popover>
          </Field>
          <Field className="w-auto">
            <FieldLabel htmlFor={`${id}-due-time`}>{m.grading_assessment_due_time()}</FieldLabel>
            <InputGroup data-disabled={dueDate === '' || undefined}>
              <InputGroupInput
                id={`${id}-due-time`}
                type="time"
                className={TIME_INPUT}
                value={dueTime}
                disabled={dueDate === ''}
                onChange={(event) => setDueTime(event.target.value)}
              />
              <InputGroupAddon>
                <Clock2 aria-hidden />
              </InputGroupAddon>
            </InputGroup>
          </Field>
        </div>
        <div className="flex flex-wrap gap-4">
          <Field className="w-32" data-invalid={touched && weightInvalid ? true : undefined}>
            <FieldLabel htmlFor={`${id}-weight`}>{m.grading_assessment_weight()}</FieldLabel>
            <Input
              id={`${id}-weight`}
              type="number"
              inputMode="decimal"
              step="any"
              min={0}
              max={100}
              placeholder="0"
              value={weight}
              aria-invalid={touched && weightInvalid ? true : undefined}
              aria-describedby={touched && weightInvalid ? `${id}-weight-error` : undefined}
              onChange={(event) => setWeight(event.target.value)}
            />
            {touched && weightInvalid ? (
              <FieldError id={`${id}-weight-error`}>{m.grading_weight_invalid()}</FieldError>
            ) : null}
          </Field>
          <Field className="w-40" data-invalid={touched && scoreInvalid ? true : undefined}>
            <FieldLabel htmlFor={`${id}-score`}>{m.grading_assessment_score()}</FieldLabel>
            <Input
              id={`${id}-score`}
              placeholder="82 · 18/20"
              value={score}
              aria-invalid={touched && scoreInvalid ? true : undefined}
              aria-describedby={touched && scoreInvalid ? `${id}-score-error` : `${id}-score-hint`}
              onChange={(event) => setScore(event.target.value)}
            />
            {touched && scoreInvalid ? (
              <FieldError id={`${id}-score-error`}>{m.grading_score_invalid()}</FieldError>
            ) : (
              <FieldDescription id={`${id}-score-hint`}>{m.grading_score_hint()}</FieldDescription>
            )}
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor={`${id}-note`}>{m.grading_assessment_note()}</FieldLabel>
          <Textarea
            id={`${id}-note`}
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        <Field orientation="horizontal">
          <Checkbox
            id={`${id}-dropped`}
            checked={dropped}
            onCheckedChange={(checked) => setDropped(checked)}
          />
          <FieldLabel htmlFor={`${id}-dropped`} className="font-normal">
            {m.grading_assessment_dropped()}
          </FieldLabel>
        </Field>
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? m.common_saving() : m.common_save()}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}

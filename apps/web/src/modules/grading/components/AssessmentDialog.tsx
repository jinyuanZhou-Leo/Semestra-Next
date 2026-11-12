import type { Assessment, AssessmentCategory } from '@semestra/api-client'
import {
  gradingAssessmentCreateMutation,
  gradingAssessmentUpdateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Clock2 } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { SettingRow, SettingsGroup } from '@/app/settings'
import { DateField } from '@/components/DateField'
import { FieldOrigins, type OriginValue } from '@/components/FieldOrigins'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog'
import { FieldError } from '@/ui/field'
import { Input } from '@/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/ui/input-group'
import { TIME_INPUT } from '@/lib/time-input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select'
import { Switch } from '@/ui/switch'
import { Textarea } from '@/ui/textarea'
import { categoryName } from '../display'
import { invalidateGrading } from '../queries'
import { parseDecimal, parseScore, scorePatch, scoreText } from '../score'

const NO_CATEGORY = '__none__'

/** Add or edit an assessment with every field (M03 §5.1); quick edits happen in the table. */
export function AssessmentDialog({
  courseId,
  categories,
  assessment,
  open,
  onOpenChangeComplete,
  onOpenChange,
}: {
  courseId: string
  categories: readonly AssessmentCategory[]
  /** The assessment to edit; none adds a new one. */
  assessment?: Assessment
  open: boolean
  onOpenChangeComplete?: (open: boolean) => void
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChangeComplete={onOpenChangeComplete} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
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

  /** Puts another source's value of a field (the LMS's) into the form. */
  const origin = (field: 'title' | 'due_at' | 'weight' | 'score') =>
    assessment ? (
      <FieldOrigins
        targetId={assessment.id}
        field={field}
        onApply={(value: OriginValue) => {
          if (field === 'title') setTitle(String(value))
          else if (field === 'weight') setWeight(String(value ?? 0))
          else if (value === null) {
            // The source has none: no due date, no grade.
            if (field === 'due_at') {
              setDueDate('')
              setDueTime('')
            } else setScore('')
          } else if (field === 'due_at' && typeof value === 'object' && 'date' in value) {
            setDueDate(value.date)
            setDueTime(value.time?.slice(0, 5) ?? '')
          } else if (field === 'score' && typeof value === 'object' && !('date' in value)) {
            setScore(
              scoreText({
                score_percentage: value.score_percentage ?? null,
                points_earned: value.points_earned ?? null,
                points_possible: value.points_possible ?? null,
              }),
            )
          }
        }}
      />
    ) : null

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
    <form noValidate onSubmit={submit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <SettingsGroup>
          <SettingRow
            label={m.grading_assessment_title()}
            htmlFor={`${id}-title`}
            note={
              touched && titleMissing ? (
                <FieldError id={`${id}-title-error`}>{m.grading_required()}</FieldError>
              ) : null
            }
          >
            <div className="flex items-center gap-2">
              {origin('title')}
              <Input
                id={`${id}-title`}
                className="w-72"
                aria-invalid={touched && titleMissing ? true : undefined}
                aria-describedby={touched && titleMissing ? `${id}-title-error` : undefined}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
          </SettingRow>
          <SettingRow label={m.grading_assessment_category()} htmlFor={`${id}-category`}>
            <Select
              value={categoryId}
              items={items}
              onValueChange={(next) => setCategoryId(String(next ?? NO_CATEGORY))}
            >
              <SelectTrigger id={`${id}-category`} className="w-72">
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
          </SettingRow>
          <SettingRow label={m.grading_assessment_due()} htmlFor={`${id}-due`}>
            <div className="flex items-center gap-2">
              {origin('due_at')}
              <DateField
                id={`${id}-due`}
                className="w-40"
                value={dueDate}
                onChange={setDueDate}
                placeholder={m.grading_assessment_due_date_placeholder()}
              />
              <InputGroup className="w-28" data-disabled={dueDate === '' || undefined}>
                <InputGroupInput
                  type="time"
                  aria-label={m.grading_assessment_due_time()}
                  className={TIME_INPUT}
                  value={dueTime}
                  disabled={dueDate === ''}
                  onChange={(event) => setDueTime(event.target.value)}
                />
                <InputGroupAddon>
                  <Clock2 aria-hidden />
                </InputGroupAddon>
              </InputGroup>
            </div>
          </SettingRow>
        </SettingsGroup>
        <SettingsGroup>
          <SettingRow
            label={m.grading_assessment_weight()}
            htmlFor={`${id}-weight`}
            note={
              touched && weightInvalid ? (
                <FieldError id={`${id}-weight-error`}>{m.grading_weight_invalid()}</FieldError>
              ) : null
            }
          >
            <div className="flex items-center gap-2">
              {origin('weight')}
              <Input
                id={`${id}-weight`}
                className="w-28"
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
            </div>
          </SettingRow>
          <SettingRow
            label={m.grading_assessment_score()}
            htmlFor={`${id}-score`}
            description={<span id={`${id}-score-hint`}>{m.grading_score_hint()}</span>}
            note={
              touched && scoreInvalid ? (
                <FieldError id={`${id}-score-error`}>{m.grading_score_invalid()}</FieldError>
              ) : null
            }
          >
            <div className="flex items-center gap-2">
              {origin('score')}
              <Input
                id={`${id}-score`}
                className="w-28"
                placeholder="82"
                value={score}
                aria-invalid={touched && scoreInvalid ? true : undefined}
                aria-describedby={
                  touched && scoreInvalid ? `${id}-score-error` : `${id}-score-hint`
                }
                onChange={(event) => setScore(event.target.value)}
              />
            </div>
          </SettingRow>
          <SettingRow
            label={m.grading_assessment_dropped()}
            description={m.grading_assessment_dropped_description()}
            htmlFor={`${id}-dropped`}
          >
            <Switch
              id={`${id}-dropped`}
              checked={dropped}
              onCheckedChange={(checked) => setDropped(checked)}
            />
          </SettingRow>
        </SettingsGroup>
        <Textarea
          aria-label={m.grading_assessment_note()}
          placeholder={m.grading_assessment_note()}
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
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

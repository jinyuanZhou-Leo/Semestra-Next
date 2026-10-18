import type { Assessment, AssessmentCategory } from '@semestra/api-client'
import {
  gradingAssessmentCreateMutation,
  gradingAssessmentUpdateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { TextField } from '@/components/TextField'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog'
import { Label } from '@/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { Textarea } from '@/ui/textarea'
import { categoryName } from '../display'
import { invalidateGrading } from '../queries'
import { parseScore, scorePatch, scoreText } from '../score'

const NO_CATEGORY = '__none__'

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
      <DialogContent closeLabel={m.common_close()}>
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

  const weightValue = weight.trim() === '' ? 0 : Number(weight)
  const weightInvalid = !(weightValue >= 0 && weightValue <= 100)
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
    <form noValidate onSubmit={submit} className="space-y-4">
      <TextField
        label={m.grading_assessment_title()}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        error={touched && titleMissing ? m.grading_required() : null}
      />
      <div>
        <Label className="mb-2">{m.grading_assessment_category()}</Label>
        <Select
          value={categoryId}
          items={items}
          onValueChange={(next) => setCategoryId(String(next ?? NO_CATEGORY))}
        >
          <SelectTrigger aria-label={m.grading_assessment_category()} className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap gap-4">
        <TextField
          type="date"
          label={m.grading_assessment_due_date()}
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
        />
        <TextField
          type="time"
          label={m.grading_assessment_due_time()}
          value={dueTime}
          disabled={dueDate === ''}
          onChange={(event) => setDueTime(event.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-4">
        <TextField
          label={m.grading_assessment_weight()}
          type="number"
          inputMode="decimal"
          step="any"
          min={0}
          max={100}
          className="w-32"
          placeholder="0"
          value={weight}
          onChange={(event) => setWeight(event.target.value)}
          error={touched && weightInvalid ? m.grading_weight_invalid() : null}
        />
        <TextField
          label={m.grading_assessment_score()}
          className="w-40"
          placeholder="82 · 18/20"
          value={score}
          onChange={(event) => setScore(event.target.value)}
          hint={m.grading_score_hint()}
          error={touched && scoreInvalid ? m.grading_score_invalid() : null}
        />
      </div>
      <div>
        <Label className="mb-2">{m.grading_assessment_note()}</Label>
        <Textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={dropped} onCheckedChange={(checked) => setDropped(checked)} />
        {m.grading_assessment_dropped()}
      </label>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? m.common_saving() : m.common_save()}
        </Button>
      </div>
    </form>
  )
}

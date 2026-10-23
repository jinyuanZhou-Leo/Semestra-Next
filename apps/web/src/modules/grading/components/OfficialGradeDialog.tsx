import type { CourseResult } from '@semestra/api-client'
import { gradingCourseResultUpdateMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
import { toastError } from '@/lib/errors'
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
import { Field, FieldError, FieldGroup, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import { invalidateGrading } from '../queries'
import { parseDecimal } from '../score'

/** The official final grade, which replaces the computed one (M03 §5.1). */
export function OfficialGradeDialog({
  result,
  open,
  onOpenChange,
}: {
  result: CourseResult
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{m.grading_official_grade()}</DialogTitle>
          <DialogDescription>{m.grading_official_hint()}</DialogDescription>
        </DialogHeader>
        <OfficialGradeForm
          key={`${result.final_override_percentage ?? ''}-${String(open)}`}
          result={result}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function OfficialGradeForm({ result, onDone }: { result: CourseResult; onDone: () => void }) {
  const id = useId()
  const queryClient = useQueryClient()
  const [text, setText] = useState(
    result.final_override_percentage === null ? '' : String(result.final_override_percentage),
  )
  const [touched, setTouched] = useState(false)
  const update = useMutation({
    ...gradingCourseResultUpdateMutation(),
    onError: toastError,
    onSuccess: async () => {
      await invalidateGrading(queryClient)
      onDone()
    },
  })
  const value = parseDecimal(text)
  const invalid = value === null || value > 1000
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (invalid) return
    update.mutate({
      path: { course_id: result.course_id },
      body: { final_override_percentage: value },
    })
  }
  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <Field data-invalid={touched && invalid ? true : undefined}>
          <FieldLabel htmlFor={`${id}-official`}>{m.grading_percentage()}</FieldLabel>
          <Input
            id={`${id}-official`}
            inputMode="decimal"
            placeholder={m.grading_official_placeholder()}
            value={text}
            aria-invalid={touched && invalid ? true : undefined}
            aria-describedby={touched && invalid ? `${id}-official-error` : undefined}
            onChange={(event) => setText(event.target.value)}
          />
          {touched && invalid ? (
            <FieldError id={`${id}-official-error`}>{m.grading_official_invalid()}</FieldError>
          ) : null}
        </Field>
        <DialogFooter>
          <Button type="submit" disabled={update.isPending}>
            {update.isPending ? m.common_saving() : m.common_save()}
          </Button>
        </DialogFooter>
      </FieldGroup>
    </form>
  )
}

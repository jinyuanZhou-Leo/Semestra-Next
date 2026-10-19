import { academicsCourseCreateMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import { invalidateAcademics, useProgram } from '../queries'

/** "Add course" on a term: code, title, credits and whether it is year-long (M02 §5.4). */
export function AddCourseDialog({
  programId,
  termId,
  open,
  onOpenChange,
}: {
  programId: string
  termId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const id = useId()
  const queryClient = useQueryClient()
  const defaultCredits = useProgram(programId).data?.default_course_credits ?? 0.5
  const [code, setCode] = useState('')
  const [title, setTitle] = useState('')
  const [credits, setCredits] = useState('')
  const [yearLong, setYearLong] = useState(false)
  const [touched, setTouched] = useState(false)
  const reset = () => {
    setCode('')
    setTitle('')
    setCredits('')
    setYearLong(false)
    setTouched(false)
  }
  const create = useMutation({
    ...academicsCourseCreateMutation(),
    onError: toastError,
    onSuccess: async () => {
      await invalidateAcademics(queryClient)
      reset()
      onOpenChange(false)
    },
  })
  const titleMissing = title.trim() === ''
  const creditsValue = credits.trim() === '' ? null : Number(credits)
  const creditsInvalid = creditsValue !== null && !(creditsValue >= 0 && creditsValue <= 100)
  const titleError = touched && titleMissing
  const creditsError = touched && creditsInvalid

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (titleMissing || creditsInvalid) return
    create.mutate({
      path: { program_id: programId },
      body: {
        code: code.trim() || null,
        title: title.trim(),
        credits: creditsValue,
        planned_terms: yearLong ? 2 : 1,
        term_ids: [termId],
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !create.isPending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.academics_course_add()}</DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={submit}>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor={`${id}-code`}>{m.academics_course_code()}</FieldLabel>
              <Input
                id={`${id}-code`}
                placeholder="APS105H1"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </Field>
            <Field data-invalid={titleError || undefined}>
              <FieldLabel htmlFor={`${id}-title`}>{m.academics_course_title()}</FieldLabel>
              <Input
                id={`${id}-title`}
                aria-invalid={titleError || undefined}
                aria-describedby={titleError ? `${id}-title-error` : undefined}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
              {titleError ? (
                <FieldError id={`${id}-title-error`}>{m.academics_required()}</FieldError>
              ) : null}
            </Field>
            <Field data-invalid={creditsError || undefined} className="max-w-40">
              <FieldLabel htmlFor={`${id}-credits`}>{m.academics_course_credits()}</FieldLabel>
              <Input
                id={`${id}-credits`}
                type="number"
                inputMode="decimal"
                step="any"
                min={0}
                aria-invalid={creditsError || undefined}
                aria-describedby={creditsError ? `${id}-credits-error` : undefined}
                placeholder={String(defaultCredits)}
                value={credits}
                onChange={(event) => setCredits(event.target.value)}
              />
              {creditsError ? (
                <FieldError id={`${id}-credits-error`}>{m.academics_credits_invalid()}</FieldError>
              ) : null}
            </Field>
            <Field orientation="horizontal">
              <Checkbox
                id={`${id}-year-long`}
                checked={yearLong}
                onCheckedChange={(checked) => setYearLong(checked)}
              />
              <FieldLabel htmlFor={`${id}-year-long`} className="font-normal">
                {m.academics_course_year_long_planned()}
              </FieldLabel>
            </Field>
            <DialogFooter className="w-full">
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? m.common_saving() : m.academics_course_add()}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

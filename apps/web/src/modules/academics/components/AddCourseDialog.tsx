import { academicsCourseCreateMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { TextField } from '@/components/TextField'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { AppDialogContent } from '@/components/AppDialogContent'
import { Dialog, DialogHeader, DialogTitle } from '@/ui/dialog'
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
      <AppDialogContent>
        <DialogHeader>
          <DialogTitle>{m.academics_course_add()}</DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="space-y-4">
          <TextField
            label={m.academics_course_code()}
            placeholder="APS105H1"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <TextField
            label={m.academics_course_title()}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            error={touched && titleMissing ? m.academics_required() : null}
          />
          <TextField
            label={m.academics_course_credits()}
            type="number"
            inputMode="decimal"
            step="any"
            min={0}
            className="max-w-40"
            placeholder={String(defaultCredits)}
            value={credits}
            onChange={(event) => setCredits(event.target.value)}
            error={touched && creditsInvalid ? m.academics_credits_invalid() : null}
          />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={yearLong} onCheckedChange={(checked) => setYearLong(checked)} />
            {m.academics_course_year_long_planned()}
          </label>
          <div className="flex justify-end">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? m.common_saving() : m.academics_course_add()}
            </Button>
          </div>
        </form>
      </AppDialogContent>
    </Dialog>
  )
}

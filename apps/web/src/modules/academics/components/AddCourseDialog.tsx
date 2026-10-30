import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toastError } from '@/lib/errors'
import { formatDate } from '@/lib/format'
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
import { createCourses } from '../add-courses'
import { useProgram, useTerms } from '../queries'
import { CourseRowsEditor } from '../wizard/CourseRowsEditor'
import { type DraftRow, filledRows, newRowKey, rowsInvalid } from '../wizard/draft'

const blankRow = (): DraftRow => ({
  key: newRowKey(),
  code: '',
  title: '',
  credits: '',
  yearLong: false,
})

/**
 * "Add course → Enter manually" (M02 §5.4): the term wizard's course rows, created in one go.
 * Imports and continuing courses are in the add-course menu itself.
 */
export function AddCourseDialog({
  programId,
  termId,
  onClose,
}: {
  programId: string
  termId: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const defaultCredits = useProgram(programId).data?.default_course_credits ?? 0.5
  const term = useTerms(programId).data?.items.find((t) => t.id === termId)
  const [open, setOpen] = useState(true)
  const [rows, setRows] = useState<DraftRow[]>(() => [blankRow()])
  const [touched, setTouched] = useState(false)
  const filled = filledRows(rows)

  const create = useMutation({
    mutationFn: () => createCourses(queryClient, { programId, termId, rows, sources: [] }),
    onError: toastError,
    onSuccess: () => setOpen(false),
  })

  const submit = () => {
    setTouched(true)
    if (rowsInvalid(rows) || filled.length === 0) return
    create.mutate()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !create.isPending && setOpen(next)}
      onOpenChangeComplete={(next) => !next && onClose()}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{m.academics_course_add()}</DialogTitle>
          {term ? (
            <DialogDescription>
              {term.name} · {formatDate(`${term.start_date}T00:00`)} –{' '}
              {formatDate(`${term.end_date}T00:00`)}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          <CourseRowsEditor
            programId={programId}
            rows={rows}
            touched={touched}
            defaultCredits={defaultCredits}
            onRowsChange={(update) => setRows(update)}
          />
        </div>
        <DialogFooter className="items-center sm:justify-between">
          <span className="truncate text-sm text-muted-foreground">
            {m.academics_wizard_summary_courses({ count: filled.length })}
          </span>
          <Button onClick={submit} disabled={create.isPending}>
            {create.isPending ? m.common_saving() : m.academics_course_add_submit()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

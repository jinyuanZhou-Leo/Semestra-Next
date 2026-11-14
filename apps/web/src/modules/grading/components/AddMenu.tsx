import { gradingAssessmentCreateManyMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useExtensions } from '@/app/registry'
import { ImportSourceItems } from '@/components/ImportSourceItems'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { invalidateGrading } from '../queries'
import { ASSESSMENT_IMPORT_SOURCES, type AssessmentImportSource } from '../types'

/**
 * Runs an import source on a course: the assessments it brings back are created in one call
 * (a source that commits on its own, like a syllabus, brings back none). Also used by the empty
 * gradebook's suggested source.
 */
export function useImportSource(programId: string, courseId: string) {
  const queryClient = useQueryClient()
  const add = useMutation({ ...gradingAssessmentCreateManyMutation(), onError: toastError })
  const run = async (source: AssessmentImportSource) => {
    try {
      const drafts = await source.launch({ programId, courseId })
      if (drafts.length === 0) return
      const result = await add.mutateAsync({
        path: { course_id: courseId },
        body: { assessments: drafts },
      })
      await invalidateGrading(queryClient)
      toast.success(m.grading_import_done({ count: result.created.length }))
    } catch (error) {
      toastError(error)
    }
  }
  return { run, pending: add.isPending }
}

/**
 * The gradebook's "Add": an assessment by hand, or from the sources other modules contribute
 * (a syllabus's grading scheme, LMS assignments). Without sources it is a plain button.
 */
export function AddMenu({
  programId,
  courseId,
  onAdd,
}: {
  programId: string
  courseId: string
  onAdd: () => void
}) {
  const sources = useExtensions<AssessmentImportSource>(ASSESSMENT_IMPORT_SOURCES)
  useQueries({
    queries: sources.flatMap((s) => (s.query ? [s.query({ programId, courseId })] : [])),
  })
  const { run, pending } = useImportSource(programId, courseId)

  if (sources.length === 0) {
    return (
      <Button size="sm" onClick={onAdd}>
        <Plus aria-hidden />
        {m.grading_assessment_add()}
      </Button>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="sm" disabled={pending} />}>
        <Plus aria-hidden />
        {m.grading_add()}
        <ChevronDown aria-hidden data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuItem onClick={onAdd}>
          <Plus aria-hidden />
          {m.grading_assessment_add()}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <ImportSourceItems
          sources={sources}
          onPick={(source) => void run(source)}
          titleProps={{ programId, courseId }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

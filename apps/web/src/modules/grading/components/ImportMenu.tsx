import { gradingAssessmentCreateManyMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { useExtensions } from '@/app/registry'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { invalidateGrading } from '../queries'
import { ASSESSMENT_IMPORT_SOURCES, type AssessmentImportSource } from '../types'

/** "Import from…": the sources other modules contribute (LMS assignments, syllabus scheme). */
export function ImportMenu({ programId, courseId }: { programId: string; courseId: string }) {
  const queryClient = useQueryClient()
  const sources = useExtensions<AssessmentImportSource>(ASSESSMENT_IMPORT_SOURCES)
  const add = useMutation({ ...gradingAssessmentCreateManyMutation(), onError: toastError })

  if (sources.length === 0) return null
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
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" disabled={add.isPending} />}>
        <Download aria-hidden />
        {m.grading_import()}
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {sources.map((source) => (
          <DropdownMenuItem key={source.id} onClick={() => void run(source)}>
            <source.icon aria-hidden />
            {source.title()}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

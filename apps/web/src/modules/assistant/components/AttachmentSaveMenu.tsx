import type { AgentScope } from '@semestra/api-client'
import { attachmentsSaveMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, FolderCheck, FolderInput } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { invalidateOperations } from '@/app/api'
import { courseLabel } from '@/modules/academics/color'
import { PreviewDialog } from '@/modules/files/components/PreviewDialog'
import { useFileItem } from '@/modules/files/queries'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { AttachmentAction, AttachmentActions } from '@/ui/attachment'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { useProgramEntities } from '../scope'

/** "Save to course files" on an attachment of a sent message: the courses of the term the
 * conversation works in (all of the Program's without one). Once saved, the course it went to
 * is checked and the saved file can be opened from here. */
export function AttachmentSaveMenu({
  attachmentId,
  name,
  scope,
  fileItemId,
}: {
  attachmentId: string
  name: string
  scope: AgentScope | null
  /** The course file it was saved as, if it was. */
  fileItemId: string | null
}) {
  const queryClient = useQueryClient()
  const { courses } = useProgramEntities(scope?.program_id)
  const saved = useFileItem(fileItemId).data
  const [preview, setPreview] = useState(false)
  const termId = scope?.term_id
  const shown = termId ? courses.filter((c) => c.term_ids.includes(termId)) : courses
  const save = useMutation({
    ...attachmentsSaveMutation(),
    onSuccess: (_, variables) => {
      const course = courses.find((c) => c.id === variables.body.course_id)
      toast.success(
        m.assistant_attachment_saved({ name, course: course ? courseLabel(course) : '' }),
      )
      void invalidateOperations(queryClient, ['agentSessionGet', 'filesList'])
    },
    onError: toastError,
  })
  if (shown.length === 0 && !saved) return null
  const savedCourse = saved ? courses.find((c) => c.id === saved.course_id) : undefined
  const label = savedCourse
    ? m.assistant_attachment_saved_to({ course: courseLabel(savedCourse) })
    : m.assistant_attachment_save({ name })
  return (
    <AttachmentActions>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                render={<AttachmentAction aria-label={label} disabled={save.isPending} />}
              />
            }
          >
            {saved ? <FolderCheck /> : <FolderInput />}
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          {saved ? (
            <>
              <DropdownMenuItem onClick={() => setPreview(true)}>
                {m.assistant_attachment_open()}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuGroup>
            <DropdownMenuLabel>{m.assistant_attachment_save_to()}</DropdownMenuLabel>
            {shown.map((course) => (
              <DropdownMenuItem
                key={course.id}
                onClick={() =>
                  save.mutate({ path: { id: attachmentId }, body: { course_id: course.id } })
                }
              >
                <span className="flex-1 truncate">{courseLabel(course)}</span>
                {saved?.course_id === course.id ? <Check /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <PreviewDialog
        target={preview && fileItemId ? { itemId: fileItemId } : null}
        onClose={() => setPreview(false)}
      />
    </AttachmentActions>
  )
}

import type { AgentScope } from '@semestra/api-client'
import { attachmentsSaveMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FolderInput } from 'lucide-react'
import { toast } from 'sonner'
import { invalidateOperations } from '@/app/api'
import { courseLabel } from '@/modules/academics/color'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { AttachmentAction, AttachmentActions } from '@/ui/attachment'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { useProgramEntities } from '../scope'

/** "Save to course files" on an attachment of a sent message: the courses of the term the
 * conversation works in (all of the Program's without one). */
export function AttachmentSaveMenu({
  attachmentId,
  name,
  scope,
}: {
  attachmentId: string
  name: string
  scope: AgentScope | null
}) {
  const queryClient = useQueryClient()
  const { courses } = useProgramEntities(scope?.program_id)
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
  if (shown.length === 0) return null
  const label = m.assistant_attachment_save({ name })
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
            <FolderInput />
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{m.assistant_attachment_save_to()}</DropdownMenuLabel>
            {shown.map((course) => (
              <DropdownMenuItem
                key={course.id}
                onClick={() =>
                  save.mutate({ path: { id: attachmentId }, body: { course_id: course.id } })
                }
              >
                <span className="truncate">{courseLabel(course)}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </AttachmentActions>
  )
}

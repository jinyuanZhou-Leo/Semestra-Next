import type { Term } from '@semestra/api-client'
import {
  academicsTermDeleteMutation,
  academicsTermDeletePreviewOptions,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { programPath, termPath } from '../paths'
import { invalidateAcademics } from '../queries'

/** Deleting a term says first how many courses go with it and how many year-long ones stay. */
export function DeleteTermDialog({
  term,
  open,
  onOpenChange,
}: {
  term: Pick<Term, 'id' | 'name' | 'program_id'>
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const preview = useQuery({
    ...academicsTermDeletePreviewOptions({ path: { term_id: term.id } }),
    enabled: open,
  })
  const remove = useMutation({
    ...academicsTermDeleteMutation(),
    onError: toastError,
    onSuccess: async () => {
      onOpenChange(false)
      const here = router.state.location.pathname
      const termHref = termPath(term.program_id, term.id)
      if (here === termHref || here.startsWith(`${termHref}/`)) {
        router.history.push(programPath(term.program_id))
      }
      await invalidateAcademics(queryClient)
    },
  })
  const counts = preview.data
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={m.academics_term_delete_title({ name: term.name })}
      description={
        counts ? (
          <>
            {m.academics_term_delete_courses({ count: counts.deleted_course_count })}
            {counts.kept_course_count > 0
              ? ` ${m.academics_term_delete_kept({ count: counts.kept_course_count })}`
              : null}{' '}
            {m.academics_cannot_undo()}
          </>
        ) : (
          m.common_loading()
        )
      }
      confirmLabel={m.academics_term_delete()}
      pending={remove.isPending}
      confirmDisabled={!counts}
      onConfirm={() => remove.mutate({ path: { term_id: term.id } })}
    />
  )
}

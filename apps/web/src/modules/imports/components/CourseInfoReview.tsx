import type { ImportSessionDetail } from '@semestra/api-client'
import {
  importsSessionCommitMutation,
  importsSessionDiscardMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowDown } from 'lucide-react'
import { toast } from 'sonner'
import { invalidateOperations } from '@/app/api'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { DialogFooter } from '@/ui/dialog'
import { unsureFields } from '../labels'
import { settleEdits, storeSession } from '../queries'
import { PatchEditor } from './ItemEditor'

/**
 * The review of a course settings "Read from a file" (M08 §6.1): the changed fields, old → new,
 * each to tick. Applying is the confirmation; nothing is written before. Closing keeps it waiting
 * for review like any import; "Discard" ends it.
 */
export function CourseInfoReview({
  session,
  onDone,
}: {
  session: ImportSessionDetail
  onDone: (session: ImportSessionDetail | null) => void
}) {
  const queryClient = useQueryClient()
  const commit = useMutation({ ...importsSessionCommitMutation(), onError: toastError })
  const discard = useMutation({ ...importsSessionDiscardMutation(), onError: toastError })
  const patch = session.items.find((i) => i.type === 'course_patch')
  const busy = commit.isPending || discard.isPending
  const unsure = patch ? unsureFields(patch).length : 0
  const showUnsure = () =>
    document.querySelector('[data-unsure]')?.scrollIntoView({ block: 'start', behavior: 'smooth' })

  const apply = async () => {
    await settleEdits()
    const result = await commit
      .mutateAsync({ path: { session_id: session.id }, body: {} })
      .catch(() => null) // reported by onError
    if (!result) return
    storeSession(queryClient, result.session)
    toast.success(m.imports_course_info_applied())
    onDone(result.session)
  }
  const drop = () =>
    discard.mutate(
      { path: { session_id: session.id } },
      {
        onSuccess: () => {
          void invalidateOperations(queryClient, ['importsSessionGet', 'importsSessionList'])
          onDone(null)
        },
      },
    )

  return (
    <>
      {patch ? (
        <div className="min-h-0 overflow-y-auto">
          <PatchEditor item={patch} editable={!busy} />
        </div>
      ) : null}
      <DialogFooter>
        <Button variant="destructive" className="mr-auto" disabled={busy} onClick={drop}>
          {m.imports_discard()}
        </Button>
        {unsure > 0 ? (
          <Button variant="link" className="px-1 text-warning" onClick={showUnsure}>
            {m.imports_needs_check({ count: unsure })}
            <ArrowDown aria-hidden />
          </Button>
        ) : null}
        <Button disabled={busy || !patch} onClick={() => void apply()}>
          {m.imports_course_info_apply()}
        </Button>
      </DialogFooter>
    </>
  )
}

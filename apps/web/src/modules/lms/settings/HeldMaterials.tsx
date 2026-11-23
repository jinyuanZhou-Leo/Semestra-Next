import {
  lmsMaterialCountLeftOptions,
  lmsMaterialRemoveLeftMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Cloud, HardDrive } from 'lucide-react'
import { useState } from 'react'
import { SettingRow, SettingsGroup } from '@/app/settings'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'

/**
 * Under the materials settings (account, or one course): turning the sync off leaves what came
 * in, no longer following the platform. This row says how much is left and removes it, so
 * turning materials off is never too late (M09 §4.2). Turning the sync on again brings them back.
 */
export function HeldMaterials({ courseId, provider }: { courseId?: string; provider: string }) {
  const queryClient = useQueryClient()
  const options = lmsMaterialCountLeftOptions(courseId ? { query: { course_id: courseId } } : {})
  const held = useQuery(options).data
  const [confirming, setConfirming] = useState(false)
  const remove = useMutation({
    ...lmsMaterialRemoveLeftMutation(),
    onSuccess: async (left) => {
      setConfirming(false)
      // The files removed refetch the rest (`files.item.deleted`).
      queryClient.setQueryData(options.queryKey, left)
    },
    onError: toastError,
  })
  const total = held ? held.local + held.online : 0
  if (!held || total === 0) return null

  return (
    <>
      <SettingsGroup>
        <SettingRow
          label={m.lms_materials_held_label()}
          description={
            courseId
              ? m.lms_materials_held_course({ count: total, provider })
              : m.lms_materials_held_account({ count: total, courses: held.courses, provider })
          }
        >
          <Button size="sm" variant="destructive" onClick={() => setConfirming(true)}>
            {m.lms_materials_held_remove()}
          </Button>
        </SettingRow>
      </SettingsGroup>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={m.lms_materials_held_confirm_title()}
        description={m.lms_materials_held_confirm_desc()}
        extra={
          <ul className="flex flex-col gap-2 text-sm">
            {held.local > 0 ? (
              <li className="flex items-start gap-2.5">
                <HardDrive aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span>{m.lms_materials_held_confirm_local({ count: held.local })}</span>
              </li>
            ) : null}
            {held.online > 0 ? (
              <li className="flex items-start gap-2.5">
                <Cloud aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span>{m.lms_materials_held_confirm_online({ count: held.online, provider })}</span>
              </li>
            ) : null}
          </ul>
        }
        confirmLabel={m.common_remove()}
        pending={remove.isPending}
        onConfirm={() => remove.mutate({ body: { course_id: courseId ?? null } })}
      />
    </>
  )
}

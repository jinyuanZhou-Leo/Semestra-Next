import type { UserOut } from '@semestra/api-client'
import {
  accountMeGetQueryKey,
  accountProfileUpdateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { TextField } from '@/components/TextField'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { SettingsCard } from './SettingsCard'
import { UserAvatar } from './UserAvatar'

export function ProfileSection({ user }: { user: UserOut }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(user.display_name)
  const update = useMutation({
    ...accountProfileUpdateMutation(),
    onSuccess: (data) => {
      queryClient.setQueryData(accountMeGetQueryKey(), data)
      toast.success(m.auth_account_saved())
    },
    onError: toastError,
  })

  const dirty = name.trim() !== user.display_name && name.trim().length > 0
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (dirty) update.mutate({ body: { display_name: name.trim() } })
  }

  return (
    <SettingsCard>
      <div className="flex items-center gap-4">
        <UserAvatar name={user.display_name} src={user.avatar_url} size="lg" />
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{m.auth_account_avatar_note()}</p>
          {user.avatar_url ? (
            <Button
              variant="outline"
              size="xs"
              disabled={update.isPending}
              onClick={() => update.mutate({ body: { avatar_url: null } })}
            >
              {m.auth_account_avatar_remove()}
            </Button>
          ) : null}
        </div>
      </div>
      <form onSubmit={submit} className="flex items-end gap-3">
        <TextField
          className="flex-1"
          label={m.auth_display_name_label()}
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          disabled={update.isPending}
        />
        <Button type="submit" disabled={!dirty || update.isPending}>
          {update.isPending ? m.common_saving() : m.common_save()}
        </Button>
      </form>
    </SettingsCard>
  )
}

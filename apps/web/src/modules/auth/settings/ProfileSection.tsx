import type { UserOut } from '@semestra/api-client'
import {
  accountMeGetQueryKey,
  accountProfileUpdateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Field, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import { Card, CardContent } from '@/ui/card'
import { UserAvatar } from './UserAvatar'

export function ProfileSection({ user }: { user: UserOut }) {
  const queryClient = useQueryClient()
  const id = useId()
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
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <UserAvatar name={user.display_name} src={user.avatar_url} size="lg" />
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{m.auth_account_avatar_note()}</p>
            {user.avatar_url ? (
              <Button
                variant="destructive"
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
          <Field className="flex-1">
            <FieldLabel htmlFor={id}>{m.auth_display_name_label()}</FieldLabel>
            <Input
              id={id}
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              disabled={update.isPending}
            />
          </Field>
          <Button type="submit" disabled={!dirty || update.isPending}>
            {update.isPending ? m.common_saving() : m.common_save()}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

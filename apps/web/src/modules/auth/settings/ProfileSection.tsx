import type { UserOut } from '@semestra/api-client'
import {
  accountAvatarUploadMutation,
  accountMeGetQueryKey,
  accountProfileUpdateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Camera, Trash2 } from 'lucide-react'
import { useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Field, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import { Card, CardContent } from '@/ui/card'
import { Separator } from '@/ui/separator'
import { UserAvatar } from './UserAvatar'

const MAX_AVATAR_BYTES = 5 * 1024 * 1024
const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp']

export function ProfileSection({ user }: { user: UserOut }) {
  const queryClient = useQueryClient()
  const id = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(user.display_name)
  const [removing, setRemoving] = useState(false)
  const update = useMutation({
    ...accountProfileUpdateMutation(),
    onSuccess: (data) => {
      queryClient.setQueryData(accountMeGetQueryKey(), data)
      toast.success(m.auth_account_saved())
    },
    onError: toastError,
  })
  const upload = useMutation({
    ...accountAvatarUploadMutation(),
    onSuccess: (data) => {
      queryClient.setQueryData(accountMeGetQueryKey(), data)
      toast.success(m.auth_account_avatar_updated())
    },
    onError: toastError,
  })
  const removeAvatar = useMutation({
    ...accountProfileUpdateMutation(),
    onSuccess: (data) => {
      queryClient.setQueryData(accountMeGetQueryKey(), data)
      setRemoving(false)
      toast.success(m.auth_account_avatar_removed())
    },
    onError: toastError,
  })

  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > MAX_AVATAR_BYTES) return void toast.error(m.error_auth_avatar_too_large())
    upload.mutate({ body: { file } })
  }

  const dirty = name.trim() !== user.display_name && name.trim().length > 0
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (dirty) update.mutate({ body: { display_name: name.trim() } })
  }

  return (
    <Card>
      <CardContent className="space-y-6">
        <div className="flex items-center gap-5">
          <UserAvatar
            name={user.display_name}
            src={user.avatar_url}
            size="lg"
            className="size-20 *:data-[slot=avatar-fallback]:text-2xl"
          />
          <div className="min-w-0 space-y-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{user.display_name}</p>
              <p className="truncate text-sm text-muted-foreground">{user.email}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInput}
                type="file"
                accept={AVATAR_TYPES.join(',')}
                className="hidden"
                onChange={pick}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={upload.isPending}
                onClick={() => fileInput.current?.click()}
              >
                <Camera />
                {upload.isPending ? m.common_loading() : m.auth_account_avatar_upload()}
              </Button>
              {user.avatar_url ? (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={upload.isPending}
                  onClick={() => setRemoving(true)}
                >
                  <Trash2 />
                  {m.auth_account_avatar_remove()}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
        <Separator />
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
        <ConfirmDialog
          open={removing}
          onOpenChange={setRemoving}
          title={m.auth_account_avatar_remove_title()}
          description={m.auth_account_avatar_remove_desc()}
          confirmLabel={m.auth_account_avatar_remove()}
          pending={removeAvatar.isPending}
          onConfirm={() => removeAvatar.mutate({ body: { avatar_url: null } })}
        />
      </CardContent>
    </Card>
  )
}

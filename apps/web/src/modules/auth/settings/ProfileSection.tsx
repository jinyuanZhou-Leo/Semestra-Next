import type { UserOut } from '@semestra/api-client'
import {
  accountAvatarUploadMutation,
  accountProfileGetQueryKey,
  accountProfileUpdateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Camera, Trash2 } from 'lucide-react'
import { useId, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { SettingRow, SettingsGroup } from '@/app/settings'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/ui/item'
import { UserAvatar } from './UserAvatar'

const MAX_AVATAR_BYTES = 5 * 1024 * 1024
const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp']

export function ProfileSection({ user, children }: { user: UserOut; children?: ReactNode }) {
  const queryClient = useQueryClient()
  const id = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(user.display_name)
  const [removing, setRemoving] = useState(false)
  const update = useMutation({
    ...accountProfileUpdateMutation(),
    onSuccess: (data) => {
      queryClient.setQueryData(accountProfileGetQueryKey(), data)
      toast.success(m.auth_account_saved())
    },
    onError: toastError,
  })
  const upload = useMutation({
    ...accountAvatarUploadMutation(),
    onSuccess: (data) => {
      queryClient.setQueryData(accountProfileGetQueryKey(), data)
      toast.success(m.auth_account_avatar_updated())
    },
    onError: toastError,
  })
  const removeAvatar = useMutation({
    ...accountProfileUpdateMutation(),
    onSuccess: (data) => {
      queryClient.setQueryData(accountProfileGetQueryKey(), data)
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
    <>
      <SettingsGroup>
        <Item>
          <ItemMedia>
            <UserAvatar
              name={user.display_name}
              src={user.avatar_url}
              size="lg"
              className="size-16 *:data-[slot=avatar-fallback]:text-xl"
            />
          </ItemMedia>
          <ItemContent className="min-w-0 basis-48">
            <ItemTitle className="truncate">{user.display_name}</ItemTitle>
            <ItemDescription className="truncate">{user.email}</ItemDescription>
          </ItemContent>
          <ItemActions>
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
          </ItemActions>
        </Item>
        <SettingRow label={m.auth_display_name_label()} htmlFor={id}>
          <form onSubmit={submit} className="flex items-center gap-2">
            <Input
              id={id}
              className="w-56"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              disabled={update.isPending}
            />
            <Button type="submit" disabled={!dirty || update.isPending}>
              {update.isPending ? m.common_saving() : m.common_save()}
            </Button>
          </form>
        </SettingRow>
        {children}
      </SettingsGroup>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={m.auth_account_avatar_remove_title()}
        description={m.auth_account_avatar_remove_desc()}
        confirmLabel={m.auth_account_avatar_remove()}
        pending={removeAvatar.isPending}
        onConfirm={() => removeAvatar.mutate({ body: { avatar_url: null } })}
      />
    </>
  )
}

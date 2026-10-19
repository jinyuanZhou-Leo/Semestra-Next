import {
  accountSessionsListOptions,
  accountSessionsListQueryKey,
  accountSessionsRevokeMutation,
  accountSessionsRevokeOthersMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ActionRow, SettingsGroup } from '@/app/settings'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { deviceLabel } from '@/lib/device'
import { errorMessage, toastError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { SignOutDialog } from '../components/SignOutDialog'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { FieldError } from '@/ui/field'
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/ui/item'

type Target = { kind: 'one'; id: string } | { kind: 'others' }

export function SessionsSection() {
  const queryClient = useQueryClient()
  const [signingOut, setSigningOut] = useState(false)
  const sessions = useQuery(accountSessionsListOptions())
  const [target, setTarget] = useState<Target | null>(null)

  const done = () => {
    setTarget(null)
    void queryClient.invalidateQueries({ queryKey: accountSessionsListQueryKey() })
  }
  const revokeOne = useMutation({
    ...accountSessionsRevokeMutation(),
    onSuccess: done,
    onError: (err) => (setTarget(null), toastError(err)),
  })
  const revokeOthers = useMutation({
    ...accountSessionsRevokeOthersMutation(),
    onSuccess: done,
    onError: (err) => (setTarget(null), toastError(err)),
  })

  const items = sessions.data?.items ?? []
  const hasOthers = items.some((s) => !s.current)

  return (
    <>
      {sessions.isPending ? (
        <p className="text-sm text-muted-foreground">{m.common_loading()}</p>
      ) : sessions.isError ? (
        <div className="space-y-2">
          <FieldError>{errorMessage(sessions.error)}</FieldError>
          <Button variant="outline" size="sm" onClick={() => void sessions.refetch()}>
            {m.common_retry()}
          </Button>
        </div>
      ) : (
        <SettingsGroup>
          {items.map((s) => {
            const device = deviceLabel(s.user_agent) ?? m.auth_account_sessions_unknown_device()
            return (
              <Item key={s.id}>
                <ItemContent className="min-w-0">
                  <ItemTitle>
                    <span className="truncate">{device}</span>
                    <Badge variant="secondary">
                      {s.kind === 'native'
                        ? m.auth_account_sessions_native()
                        : m.auth_account_sessions_web()}
                    </Badge>
                    {s.current ? <Badge>{m.common_current()}</Badge> : null}
                  </ItemTitle>
                  <ItemDescription>
                    {[
                      s.ip,
                      m.auth_account_sessions_last_active({
                        time: formatDateTime(s.last_used_at),
                      }),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    variant="destructive"
                    size="sm"
                    aria-label={m.auth_account_sessions_revoke_aria({ device })}
                    // Revoking the session we are using is a sign-out: it must clear the cookies
                    // and leave the page instead of refetching into a 401.
                    onClick={() =>
                      s.current ? setSigningOut(true) : setTarget({ kind: 'one', id: s.id })
                    }
                  >
                    {s.current ? m.auth_account_signout() : m.auth_account_sessions_revoke()}
                  </Button>
                </ItemActions>
              </Item>
            )
          })}
          {hasOthers ? (
            <ActionRow destructive onClick={() => setTarget({ kind: 'others' })}>
              {m.auth_account_sessions_revoke_others()}
            </ActionRow>
          ) : null}
        </SettingsGroup>
      )}
      <SignOutDialog open={signingOut} onOpenChange={setSigningOut} />
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title={
          target?.kind === 'others'
            ? m.auth_account_sessions_revoke_others_title()
            : m.auth_account_sessions_revoke()
        }
        description={
          target?.kind === 'others' ? m.auth_account_sessions_revoke_others_desc() : null
        }
        confirmLabel={m.auth_account_sessions_revoke()}
        pending={revokeOne.isPending || revokeOthers.isPending}
        onConfirm={() => {
          if (target?.kind === 'one') revokeOne.mutate({ path: { session_id: target.id } })
          else if (target?.kind === 'others') revokeOthers.mutate({})
        }}
      />
    </>
  )
}

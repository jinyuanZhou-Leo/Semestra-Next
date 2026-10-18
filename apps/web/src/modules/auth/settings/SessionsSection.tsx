import {
  accountSessionsListOptions,
  accountSessionsListQueryKey,
  accountSessionsRevokeMutation,
  accountSessionsRevokeOthersMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Fragment, useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { deviceLabel } from '@/lib/device'
import { errorMessage, toastError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { useAuth } from '../useAuth'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { FieldError } from '@/ui/field'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from '@/ui/item'
import { Card, CardContent } from '@/ui/card'

type Target = { kind: 'one'; id: string } | { kind: 'others' }

export function SessionsSection() {
  const queryClient = useQueryClient()
  const { signOut } = useAuth()
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
    <Card>
      <CardContent className="space-y-4">
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
          <ItemGroup className="gap-0">
            {items.map((s, i) => {
              const device = deviceLabel(s.user_agent) ?? m.auth_account_sessions_unknown_device()
              return (
                <Fragment key={s.id}>
                  {i > 0 ? <ItemSeparator /> : null}
                  <Item className="px-0">
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
                        variant="outline"
                        size="sm"
                        aria-label={m.auth_account_sessions_revoke_aria({ device })}
                        // Revoking the session we are using is a sign-out: it must clear the cookies
                        // and leave the page instead of refetching into a 401.
                        onClick={() =>
                          s.current ? void signOut() : setTarget({ kind: 'one', id: s.id })
                        }
                      >
                        {s.current ? m.auth_account_signout() : m.auth_account_sessions_revoke()}
                      </Button>
                    </ItemActions>
                  </Item>
                </Fragment>
              )
            })}
          </ItemGroup>
        )}
        {hasOthers ? (
          <Button variant="destructive" size="sm" onClick={() => setTarget({ kind: 'others' })}>
            {m.auth_account_sessions_revoke_others()}
          </Button>
        ) : null}
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
      </CardContent>
    </Card>
  )
}

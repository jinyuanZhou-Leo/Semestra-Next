import {
  accountSessionsListOptions,
  accountSessionsListQueryKey,
  accountSessionsRevokeMutation,
  accountSessionsRevokeOthersMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { deviceLabel } from '@/lib/device'
import { toastError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Separator } from '@/ui/separator'
import { FormError } from '../components/FormError'
import { SettingsCard } from './SettingsCard'

type Target = { kind: 'one'; id: string } | { kind: 'others' }

export function SessionsSection() {
  const queryClient = useQueryClient()
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
    <SettingsCard
      title={m.auth_account_sessions_title()}
      description={m.auth_account_sessions_desc()}
    >
      {sessions.isPending ? (
        <p className="text-sm text-muted-foreground">{m.common_loading()}</p>
      ) : sessions.isError ? (
        <div className="space-y-2">
          <FormError error={sessions.error} />
          <Button variant="outline" size="sm" onClick={() => void sessions.refetch()}>
            {m.common_retry()}
          </Button>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((s, i) => {
            const device = deviceLabel(s.user_agent) ?? m.auth_account_sessions_unknown_device()
            return (
              <li key={s.id}>
                {i > 0 ? <Separator className="mb-3" /> : null}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span className="truncate">{device}</span>
                      <Badge variant="secondary">
                        {s.kind === 'native'
                          ? m.auth_account_sessions_native()
                          : m.auth_account_sessions_web()}
                      </Badge>
                      {s.current ? <Badge>{m.common_current()}</Badge> : null}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {[
                        s.ip,
                        m.auth_account_sessions_last_active({
                          time: formatDateTime(s.last_used_at),
                        }),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={m.auth_account_sessions_revoke_aria({ device })}
                    onClick={() => setTarget({ kind: 'one', id: s.id })}
                  >
                    {m.auth_account_sessions_revoke()}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
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
    </SettingsCard>
  )
}

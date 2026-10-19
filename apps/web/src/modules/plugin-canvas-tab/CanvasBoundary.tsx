import type { UseQueryResult } from '@tanstack/react-query'
import { CircleAlert, Clock, KeyRound } from 'lucide-react'
import type { ReactNode } from 'react'
import { useSettingsDialog } from '@/app/settings'
import { errorCode, errorMessage } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/ui/alert'
import { Skeleton } from '@/ui/skeleton'

/** Errors that only new credentials fix: the way out is the connection settings. */
const CREDENTIAL_ERRORS = new Set([
  'lms.invalid_credentials',
  'lms.credentials_missing',
  'lms.forbidden',
])

/** Rows of grey bars shaped like the list that is loading. */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label={m.common_loading()}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      ))}
    </div>
  )
}

/**
 * Loading, error and empty states of a Canvas read (M16 §4). An invalid or missing API token
 * leads to the connection settings; "too many requests" asks to try again later.
 */
export function CanvasBoundary<T>({
  query,
  isEmpty,
  empty,
  skeleton,
  children,
}: {
  query: UseQueryResult<T, unknown>
  isEmpty?: (data: T) => boolean
  empty?: ReactNode
  skeleton?: ReactNode
  children: (data: T) => ReactNode
}) {
  const settings = useSettingsDialog()
  if (query.isPending) return skeleton ?? <ListSkeleton />
  if (query.isError) {
    const code = errorCode(query.error)
    const credentials = CREDENTIAL_ERRORS.has(code)
    return (
      <Alert variant={credentials ? 'default' : 'destructive'}>
        {credentials ? (
          <KeyRound aria-hidden />
        ) : code === 'lms.rate_limited' ? (
          <Clock aria-hidden />
        ) : (
          <CircleAlert aria-hidden />
        )}
        <AlertTitle>{credentials ? errorMessage(query.error) : m.common_load_failed()}</AlertTitle>
        <AlertDescription>
          {credentials ? m.canvas_tab_credentials_hint() : errorMessage(query.error)}
        </AlertDescription>
        <AlertAction>
          {credentials ? (
            <Button
              size="sm"
              onClick={() => settings.open({ level: 'account', group: 'integrations' })}
            >
              {m.canvas_tab_open_connections()}
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
              {m.common_retry()}
            </Button>
          )}
        </AlertAction>
      </Alert>
    )
  }
  if (isEmpty?.(query.data) && empty) return empty
  return children(query.data)
}

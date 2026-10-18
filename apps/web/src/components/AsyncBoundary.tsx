import type { UseQueryResult } from '@tanstack/react-query'
import { CircleAlert, Inbox, LoaderCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { errorMessage } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { EmptyState } from './EmptyState'

type Props<T> = {
  query: UseQueryResult<T, unknown>
  /** When true, `empty` is shown instead of `children`. */
  isEmpty?: (data: T) => boolean
  empty?: ReactNode
  children: (data: T) => ReactNode
}

/** Loading, error (with retry) and empty states for a query, so every list has all three. */
export function AsyncBoundary<T>({ query, isEmpty, empty, children }: Props<T>) {
  if (query.isPending) {
    return (
      <output className="flex items-center justify-center gap-2 py-12 text-sm">
        <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
        <span className="text-muted-foreground">{m.common_loading()}</span>
      </output>
    )
  }
  if (query.isError) {
    return (
      <EmptyState
        icon={CircleAlert}
        title={m.common_load_failed()}
        description={errorMessage(query.error)}
        action={
          <Button variant="outline" onClick={() => void query.refetch()}>
            {m.common_retry()}
          </Button>
        }
      />
    )
  }
  if (isEmpty?.(query.data)) {
    return empty ?? <EmptyState icon={Inbox} title={m.common_empty()} />
  }
  return children(query.data)
}

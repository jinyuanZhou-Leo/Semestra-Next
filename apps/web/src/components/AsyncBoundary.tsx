import type { UseQueryResult } from '@tanstack/react-query'
import { CircleAlert, Inbox } from 'lucide-react'
import type { ReactNode } from 'react'
import { errorMessage } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/ui/empty'
import { Spinner } from '@/ui/spinner'

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
        <Spinner aria-hidden className="motion-reduce:animate-none" />
        <span className="text-muted-foreground">{m.common_loading()}</span>
      </output>
    )
  }
  if (query.isError) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CircleAlert aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{m.common_load_failed()}</EmptyTitle>
          <EmptyDescription>{errorMessage(query.error)}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={() => void query.refetch()}>
            {m.common_retry()}
          </Button>
        </EmptyContent>
      </Empty>
    )
  }
  if (isEmpty?.(query.data)) {
    return (
      empty ?? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Inbox aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{m.common_empty()}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      )
    )
  }
  return children(query.data)
}

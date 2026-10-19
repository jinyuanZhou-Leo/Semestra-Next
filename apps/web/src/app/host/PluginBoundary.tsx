import { CircleAlert } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode, Suspense } from 'react'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Alert, AlertAction, AlertTitle } from '@/ui/alert'
import { Button } from '@/ui/button'
import { Skeleton } from '@/ui/skeleton'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/ui/empty'

type State = { error: unknown }

class ErrorBoundary extends Component<
  { children: ReactNode; compact?: boolean; silent?: boolean },
  State
> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('plugin_render_failed', error, info.componentStack)
  }

  render() {
    if (this.state.error == null) return this.props.children
    if (this.props.silent) return null
    const retry = (
      <Button variant="outline" size="sm" onClick={() => this.setState({ error: null })}>
        {m.common_retry()}
      </Button>
    )
    if (this.props.compact) {
      return (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertTitle>{m.host_plugin_failed_title()}</AlertTitle>
          <AlertAction>{retry}</AlertAction>
        </Alert>
      )
    }
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CircleAlert aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{m.host_plugin_failed_title()}</EmptyTitle>
          <EmptyDescription>{m.host_plugin_failed_description()}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>{retry}</EmptyContent>
      </Empty>
    )
  }
}

/** Skeleton while a lazy page or card loads. */
export function LoadingBlock({ className }: { className?: string }) {
  return (
    <Skeleton
      aria-hidden
      className={cn('h-full min-h-8 rounded-lg motion-reduce:animate-none', className)}
    />
  )
}

/**
 * Isolates a module's page or card (M10 §5.1): a crash shows a retry instead of taking the
 * page down, and lazy code shows a skeleton while it loads. `silent` is for a fixed-height line
 * such as a page header's subtitle: a failure or a load shows nothing instead of a block.
 */
export function PluginBoundary({
  children,
  compact,
  silent,
}: {
  children: ReactNode
  compact?: boolean
  silent?: boolean
}) {
  return (
    <ErrorBoundary compact={compact} silent={silent}>
      <Suspense
        fallback={silent ? null : <LoadingBlock className={compact ? undefined : 'h-40'} />}
      >
        {children}
      </Suspense>
    </ErrorBoundary>
  )
}

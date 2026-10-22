import { useRouter } from '@tanstack/react-router'
import { type ComponentProps, type MouseEvent, useEffect, useRef } from 'react'

/**
 * A real link (open in new tab, copy address) that navigates inside the SPA on a plain click.
 * Like the router's `Link` with `preload: 'intent'`, hovering or focusing it preloads the target
 * route (its loader starts the page's code and data), touching it preloads at once.
 */
export function HistoryLink({
  href,
  onClick,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  onTouchStart,
  ...props
}: ComponentProps<'a'> & { href: string }) {
  const router = useRouter()
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const cancel = () => {
    clearTimeout(timer.current)
    timer.current = undefined
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  const preload = () => {
    cancel()
    // Its types want `to`, but it builds `href` like `navigate({ href })` does. A failed preload
    // is tried again by the navigation, which reports its own error.
    router.preloadRoute({ href } as never).catch(() => {})
  }
  const intend = () => {
    if (props.target === '_blank' || timer.current !== undefined) return
    timer.current = setTimeout(preload, router.options.defaultPreloadDelay ?? 50)
  }
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      props.target === '_blank'
    ) {
      return
    }
    event.preventDefault()
    cancel()
    router.history.push(href)
  }
  return (
    // oxlint-disable-next-line jsx-a11y/anchor-has-content -- the content arrives through `props`
    <a
      href={href}
      onClick={follow}
      onMouseEnter={(event) => {
        onMouseEnter?.(event)
        intend()
      }}
      onFocus={(event) => {
        onFocus?.(event)
        intend()
      }}
      onMouseLeave={(event) => {
        onMouseLeave?.(event)
        cancel()
      }}
      onBlur={(event) => {
        onBlur?.(event)
        cancel()
      }}
      onTouchStart={(event) => {
        onTouchStart?.(event)
        if (props.target !== '_blank') preload()
      }}
      {...props}
    />
  )
}

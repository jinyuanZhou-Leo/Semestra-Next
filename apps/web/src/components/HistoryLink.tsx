import { useRouter } from '@tanstack/react-router'
import type { ComponentProps, MouseEvent } from 'react'

/** A real link (open in new tab, copy address) that navigates inside the SPA on a plain click. */
export function HistoryLink({ href, onClick, ...props }: ComponentProps<'a'> & { href: string }) {
  const router = useRouter()
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
    router.history.push(href)
  }
  // oxlint-disable-next-line jsx-a11y/anchor-has-content -- the content arrives through `props`
  return <a href={href} onClick={follow} {...props} />
}

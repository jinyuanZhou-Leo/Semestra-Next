import { Link } from '@tanstack/react-router'
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { AI_SETTINGS_LINK, type AiPurpose, useAiStatus } from '@/hooks/use-ai-status'
import { m } from '@/paraglide/messages'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'

type Props = {
  purpose: AiPurpose
  /**
   * The AI entry point. A function gets `{ available }` and renders it itself; an element is
   * given `disabled` while AI is unavailable (or the status is still loading).
   */
  children: ReactElement<{ disabled?: boolean }> | ((state: { available: boolean }) => ReactNode)
}

/**
 * Wraps an AI entry point (M06 §7). Without a model for `purpose` the entry stays visible but
 * greyed out; hovering or focusing it shows one line and a link to the settings. No cards, no
 * banners: the full explanation only appears where the user opened an AI page on purpose.
 */
export function AiRequired({ purpose, children }: Props) {
  const { available, pending } = useAiStatus(purpose)
  const content =
    typeof children === 'function'
      ? children({ available })
      : isValidElement(children) && !available
        ? cloneElement(children, { disabled: true })
        : children
  if (available || pending) return content
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        nativeButton={false}
        render={
          // A disabled button can't take focus, so the wrapper does: keyboard users get the hint too.
          <span
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
            className="inline-flex rounded-4xl outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
          />
        }
      >
        {content}
      </PopoverTrigger>
      <PopoverContent side="top" className="w-auto max-w-xs px-3 py-2 text-xs">
        <span className="text-muted-foreground">{m.ai_required_hint()}</span>{' '}
        <Link
          {...AI_SETTINGS_LINK}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {m.ai_required_link()}
        </Link>
      </PopoverContent>
    </Popover>
  )
}

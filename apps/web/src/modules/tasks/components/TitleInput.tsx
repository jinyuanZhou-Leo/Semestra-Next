import { useRef } from 'react'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import type { Token } from '../parse'
import { TITLE_TINT } from './TaskChips'

/**
 * A new task's title field that tints the words read as its date, priority or course (M05
 * §5.1). The tint is a copy of the text laid over the field, whose own text turns transparent
 * while there is something to tint; pressing a tinted word keeps it as plain text.
 */
export function TitleInput({
  value,
  tokens,
  onKeep,
  className,
  ...props
}: Omit<React.ComponentProps<'input'>, 'value'> & {
  value: string
  tokens: readonly Token[]
  onKeep: (token: Token) => void
}) {
  const overlay = useRef<HTMLDivElement>(null)
  const tinted = tokens.length > 0
  const parts: React.ReactNode[] = []
  let at = 0
  for (const token of tokens) {
    parts.push(value.slice(at, token.index))
    parts.push(
      <Tooltip key={token.index}>
        <TooltipTrigger
          render={
            <button
              type="button"
              // The chips are the way in from the keyboard.
              tabIndex={-1}
              aria-label={m.tasks_title_keep({ text: token.text })}
              className={cn('pointer-events-auto cursor-pointer rounded-sm', TITLE_TINT)}
              // Not a focus or caret move: the field keeps both.
              onMouseDown={(event) => {
                event.preventDefault()
                onKeep(token)
              }}
            />
          }
        >
          {token.text}
        </TooltipTrigger>
        <TooltipContent>{m.tasks_title_keep({ text: token.text })}</TooltipContent>
      </Tooltip>,
    )
    at = token.index + token.text.length
  }
  parts.push(value.slice(at))
  return (
    <div className="relative min-w-0">
      <input
        {...props}
        value={value}
        className={cn(className, tinted && 'text-transparent caret-foreground')}
        onScroll={(event) => {
          if (overlay.current) overlay.current.scrollLeft = event.currentTarget.scrollLeft
        }}
      />
      {tinted ? (
        <div
          ref={(el) => {
            overlay.current = el
            // Shown once the first word is read, where the field may already be scrolled.
            if (el && el.previousElementSibling)
              el.scrollLeft = el.previousElementSibling.scrollLeft
          }}
          aria-hidden
          className={cn(
            className,
            // Centred like the field's own line, which a fixed height (the phone's) leaves room around.
            'pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre',
          )}
        >
          {parts}
        </div>
      ) : null}
    </div>
  )
}

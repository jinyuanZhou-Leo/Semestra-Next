import { Minimize2 } from 'lucide-react'
import { useId, useState } from 'react'
import { formatCount, formatPercent } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Field, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import { InputGroupButton } from '@/ui/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import { Progress, ProgressLabel, ProgressValue } from '@/ui/progress'
import { Separator } from '@/ui/separator'

const RING = 2 * Math.PI * 8

/**
 * How full the conversation's context is (M12 §3.4), as a ring by the attach button; opened, it
 * says how compaction works and compacts now, keeping what the user names.
 */
export function ContextMeter({
  used,
  window,
  canCompact,
  onCompact,
}: {
  used: number
  window: number
  canCompact: boolean
  onCompact: (focus: string) => void
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [focus, setFocus] = useState('')
  const ratio = Math.min(1, window > 0 ? used / window : 0)
  const percent = formatPercent(ratio, 0)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <InputGroupButton
            size="sm"
            className="h-8 rounded-full px-2 text-xs text-muted-foreground tabular-nums"
            aria-label={m.assistant_context_usage({ percent })}
          />
        }
      >
        <svg aria-hidden viewBox="0 0 20 20" className="size-4 -rotate-90">
          <circle cx="10" cy="10" r="8" fill="none" strokeWidth="2.5" className="stroke-muted" />
          <circle
            cx="10"
            cy="10"
            r="8"
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={`${ratio * RING} ${RING}`}
            className="stroke-primary"
          />
        </svg>
        {percent}
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="gap-3">
        <Progress value={Math.round(ratio * 100)}>
          <ProgressLabel>{m.assistant_context_label()}</ProgressLabel>
          <ProgressValue />
        </Progress>
        <p className="text-xs text-muted-foreground tabular-nums">
          {m.assistant_context_tokens({
            used: formatCount(used, { compact: true }),
            window: formatCount(window, { compact: true }),
          })}
        </p>
        <p className="text-xs text-muted-foreground">{m.assistant_context_hint()}</p>
        <Separator />
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            setOpen(false)
            onCompact(focus.trim())
            setFocus('')
          }}
        >
          <Field>
            <FieldLabel htmlFor={id}>{m.assistant_compact_focus_label()}</FieldLabel>
            <Input
              id={id}
              value={focus}
              maxLength={1000}
              placeholder={m.assistant_compact_focus_placeholder()}
              onChange={(event) => setFocus(event.target.value)}
            />
          </Field>
          <Button type="submit" variant="outline" disabled={!canCompact}>
            <Minimize2 aria-hidden />
            {m.assistant_compact()}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}

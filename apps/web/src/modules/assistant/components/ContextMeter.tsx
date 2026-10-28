import type { ContextParts } from '@semestra/api-client'
import { Minimize2 } from 'lucide-react'
import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentHeader,
  ContextTrigger,
} from '@/components/ai-elements/context'
import { formatCount, formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Progress } from '@/ui/progress'
import { Spinner } from '@/ui/spinner'

type Kind = keyof ContextParts

// In the order the request holds them; shades of the chart ramp, neighbours far apart so the
// segments tell apart.
const KINDS: readonly { kind: Kind; color: string; label: () => string }[] = [
  { kind: 'instructions', color: 'bg-chart-5', label: () => m.assistant_context_instructions() },
  { kind: 'tools', color: 'bg-chart-2', label: () => m.assistant_context_tools() },
  { kind: 'summary', color: 'bg-muted-foreground', label: () => m.assistant_context_summary() },
  { kind: 'conversation', color: 'bg-chart-4', label: () => m.assistant_context_conversation() },
  { kind: 'reads', color: 'bg-chart-1', label: () => m.assistant_context_reads() },
  { kind: 'attachments', color: 'bg-chart-3', label: () => m.assistant_context_attachments() },
]

/**
 * How full the conversation's context is (M12 §3.4): AI Elements' `Context` card on an outline
 * button with the share (as shadcn's AI Context page has it), showing what fills it, by kind, on
 * hover. Compacting is the card's last row: its button starts it in the composer, where the user
 * can name what to keep, as `/compact` does. While it runs the button shows a spinner.
 */
export function ContextMeter({
  used,
  window,
  parts,
  canCompact,
  compacting,
  onCompact,
}: {
  used: number
  window: number
  parts: ContextParts | null
  canCompact: boolean
  compacting: boolean
  onCompact: () => void
}) {
  const shown = parts
    ? KINDS.flatMap((k) => {
        const tokens = parts[k.kind] ?? 0
        return tokens > 0 ? [{ ...k, tokens }] : []
      })
    : []
  const free = Math.max(window - used, 0)
  return (
    <Context usedTokens={Math.min(used, window)} maxTokens={window}>
      {/* shadcn's AI Context pattern: an outline button with the share, not the ring. */}
      <ContextTrigger>
        <Button type="button" variant="outline" size="sm" className="h-8 rounded-full text-xs">
          {compacting ? <Spinner aria-label={m.assistant_compacting()} /> : null}
          {m.assistant_context_button({ percent: formatPercent(Math.min(used / window, 1), 0) })}
        </Button>
      </ContextTrigger>
      <ContextContent side="top" align="start" className="w-72">
        {/* Our own header: the default one formats in en-US. */}
        <ContextContentHeader>
          <div className="flex items-center justify-between gap-3 text-xs">
            <p>{formatPercent(Math.min(used / window, 1))}</p>
            <p className="font-mono text-muted-foreground">
              {formatCount(used, { compact: true })} / {formatCount(window, { compact: true })}
            </p>
          </div>
          {shown.length > 0 ? (
            <div aria-hidden className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-muted">
              {shown.map((k) => (
                <span
                  key={k.kind}
                  className={k.color}
                  style={{ width: `${(k.tokens / window) * 100}%` }}
                />
              ))}
            </div>
          ) : (
            // Recorded before the kinds were: only the total.
            <Progress className="bg-muted" value={Math.min(used / window, 1) * 100} />
          )}
        </ContextContentHeader>
        {shown.length > 0 ? (
          <ContextContentBody className="flex flex-col gap-1.5 text-xs">
            {shown.map((k) => (
              <KindRow key={k.kind} color={k.color} label={k.label()} tokens={k.tokens} />
            ))}
            <KindRow
              color="bg-muted ring-1 ring-border ring-inset"
              label={m.assistant_context_free()}
              tokens={free}
              muted
            />
          </ContextContentBody>
        ) : null}
        {/* Not `ContextContentFooter`: it prices tokens with tokenlens, whose model list is large. */}
        <div className="p-1">
          <Button
            size="sm"
            variant="ghost"
            className="w-full"
            disabled={!canCompact || compacting}
            onClick={onCompact}
          >
            {compacting ? <Spinner /> : <Minimize2 aria-hidden />}
            {compacting ? m.assistant_compacting() : m.assistant_compact()}
          </Button>
        </div>
      </ContextContent>
    </Context>
  )
}

function KindRow({
  color,
  label,
  tokens,
  muted = false,
}: {
  color: string
  label: string
  tokens: number
  muted?: boolean
}) {
  return (
    <div className="flex items-center gap-2 tabular-nums">
      <span aria-hidden className={cn('size-2 shrink-0 rounded-[3px]', color)} />
      <span className={cn('min-w-0 flex-1 truncate', muted && 'text-muted-foreground')}>
        {label}
      </span>
      <span className="font-mono text-muted-foreground">
        {formatCount(tokens, { compact: true })}
      </span>
    </div>
  )
}

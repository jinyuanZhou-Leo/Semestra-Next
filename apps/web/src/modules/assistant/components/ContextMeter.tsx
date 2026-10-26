import { Minimize2 } from 'lucide-react'
import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentHeader,
  ContextTrigger,
} from '@/components/ai-elements/context'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'

/**
 * How full the conversation's context is (M12 §3.4): AI Elements' `Context`, a ring with the
 * share that shows the numbers on hover. Its button starts compacting in the composer, where the
 * user can name what to keep, as `/compact` does. No footer: it prices the tokens with tokenlens,
 * whose model list would triple the assistant's code for a number shown nowhere else.
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
  onCompact: () => void
}) {
  return (
    <Context usedTokens={Math.min(used, window)} maxTokens={window}>
      <ContextTrigger size="sm" className="h-8 rounded-full px-2 text-xs" />
      <ContextContent side="top" align="start">
        <ContextContentHeader />
        <ContextContentBody className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">{m.assistant_context_hint()}</p>
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            disabled={!canCompact}
            onClick={onCompact}
          >
            <Minimize2 aria-hidden />
            {m.assistant_compact()}
          </Button>
        </ContextContentBody>
      </ContextContent>
    </Context>
  )
}

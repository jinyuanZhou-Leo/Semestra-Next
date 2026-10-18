import { Sparkles, Undo2 } from 'lucide-react'
import type { AiFilled } from '@/hooks/use-ai-fill'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'

/** Below this confidence the mark says the value is uncertain. */
const LOW_CONFIDENCE = 0.5

/**
 * The small mark beside a field AI filled in (M06 §7 rule 2): opens where the value came from
 * (page and quote) and a button to put the old value back. Pair with `useAiFill`.
 */
export function AiFieldMark({
  filled,
  fieldLabel,
  onRevert,
}: {
  filled: AiFilled<unknown> | undefined
  /** The field's label, for the button's accessible name. */
  fieldLabel: string
  onRevert: () => void
}) {
  if (!filled) return null
  const { evidence, confidence } = filled
  const uncertain = confidence !== undefined && confidence < LOW_CONFIDENCE
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={m.ai_fill_mark_aria({ field: fieldLabel })}
            className="text-muted-foreground"
          />
        }
      >
        <Sparkles aria-hidden />
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-2 text-sm" align="start">
        <p className="font-medium">{m.ai_fill_title()}</p>
        {evidence?.quote ? (
          <figure className="space-y-1">
            <blockquote className="border-l-2 border-border pl-3 text-muted-foreground">
              {evidence.quote}
            </blockquote>
            {evidence.page ? (
              <figcaption className="text-xs text-muted-foreground">
                {m.ai_fill_page({ page: evidence.page })}
              </figcaption>
            ) : null}
          </figure>
        ) : (
          <p className="text-muted-foreground">{m.ai_fill_no_evidence()}</p>
        )}
        {uncertain ? (
          <p className="text-xs text-muted-foreground">{m.ai_fill_uncertain()}</p>
        ) : null}
        <Button type="button" variant="outline" size="sm" onClick={onRevert}>
          <Undo2 aria-hidden />
          {m.ai_fill_revert()}
        </Button>
      </PopoverContent>
    </Popover>
  )
}

/** Classes for a field AI just filled: a short, quiet highlight in the theme's colours. */
export function aiFilledClass(highlighted: boolean): string {
  return highlighted
    ? 'ring-2 ring-primary/30 transition-shadow duration-500 motion-reduce:transition-none'
    : 'transition-shadow duration-500 motion-reduce:transition-none'
}

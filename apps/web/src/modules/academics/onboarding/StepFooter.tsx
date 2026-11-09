import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/ui/item'

/**
 * The buttons under every onboarding step (M02 §5.7): "Back" on the left; on the right "Skip"
 * for a step that can be left out, then the step's own action. It sits at the bottom of the
 * step, so steps of different heights keep their buttons in the same place.
 */
export function StepFooter({
  onBack,
  onSkip,
  skipLabel,
  children,
}: {
  onBack?: () => void
  onSkip?: () => void
  /** Default "Skip". */
  skipLabel?: string
  children?: ReactNode
}) {
  return (
    <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-4">
      {onBack ? (
        <Button type="button" variant="ghost" onClick={onBack}>
          {m.academics_wizard_back()}
        </Button>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-2">
        {onSkip ? (
          <Button type="button" variant="ghost" onClick={onSkip}>
            {skipLabel ?? m.academics_onboarding_skip()}
          </Button>
        ) : null}
        {children}
      </div>
    </div>
  )
}

/** One line of the done step: what a step set up, with a check, or "Not set". */
export function SummaryRow({
  media,
  title,
  detail,
  done,
}: {
  media: ReactNode
  title: string
  detail?: string
  done: boolean
}) {
  return (
    <Item>
      <ItemMedia>{media}</ItemMedia>
      <ItemContent>
        <ItemTitle>{title}</ItemTitle>
        {detail ? <ItemDescription>{detail}</ItemDescription> : null}
      </ItemContent>
      <ItemActions>
        {done ? (
          <Check aria-label={m.academics_onboarding_set()} className="size-4 text-primary" />
        ) : (
          <span className="text-sm text-muted-foreground">{m.academics_onboarding_not_set()}</span>
        )}
      </ItemActions>
    </Item>
  )
}

/** The icon tile a summary row of a step without a logo shows. */
export function SummaryIcon({ icon: Icon }: { icon: typeof Check }) {
  return (
    <div className="flex size-8 items-center justify-center rounded-lg bg-muted">
      <Icon aria-hidden className="size-4" />
    </div>
  )
}

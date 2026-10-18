import { Suspense } from 'react'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card'
import type { CardContribution, CardSize, Scope } from '../extensions'
import { useCards } from '../registry'

const SIZE_CLASS: Record<CardSize, string> = {
  s: 'col-span-1 row-span-1',
  m: 'col-span-2 row-span-1',
  l: 'col-span-2 row-span-2',
  xl: 'col-span-4 row-span-2',
}

function defaultSettings(card: CardContribution): unknown {
  const parsed = card.settings?.schema.safeParse({})
  return parsed?.success ? parsed.data : {}
}

/**
 * Every card available in a scope at its default size on a 4-column grid (M00 §4.4).
 * M10 replaces this with the user's editable layout; the card contract stays the same.
 */
export function CardGrid({ scope }: { scope: Scope }) {
  const cards = useCards(scope.kind)
  return (
    <div className="grid auto-rows-[10rem] grid-cols-4 gap-4">
      {cards.map((card) => {
        const Body = card.component
        return (
          <Card key={card.id} className={cn('overflow-hidden', SIZE_CLASS[card.defaultSize])}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <card.icon aria-hidden className="size-4 text-muted-foreground" />
                {card.title()}
              </CardTitle>
            </CardHeader>
            <CardContent className="min-h-0 flex-1">
              <Suspense fallback={null}>
                <Body
                  scope={scope}
                  instanceId={card.id}
                  size={card.defaultSize}
                  settings={defaultSettings(card)}
                />
              </Suspense>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

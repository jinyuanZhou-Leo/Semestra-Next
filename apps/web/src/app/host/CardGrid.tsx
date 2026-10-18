import { Suspense } from 'react'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card'
import type { BoardKind, CardContribution, CardSize, Scope } from '../extensions'
import { useCards, useModules } from '../registry'

function rank(listed: readonly string[], id: string): number {
  const i = listed.indexOf(id)
  return i === -1 ? listed.length : i
}

// One column on phones (the today page), four from tablets up.
const SIZE_CLASS: Record<CardSize, string> = {
  s: 'col-span-1 row-span-1',
  m: 'col-span-1 row-span-1 md:col-span-2',
  l: 'col-span-1 row-span-2 md:col-span-2',
  xl: 'col-span-1 row-span-2 md:col-span-4',
}

function defaultSettings(card: CardContribution): unknown {
  const parsed = card.settings?.schema.safeParse({})
  return parsed?.success ? parsed.data : {}
}

/**
 * Every card available on a board at its default size on a 4-column grid (M00 §4.4). `board`
 * defaults to the scope's kind; the Program's today page passes `'today'`. Sizes come from the
 * modules' `defaultBoard` when they list the card. M10 replaces this with the user's editable
 * layout; the card contract stays the same.
 */
export function CardGrid({ scope, board }: { scope: Scope; board?: BoardKind }) {
  const kind = board ?? scope.kind
  const cards = useCards(kind)
  const defaults = new Map(
    useModules()
      .flatMap((m) => m.defaultBoard?.[kind] ?? [])
      .map((d) => [d.card, d.size] as const),
  )
  const listed = [...defaults.keys()]
  const ordered = [...cards].sort((a, b) => rank(listed, a.id) - rank(listed, b.id))
  return (
    <div className="grid auto-rows-[10rem] grid-cols-1 gap-4 md:grid-cols-4">
      {ordered.map((card) => {
        const Body = card.component
        const size = defaults.get(card.id) ?? card.defaultSize
        return (
          <Card key={card.id} className={cn('overflow-hidden', SIZE_CLASS[size])}>
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
                  size={size}
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

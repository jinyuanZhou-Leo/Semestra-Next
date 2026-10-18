import { useState } from 'react'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader } from '@/ui/empty'
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/ui/item'
import { Input } from '@/ui/input'
import type { BoardKind, CardContribution, CardSize } from '../extensions'
import { useModules } from '../registry'
import { SPANS } from './layout'

/** A tiny picture of a size on the 4-column grid. */
function SizePreview({ size }: { size: CardSize }) {
  const [w, h] = SPANS[size]
  return (
    <span
      aria-hidden
      className="inline-grid grid-cols-4 grid-rows-2 gap-px rounded-sm bg-border p-px"
      title={size.toUpperCase()}
    >
      {Array.from({ length: 8 }, (_, i) => (
        <span
          key={i}
          className={cn(
            'size-1.5',
            i % 4 < w && Math.floor(i / 4) < h ? 'bg-primary' : 'bg-background',
          )}
        />
      ))}
    </span>
  )
}

/**
 * "Add card" (M10 §5.2): the cards of installed modules that fit this board, grouped by module.
 * A card that allows one instance and is already on the board is shown but disabled.
 */
export function AddCardDialog({
  kind,
  present,
  open,
  onOpenChange,
  onAdd,
}: {
  kind: BoardKind
  /** Card ids on the board now. */
  present: ReadonlySet<string>
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (card: CardContribution) => void
}) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const groups = useModules()
    .map((module) => ({
      module,
      cards: (module.cards ?? []).filter(
        (card) =>
          card.scopes.includes(kind) &&
          (!needle ||
            card.title().toLowerCase().includes(needle) ||
            card.description?.().toLowerCase().includes(needle) ||
            module.name().toLowerCase().includes(needle)),
      ),
    }))
    .filter((group) => group.cards.length > 0)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setQuery('')
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{m.board_add_card()}</DialogTitle>
          <DialogDescription>{m.board_add_card_description()}</DialogDescription>
        </DialogHeader>
        <Input
          type="search"
          aria-label={m.board_add_card_search()}
          placeholder={m.board_add_card_search()}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="max-h-[60vh] space-y-4 overflow-y-auto">
          {groups.length === 0 ? (
            <Empty className="p-6">
              <EmptyHeader>
                <EmptyDescription>{m.board_add_card_none()}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}
          {groups.map(({ module, cards }) => (
            <section key={module.id} aria-label={module.name()}>
              <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">{module.name()}</h3>
              <ul className="grid gap-2 sm:grid-cols-2">
                {cards.map((card) => {
                  const taken = !card.multiple && present.has(card.id)
                  return (
                    <li key={card.id}>
                      <Item
                        variant="outline"
                        className="h-auto items-start hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                        render={
                          <button
                            type="button"
                            disabled={taken}
                            aria-label={card.title()}
                            onClick={() => onAdd(card)}
                          />
                        }
                      >
                        <ItemMedia variant="icon">
                          <card.icon aria-hidden className="text-muted-foreground" />
                        </ItemMedia>
                        <ItemContent className="min-w-0">
                          <ItemTitle>{card.title()}</ItemTitle>
                          {card.description ? (
                            <ItemDescription>{card.description()}</ItemDescription>
                          ) : null}
                          {taken ? (
                            <ItemDescription>{m.board_add_card_taken()}</ItemDescription>
                          ) : null}
                          <span className="mt-1.5 flex gap-1.5">
                            {card.sizes.map((size) => (
                              <SizePreview key={size} size={size} />
                            ))}
                          </span>
                        </ItemContent>
                      </Item>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

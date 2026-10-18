import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Settings2, Trash2 } from 'lucide-react'
import { type CSSProperties, useState } from 'react'
import { toastError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'
import type { CardContribution, CardSize, Scope } from '../extensions'
import { PluginBoundary } from '../host/PluginBoundary'
import type { DraftCard } from './Board'
import { CardSettingsDialog } from './CardSettingsDialog'
import { useCardSettings } from './queries'
import { parseCardSettings } from './settings'

const SIZE_LABEL: Record<CardSize, () => string> = {
  s: m.board_size_s,
  m: m.board_size_m,
  l: m.board_size_l,
  xl: m.board_size_xl,
}

type Props = {
  scope: Scope
  card: DraftCard
  contribution: CardContribution
  editing: boolean
  /** Positions can be dragged only on the 4-column grid; narrower screens flow in order. */
  movable: boolean
  className?: string
  style?: CSSProperties
  onResize: (size: CardSize) => void
  onRemove: () => void
  /** Settings of a card added in this edit session (saved with the layout). */
  onDraftSettings: (settings: Record<string, unknown>) => void
}

/**
 * The frame every card gets from the host (M10 §5.2): icon, title, the card's header actions
 * and settings; in edit mode also a drag handle, the sizes the card supports and remove. Cards
 * render only their content.
 */
export function CardFrame({
  scope,
  card,
  contribution,
  editing,
  movable,
  className,
  style,
  onResize,
  onRemove,
  onDraftSettings,
}: Props) {
  const title = contribution.title()
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } =
    useDraggable({ id: card.id, disabled: !editing || !movable })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { save } = useCardSettings<Record<string, unknown>>(card.id)
  const settings = parseCardSettings(contribution, card.settings)
  const Body = contribution.component
  const Actions = contribution.headerActions
  const props = { scope, instanceId: card.id, size: card.size, settings }

  const submitSettings = async (value: unknown) => {
    const next = value as Record<string, unknown>
    if (card.isNew) {
      onDraftSettings(next)
      return
    }
    try {
      await save(next)
      if (editing) onDraftSettings(next)
    } catch (err) {
      toastError(err)
      throw err
    }
  }

  return (
    <section
      ref={setNodeRef}
      aria-label={title}
      data-card={contribution.id}
      className={cn(
        'group/board-card relative flex min-h-0 flex-col overflow-hidden rounded-2xl bg-card text-sm text-card-foreground ring-1 ring-foreground/10',
        editing && 'animate-jiggle motion-reduce:animate-none',
        isDragging && 'z-10 animate-none shadow-lg ring-primary/40',
        className,
      )}
      style={{ ...style, transform: CSS.Translate.toString(transform) }}
    >
      <header className="flex items-center gap-1.5 px-4 pt-3 pb-1">
        {editing && movable ? (
          <button
            ref={setActivatorNodeRef}
            type="button"
            aria-label={m.board_card_move({ card: title })}
            className="-ml-1.5 flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <GripVertical aria-hidden className="size-4" />
          </button>
        ) : null}
        <contribution.icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <h3 className="min-w-0 truncate font-heading text-sm font-medium">{title}</h3>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {!editing && Actions ? (
            <PluginBoundary compact>
              <Actions {...props} />
            </PluginBoundary>
          ) : null}
          {editing && contribution.sizes.length > 1 ? (
            <ToggleGroup
              aria-label={m.board_card_size({ card: title })}
              size="sm"
              value={[card.size]}
              onValueChange={(value) => {
                const size = contribution.sizes.find((s) => s === value[0])
                if (size) onResize(size)
              }}
            >
              {contribution.sizes.map((size) => (
                <ToggleGroupItem
                  key={size}
                  value={size}
                  aria-label={SIZE_LABEL[size]()}
                  title={SIZE_LABEL[size]()}
                  className="h-6 min-w-6 px-1.5 text-[0.625rem] uppercase"
                >
                  {size}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          ) : null}
          {contribution.settings ? (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={m.board_card_settings({ card: title })}
              title={m.board_card_settings({ card: title })}
              className={cn(
                !editing &&
                  'opacity-0 group-hover/board-card:opacity-100 focus-visible:opacity-100',
              )}
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 aria-hidden />
            </Button>
          ) : null}
          {editing ? (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={m.board_card_remove({ card: title })}
              title={m.board_card_remove({ card: title })}
              onClick={onRemove}
            >
              <Trash2 aria-hidden />
            </Button>
          ) : null}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden px-4 pb-3" inert={editing || undefined}>
        {card.isNew ? (
          // Not created yet: its content (and any data it loads) appears once the layout is saved.
          <p className="flex h-full items-center justify-center text-xs text-muted-foreground">
            {m.board_card_new()}
          </p>
        ) : (
          <PluginBoundary compact>
            <Body {...props} />
          </PluginBoundary>
        )}
      </div>
      {contribution.settings ? (
        <CardSettingsDialog
          card={contribution}
          value={settings}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          onSubmit={submitSettings}
        />
      ) : null}
    </section>
  )
}

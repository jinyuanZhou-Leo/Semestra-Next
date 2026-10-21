import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, MoreHorizontal, Settings2, Trash2 } from 'lucide-react'
import { type CSSProperties, useState } from 'react'
import { toastError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import { ChoiceControl } from '@/app/settings/choice'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import type { CardContribution, CardSize, Scope } from '../extensions'
import { PluginBoundary } from '../host/PluginBoundary'
import type { DraftCard } from './Board'
import { CardSettingsDialog } from './CardSettingsDialog'
import { useCardSettings } from './queries'
import { parseCardSettings } from './settings'

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
      <header className="flex h-9 shrink-0 items-center gap-1.5 px-4 pt-3 pb-1">
        {editing && movable ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  ref={setActivatorNodeRef}
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={m.board_card_move({ card: title })}
                  className="-ml-1.5 cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
                  {...attributes}
                  {...listeners}
                />
              }
            >
              <GripVertical aria-hidden />
            </TooltipTrigger>
            <TooltipContent>{m.board_card_move({ card: title })}</TooltipContent>
          </Tooltip>
        ) : null}
        <contribution.icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <h3 className="min-w-0 flex-1 truncate font-heading text-sm font-medium">{title}</h3>
        <div className="flex shrink-0 items-center gap-0.5">
          {!editing && Actions ? (
            <PluginBoundary compact>
              <Actions {...props} />
            </PluginBoundary>
          ) : null}
          {!editing && contribution.settings ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={m.board_card_settings({ card: title })}
                    className="opacity-0 group-hover/board-card:opacity-100 focus-visible:opacity-100"
                    onClick={() => setSettingsOpen(true)}
                  />
                }
              >
                <Settings2 aria-hidden />
              </TooltipTrigger>
              <TooltipContent>{m.board_card_settings({ card: title })}</TooltipContent>
            </Tooltip>
          ) : null}
          {editing && (contribution.sizes.length > 1 || contribution.settings) ? (
            // Size and settings share one button so the title keeps its room on small cards.
            <Popover>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <PopoverTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={m.board_card_options({ card: title })}
                        />
                      }
                    />
                  }
                >
                  <MoreHorizontal aria-hidden />
                </TooltipTrigger>
                <TooltipContent>{m.board_card_options({ card: title })}</TooltipContent>
              </Tooltip>
              <PopoverContent align="end" className="w-56 gap-3">
                {contribution.sizes.length > 1 ? (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">
                      {m.board_card_size_label()}
                    </span>
                    <ChoiceControl
                      label={m.board_card_size({ card: title })}
                      value={card.size}
                      onChange={onResize}
                      options={contribution.sizes.map((size) => ({
                        value: size,
                        label: size.toUpperCase(),
                      }))}
                    />
                  </div>
                ) : null}
                {contribution.settings ? (
                  <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
                    <Settings2 aria-hidden />
                    {m.board_card_settings_button()}
                  </Button>
                ) : null}
              </PopoverContent>
            </Popover>
          ) : null}
          {editing ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="destructive"
                    size="icon-xs"
                    aria-label={m.board_card_remove({ card: title })}
                    onClick={onRemove}
                  />
                }
              >
                <Trash2 aria-hidden />
              </TooltipTrigger>
              <TooltipContent>{m.board_card_remove({ card: title })}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </header>
      <div
        className={cn('min-h-0 flex-1 overflow-hidden px-4 pb-3', editing && 'opacity-60')}
        inert={editing || undefined}
      >
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

import { GripVertical, Settings2, Trash2 } from 'lucide-react'
import { type KeyboardEvent, useId, useRef, useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toastError } from '@/lib/errors'
import { SEGMENT, SEGMENTED } from '@/lib/segmented'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Separator } from '@/ui/separator'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import type { CardContribution, CardSize, Scope } from '../extensions'
import { PluginBoundary } from '../host/PluginBoundary'
import type { DraftCard } from './Board'
import { CardSettingsDialog } from './CardSettingsDialog'
import { SPANS } from './layout'
import { useCardSettings } from './queries'
import { parseCardSettings } from './settings'

type Props = {
  scope: Scope
  card: DraftCard
  contribution: CardContribution
  editing: boolean
  /** Positions can be changed only on 4 columns and wider; narrower boards flow in order. */
  movable: boolean
  /** Picked in edit mode: its toolbar (size, settings, remove) floats next to it. */
  selected: boolean
  /** While the card is dragged or resized. */
  toolbarHidden: boolean
  /** The card is in the top row, where the toolbar goes below it instead of above. */
  toolbarBelow: boolean
  /** The card is in the left half: the toolbar lines up with its left edge, not its right. */
  toolbarStart: boolean
  /** The size a running resize would snap to. */
  resizingTo?: CardSize
  onSelect: (selected: boolean) => void
  /** Moves the card by whole cells (keyboard). */
  onMove: (dx: number, dy: number) => void
  onResize: (size: CardSize) => void
  onRemove: () => void
  /** Settings changed while editing (kept in the draft so the saved layout carries them). */
  onDraftSettings: (settings: Record<string, unknown>) => void
}

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

/**
 * The frame every card gets from the host (M10 §5.2): icon, title, the card's header actions
 * and settings. In edit mode the content stays visible but cannot be used; clicking a card
 * selects it and shows its toolbar, the board moves and resizes it. Cards render only their
 * content.
 */
export function CardFrame({
  scope,
  card,
  contribution,
  editing,
  movable,
  selected,
  toolbarHidden,
  toolbarBelow,
  toolbarStart,
  resizingTo,
  onSelect,
  onMove,
  onResize,
  onRemove,
  onDraftSettings,
}: Props) {
  const title = contribution.title()
  const hintId = useId()
  const frame = useRef<HTMLElement>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const { save } = useCardSettings<Record<string, unknown>>(card.id)
  const settings = parseCardSettings(contribution, card.settings)
  const Body = contribution.component
  const Actions = contribution.headerActions
  const props = { scope, instanceId: card.id, size: card.size, settings }

  const submitSettings = async (value: unknown) => {
    const next = value as Record<string, unknown>
    try {
      await save(next)
      if (editing) onDraftSettings(next)
    } catch (err) {
      toastError(err)
      throw err
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return
    const arrow = ARROWS[event.key]
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(true)
    } else if (event.key === 'Escape') {
      onSelect(false)
    } else if (movable && arrow) {
      event.preventDefault()
      onMove(...arrow)
    }
  }

  /** Escape in the toolbar deselects and puts the focus back on the card. */
  const onToolbarKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return
    onSelect(false)
    frame.current?.focus()
  }

  return (
    <>
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- see tabIndex */}
      <section
        ref={frame}
        aria-label={title}
        aria-describedby={editing ? hintId : undefined}
        data-card={contribution.id}
        data-selected={selected || undefined}
        // In edit mode a card is an item to select and move with the keyboard.
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={editing ? 0 : undefined}
        onClick={editing ? () => onSelect(true) : undefined}
        onKeyDown={editing ? onKeyDown : undefined}
        className={cn(
          'group/board-card relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-card text-sm text-card-foreground ring-1 ring-foreground/10 outline-none',
          editing && 'select-none focus-visible:ring-2 focus-visible:ring-ring',
          editing && movable && 'cursor-grab active:cursor-grabbing',
          selected && 'shadow-lg ring-2 ring-primary',
        )}
      >
        <header className="flex h-9 shrink-0 items-center gap-1.5 px-4 pt-3 pb-1">
          {editing && movable ? (
            <GripVertical aria-hidden className="-ml-1.5 size-4 shrink-0 text-muted-foreground" />
          ) : null}
          <contribution.icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <h3 className="min-w-0 flex-1 truncate font-heading text-sm font-medium">{title}</h3>
          {!editing ? (
            <div className="flex shrink-0 items-center gap-0.5">
              {Actions ? (
                <PluginBoundary compact>
                  <Actions {...props} />
                </PluginBoundary>
              ) : null}
              {contribution.settings ? (
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
            </div>
          ) : (
            <span id={hintId} className="sr-only" aria-live="polite">
              {selected
                ? m.board_card_selected()
                : movable
                  ? m.board_card_keyboard()
                  : m.board_card_keyboard_narrow()}
            </span>
          )}
        </header>
        <div
          className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-3"
          inert={editing || undefined}
        >
          <PluginBoundary compact>
            <Body {...props} />
          </PluginBoundary>
        </div>
        {resizingTo ? (
          <span className="pointer-events-none absolute right-8 bottom-2 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground tabular-nums">
            {`${resizingTo.toUpperCase()} · ${SPANS[resizingTo].join('×')}`}
          </span>
        ) : null}
      </section>
      {selected && !toolbarHidden ? (
        <div
          role="toolbar"
          aria-label={m.board_card_options({ card: title })}
          data-board-toolbar
          tabIndex={-1}
          onKeyDown={onToolbarKeyDown}
          className={cn(
            'absolute z-30 flex items-center gap-1 rounded-2xl bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10',
            toolbarBelow ? 'top-full mt-2' : 'bottom-full mb-2',
            toolbarStart ? 'left-0' : 'right-0',
          )}
        >
          {contribution.sizes.length > 1 ? (
            <ToggleGroup
              aria-label={m.board_card_size({ card: title })}
              size="sm"
              className={SEGMENTED}
              value={[card.size]}
              onValueChange={(value) => value[0] && onResize(value[0] as CardSize)}
            >
              {contribution.sizes.map((size) => (
                <ToggleGroupItem key={size} value={size} className={SEGMENT}>
                  {size.toUpperCase()}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          ) : null}
          {contribution.sizes.length > 1 ? (
            <Separator orientation="vertical" className="mx-0.5 h-5 self-center" />
          ) : null}
          {contribution.settings ? (
            <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)}>
              <Settings2 aria-hidden />
              {m.board_card_settings_short()}
            </Button>
          ) : null}
          <Button variant="destructive" size="sm" onClick={() => setRemoveOpen(true)}>
            <Trash2 aria-hidden />
            {m.board_card_remove_short()}
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={m.board_card_remove_title({ card: title })}
        description={m.board_card_remove_description()}
        confirmLabel={m.board_card_remove_short()}
        onConfirm={() => {
          setRemoveOpen(false)
          onRemove()
        }}
      />
      {contribution.settings ? (
        <CardSettingsDialog
          card={contribution}
          scope={scope}
          value={settings}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          onSubmit={submitSettings}
        />
      ) : null}
    </>
  )
}

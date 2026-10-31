import { GripVertical, Settings2, Trash2 } from 'lucide-react'
import { type KeyboardEvent, useId, useRef } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toastError } from '@/lib/errors'
import { SEGMENT, SEGMENTED } from '@/lib/segmented'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { ButtonGroup, ButtonGroupSeparator } from '@/ui/button-group'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import type { CardContribution, CardSize, Scope } from '../extensions'
import { PluginBoundary } from '../host/PluginBoundary'
import type { DraftCard } from './Board'
import { CardSettingsDialog } from './CardSettingsDialog'
import { CardSkeleton } from './CardSkeleton'
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
  /**
   * Opens the card's settings or the remove confirmation. The board renders those dialogs outside
   * the grid: pressing inside a portal would otherwise bubble to the grid item and drag the card.
   */
  onOpenDialog: (dialog: CardDialogKind) => void
}

export type CardDialogKind = 'settings' | 'remove'

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
  onOpenDialog,
}: Props) {
  const title = contribution.title()
  const hintId = useId()
  const frame = useRef<HTMLElement>(null)
  const settings = parseCardSettings(contribution, card.settings)
  const Body = contribution.component
  const Actions = contribution.headerActions
  const props = { scope, instanceId: card.id, size: card.size, settings }
  // A small (1×1) card names itself in its content, so its title row would only take space;
  // cards whose content cannot say what they are keep it (`keepTitleWhenSmall`).
  const titled = card.size !== 's' || contribution.keepTitleWhenSmall === true
  const showTitle = titled || editing

  // The header's buttons, the card's own and its settings, show on hover or focus where there is
  // a pointer that can hover, and stay while one of them has a menu open; touch screens always
  // show them.
  const actions =
    Actions || contribution.settings ? (
      <div className="flex shrink-0 items-center gap-0.5 transition-opacity [@media(hover:hover)]:opacity-0 group-hover/board-card:opacity-100 focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100">
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
                  className="text-muted-foreground"
                  onClick={() => onOpenDialog('settings')}
                />
              }
            >
              <Settings2 aria-hidden />
            </TooltipTrigger>
            <TooltipContent>{m.board_card_settings({ card: title })}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    ) : null
  const hint = (
    <span id={hintId} className="sr-only" aria-live="polite">
      {selected
        ? m.board_card_selected()
        : movable
          ? m.board_card_keyboard()
          : m.board_card_keyboard_narrow()}
    </span>
  )

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
        {showTitle ? (
          <header
            className={cn(
              'flex h-9 shrink-0 items-center gap-1.5 px-4 pt-3 pb-1',
              // A small card's title shows only while editing, over its content.
              !titled && 'absolute inset-x-0 top-0 z-10 h-auto bg-card pb-2',
            )}
          >
            {editing && movable ? (
              <GripVertical aria-hidden className="-ml-1.5 size-4 shrink-0 text-muted-foreground" />
            ) : null}
            <contribution.icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <h3 className="min-w-0 flex-1 truncate font-heading text-sm font-medium">{title}</h3>
            {!editing && titled ? actions : null}
            {editing ? hint : null}
          </header>
        ) : (
          <>
            <h3 className="sr-only">{title}</h3>
            {/* Without a header row the buttons float over the card's top right corner. */}
            <div className="absolute top-2 right-2 z-10 rounded-full bg-card">{actions}</div>
          </>
        )}
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-3',
            !titled && 'pt-3',
            // Empty states inside a card stay below the card's title in weight (M00 §4.5 tier 2).
            '[&_[data-slot=empty-icon]]:mb-0 [&_[data-slot=empty-title]]:text-sm',
          )}
          inert={editing || undefined}
        >
          <PluginBoundary compact fallback={<CardSkeleton />}>
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
        <ButtonGroup
          role="toolbar"
          aria-label={m.board_card_options({ card: title })}
          data-board-toolbar
          tabIndex={-1}
          onKeyDown={onToolbarKeyDown}
          className={cn(
            'absolute z-30 items-center rounded-2xl bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10',
            toolbarBelow ? 'top-full mt-2' : 'bottom-full mb-2',
            toolbarStart ? 'left-0' : 'right-0',
          )}
        >
          {contribution.sizes.length > 1 ? (
            <ButtonGroup>
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
            </ButtonGroup>
          ) : null}
          {contribution.sizes.length > 1 ? <ButtonGroupSeparator /> : null}
          {contribution.settings ? (
            <ButtonGroup>
              <Button variant="ghost" size="sm" onClick={() => onOpenDialog('settings')}>
                <Settings2 aria-hidden />
                {m.board_card_settings_short()}
              </Button>
            </ButtonGroup>
          ) : null}
          <ButtonGroup>
            <Button variant="destructive" size="sm" onClick={() => onOpenDialog('remove')}>
              <Trash2 aria-hidden />
              {m.board_card_remove_short()}
            </Button>
          </ButtonGroup>
        </ButtonGroup>
      ) : null}
    </>
  )
}

/**
 * A card's settings or remove confirmation, rendered by the board outside the grid. Settings
 * changed while editing go into the draft too, so the saved layout carries them.
 */
export function CardDialog({
  scope,
  card,
  contribution,
  dialog,
  open,
  editing,
  onClose,
  onRemove,
  onDraftSettings,
}: {
  scope: Scope
  card: DraftCard
  contribution: CardContribution
  dialog: CardDialogKind
  /** Kept mounted after closing so the dialog animates out (also when the card was removed). */
  open: boolean
  editing: boolean
  onClose: () => void
  onRemove: () => void
  onDraftSettings: (settings: Record<string, unknown>) => void
}) {
  const { save } = useCardSettings<Record<string, unknown>>(card.id)
  const title = contribution.title()

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

  return (
    <>
      <ConfirmDialog
        open={open && dialog === 'remove'}
        onOpenChange={(next) => !next && onClose()}
        title={m.board_card_remove_title({ card: title })}
        description={m.board_card_remove_description()}
        confirmLabel={m.board_card_remove_short()}
        onConfirm={onRemove}
      />
      {contribution.settings ? (
        <CardSettingsDialog
          card={contribution}
          scope={scope}
          value={parseCardSettings(contribution, card.settings)}
          open={open && dialog === 'settings'}
          onOpenChange={(next) => !next && onClose()}
          onSubmit={submitSettings}
        />
      ) : null}
    </>
  )
}

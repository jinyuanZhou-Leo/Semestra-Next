import type { Board as BoardData, BoardCard, CardPosition } from '@semestra/api-client'
import {
  layoutsBoardUpdate,
  layoutsCardAdd,
  layoutsTemplateGet,
  layoutsTemplateReset,
  layoutsTemplateSaveFromBoard,
} from '@semestra/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { LayoutDashboard, Pencil } from 'lucide-react'
import { type PointerEvent, useEffect, useRef, useState } from 'react'
import { GridLayout, type Layout, type LayoutItem as GridItem } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import { toast } from 'sonner'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { toastError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/ui/empty'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import type { BoardKind, CardContribution, CardSize, Scope } from '../extensions'
import { useHasHostAction, useHostAction } from '../commands/bus'
import { formatHotkey, useHotkey } from '../hotkeys'
import { useCards, useInstalledPluginsReady } from '../registry'
import { AddCardDialog } from './AddCardDialog'
import './board.css'
import { BoardEditActions, useBoardEditHint } from './BoardToolbar'
import { CardDialog, type CardDialogKind, CardFrame } from './CardFrame'
import {
  applyLayout,
  COLS,
  columnsFor,
  compact,
  firstFree,
  type LayoutItem,
  layoutAt,
  moveItem,
  normalize,
  type PlacedCard,
  resizeItem,
  stepSize,
  sameLayout,
  span,
} from './layout'
import { boardOptions, boardRef, type BoardRef, useBoard } from './queries'
import { useElementWidth } from './media'

/** Row height and gap of the grid in px. */
const ROW = 160
const GAP = 16
const GRID_MARGIN = [GAP, GAP] as const
const GRID_PADDING = [0, 0] as const
// Cards are resized by our own corner handle (see `startResize`).
const RESIZE_OFF = { enabled: false }

export type DraftCard = PlacedCard & {
  cardId: string
  settings: Record<string, unknown>
}

const fromServer = (c: BoardCard): DraftCard => ({
  id: c.instance_id,
  cardId: c.card_id,
  size: c.size,
  x: c.x,
  y: c.y,
  positions: c.positions ?? [],
  settings: c.settings,
})

const readingOrder = (a: LayoutItem, b: LayoutItem) => a.y - b.y || a.x - b.x

const samePositions = (a: CardPosition[], b: CardPosition[]) =>
  a.length === b.length &&
  a.every((p, i) => p.cols === b[i]?.cols && p.x === b[i]?.x && p.y === b[i]?.y)

function changed(saved: readonly DraftCard[], draft: readonly DraftCard[]): boolean {
  if (!sameLayout(saved, draft)) return true
  const byId = new Map(saved.map((c) => [c.id, c]))
  return draft.some((c) => !samePositions(byId.get(c.id)?.positions ?? [], c.positions))
}

async function saveLayout(ref: BoardRef, draft: readonly DraftCard[]): Promise<BoardData> {
  const { data } = await layoutsBoardUpdate({
    path: ref,
    body: {
      cards: draft.map((c) => ({
        instance_id: c.id,
        card_id: c.cardId,
        size: c.size,
        x: c.x,
        y: c.y,
        positions: c.positions,
      })),
    },
    throwOnError: true,
  })
  return data
}

/**
 * The editable card grid of an overview or the Today page (M10 §5.2). Outside edit mode it
 * shows the stored board; "Edit layout" (or `E`) keeps every change local until "Done", which
 * saves the whole layout at once and rolls back with a message if that fails. Leaving the page
 * saves too.
 */
export function Board({ scope, board }: { scope: Scope; board?: 'today' }) {
  const ref = boardRef(scope, board)
  const query = useBoard(ref)
  return (
    <AsyncBoundary query={query}>
      {(data) => (
        <BoardView
          key={`${ref.scope_type}:${ref.scope_id}`}
          scope={scope}
          kind={board ?? scope.kind}
          boardRef={ref}
          data={data}
          fetching={query.isFetching}
        />
      )}
    </AsyncBoundary>
  )
}

function BoardView({
  scope,
  kind,
  boardRef: ref,
  data,
  fetching,
}: {
  scope: Scope
  kind: BoardKind
  boardRef: BoardRef
  data: BoardData
  /** A refetch is running: the cached board may miss cards of a plugin installed since. */
  fetching: boolean
}) {
  const queryClient = useQueryClient()
  const contributions = useCards(kind)
  const known = new Map(contributions.map((c) => [c.id, c]))
  const saved = data.cards.filter((c) => known.has(c.card_id)).map(fromServer)

  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const width = useElementWidth(container)
  const cols = columnsFor(width)
  // Positions can be dragged on 4 columns and wider; narrower boards flow in reading order.
  const movable = cols >= COLS

  const [draft, setDraft] = useState<DraftCard[] | null>(null)
  const [saving, setSaving] = useState(false)
  // Editing waits for the installed plugins and a fresh board (or a plugin's cards would be left
  // out of the draft and removed on save) and for the previous save.
  const canEdit = useInstalledPluginsReady() && !fetching && !saving
  const [adding, setAdding] = useState(false)
  /** Cards being created on the server: "Done" waits for them so none is left behind. */
  const [creating, setCreating] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  /** The card being resized by its corner, at the size it snapped to. */
  const [resizing, setResizing] = useState<{ id: string; size: CardSize } | null>(null)
  // Where the running corner resize started (pointer, size and layout), read in the pointer
  // handlers: every step is worked out from there, so dragging back restores the layout.
  const resizeStart = useRef<{
    x: number
    y: number
    size: CardSize
    items: LayoutItem[]
  } | null>(null)
  /** A card's settings or remove confirmation; kept after closing so the dialog animates out. */
  const [dialog, setDialog] = useState<{
    card: DraftCard
    kind: CardDialogKind
    open: boolean
  } | null>(null)
  const editing = draft !== null
  // The page header (every scope page, Today included) hosts the edit controls; a board rendered without one keeps its own row.
  const headerHostsEdit = useHasHostAction('header.shown')
  const editHint = useBoardEditHint()
  const cards = draft ?? saved

  // What to save if the page goes away mid-edit.
  const pending = useRef<DraftCard[] | null>(null)
  useEffect(() => {
    pending.current = draft
  })

  async function commit(next: DraftCard[]) {
    const key = boardOptions(ref).queryKey
    const previous = queryClient.getQueryData<BoardData>(key)
    if (previous && !changed(previous.cards.map(fromServer), next)) return
    if (previous) {
      // Show the new layout at once; replaced by the server's answer or rolled back.
      queryClient.setQueryData<BoardData>(key, {
        ...previous,
        cards: next.map((c) => ({
          instance_id: c.id,
          card_id: c.cardId,
          size: c.size,
          x: c.x,
          y: c.y,
          positions: c.positions,
          settings: c.settings,
        })),
      })
    }
    setSaving(true)
    try {
      queryClient.setQueryData(key, await saveLayout(ref, next))
    } catch (err) {
      // Cards added in this session already exist on the server: refetch instead of restoring.
      await queryClient.invalidateQueries({ queryKey: key })
      toast.error(m.board_save_failed())
      toastError(err)
      setSaving(false)
      throw err
    }
    setSaving(false)
  }

  useEffect(
    () => () => {
      if (pending.current) void commit(normalize(pending.current)).catch(() => {})
    },
    // Only on unmount: leaving the page ends edit mode and saves.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  function stopResize() {
    resizeStart.current = null
    setResizing(null)
  }

  function startEditing() {
    if (!canEdit) return
    stopResize()
    setDraft(saved)
  }

  function finishEditing() {
    if (!draft || creating > 0) return
    const next = normalize(draft)
    setDraft(null)
    setSelected(null)
    stopResize()
    void commit(next).catch(() => {})
  }

  useHotkey('e', () => (editing ? finishEditing() : startEditing()), {
    description: m.hotkeys_edit_board,
    order: 30,
  })

  useHostAction('board.edit', startEditing, !editing && canEdit)
  useHostAction('board.shown', () => {}, !editing)
  useHostAction('board.editing', () => {}, editing)
  useHostAction('board.done', finishEditing, editing && creating === 0)
  useHostAction(
    'board.add',
    () => {
      if (!editing) startEditing()
      setAdding(true)
    },
    editing || canEdit,
  )

  /** Applies a layout change made on the current column count. */
  function relayout(fn: (items: LayoutItem[]) => LayoutItem[]) {
    setDraft((current) =>
      current ? applyLayout(current, cols, fn(layoutAt(current, cols))) : current,
    )
  }

  /**
   * Creates a card on the server right away, so its content shows while still editing. The
   * cached board gets it too: it is what "Done" compares the draft with, and the card has to be
   * saved away if it is removed again before then.
   */
  async function create(card: CardContribution, size: CardSize): Promise<DraftCard | undefined> {
    const settings = card.settings?.schema.safeParse({})
    setCreating((n) => n + 1)
    return layoutsCardAdd({
      path: ref,
      body: {
        card_id: card.id,
        size,
        settings: settings?.success ? (settings.data as Record<string, never>) : undefined,
      },
      throwOnError: true,
    })
      .then(({ data: created }) => {
        queryClient.setQueryData<BoardData>(boardOptions(ref).queryKey, (current) =>
          current && !current.cards.some((c) => c.instance_id === created.instance_id)
            ? { ...current, cards: [...current.cards, created] }
            : current,
        )
        return fromServer(created)
      })
      .catch((err: unknown) => {
        toastError(err)
        return undefined
      })
      .finally(() => setCreating((n) => n - 1))
  }

  /**
   * Instances still on the server that the draft dropped, to bring back instead of creating new
   * ones: a card that allows one instance cannot be added twice, and its content is kept.
   */
  function removed(current: readonly DraftCard[]): DraftCard[] {
    return saved.filter((s) => !current.some((c) => c.id === s.id))
  }

  async function addCard(card: CardContribution) {
    setAdding(false)
    const back = card.multiple ? undefined : removed(draft ?? []).find((c) => c.cardId === card.id)
    const added = back ?? (await create(card, card.defaultSize))
    if (!added) return
    setDraft((current) => {
      if (!current) return current
      const spot = firstFree(layoutAt(current, COLS), added.size)
      return [...current, { ...added, ...spot, positions: [] }]
    })
    setSelected(added.id)
  }

  async function restoreDefault() {
    const template = await layoutsTemplateGet({
      path: { scope_type: ref.scope_type },
      throwOnError: true,
    })
      .then((result) => result.data)
      .catch(toastError)
    if (!template) return
    const current = draft ?? saved
    const reuse = new Map<string, DraftCard[]>()
    for (const c of [...current, ...removed(current)]) {
      reuse.set(c.cardId, [...(reuse.get(c.cardId) ?? []), c])
    }
    const next: DraftCard[] = []
    for (const t of template.cards) {
      const card = known.get(t.card_id)
      if (!card || !card.sizes.includes(t.size)) continue
      if (!card.multiple && next.some((c) => c.cardId === card.id)) continue
      const existing = reuse.get(card.id)?.shift()
      const instance = existing ?? (await create(card, t.size))
      if (instance) next.push({ ...instance, size: t.size, x: t.x, y: t.y, positions: [] })
    }
    setSelected(null)
    setDraft(compact(next))
  }

  async function saveAsDefault() {
    try {
      if (draft) {
        const next = normalize(draft)
        setDraft(null)
        setSelected(null)
        await commit(next)
      }
      await layoutsTemplateSaveFromBoard({
        path: { scope_type: ref.scope_type },
        body: { scope_id: ref.scope_id },
        throwOnError: true,
      })
      toast.success(m.board_default_saved())
    } catch (err) {
      toastError(err)
    }
  }

  async function resetDefault() {
    try {
      await layoutsTemplateReset({ path: { scope_type: ref.scope_type }, throwOnError: true })
      await queryClient.invalidateQueries({ queryKey: [{ _id: 'layoutsBoardGet' }] })
      toast.success(m.board_default_reset_done())
    } catch (err) {
      toastError(err)
    }
  }

  useHostAction('board.default.save', () => void saveAsDefault(), editing)
  useHostAction('board.default.restore', () => void restoreDefault(), editing)
  useHostAction('board.default.reset', () => void resetDefault(), editing)

  // --- the grid --------------------------------------------------------------------------------
  const items = layoutAt(cards, cols)
  const layout: Layout = items.map((item) => {
    const [w, h] = span(item.size, cols)
    return { i: item.id, x: item.x, y: item.y, w, h }
  })
  const position = new Map(items.map((i) => [i.id, i]))

  /** The grid after a drag: back into the draft, and the dragged card is selected. */
  function dropped(next: Layout, _old: GridItem | null, moved: GridItem | null) {
    if (moved) setSelected(moved.i)
    relayout((current) =>
      current.map((item) => {
        const placed = next.find((l) => l.i === item.id)
        return placed ? { ...item, x: placed.x, y: placed.y } : item
      }),
    )
  }

  /*
   * Resizing by the bottom-right corner is ours, not react-grid-layout's: the grid stops a resize
   * at its right edge, so a card in the last column could never grow. The card jumps to the
   * supported size nearest to the pointer, the same as picking it in the toolbar (a card that no
   * longer fits moves left), so its content lays out once per size instead of on every move.
   */
  function startResize(event: PointerEvent<HTMLElement>, id: string, size: CardSize) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    resizeStart.current = { x: event.clientX, y: event.clientY, size, items }
    setSelected(id)
    setResizing({ id, size })
  }

  function moveResize(event: PointerEvent<HTMLElement>, sizes: readonly CardSize[]) {
    const start = resizeStart.current
    if (!start || !resizing) return
    // Cells dragged right and down; the larger one counts, so a card in the last column (with no
    // room to the right) grows by dragging down.
    const dx = (event.clientX - start.x) / ((width - GAP * (cols - 1)) / cols + GAP)
    const dy = (event.clientY - start.y) / (ROW + GAP)
    const size = stepSize(sizes, start.size, Math.round(Math.abs(dx) > Math.abs(dy) ? dx : dy))
    if (size === resizing.size) return
    const { id } = resizing
    setResizing({ id, size })
    relayout(() => (size === start.size ? start.items : resizeItem(start.items, id, size, cols)))
  }

  function removeCard(id: string) {
    setSelected(null)
    setDraft((current) => current?.filter((c) => c.id !== id) ?? current)
    // The toolbar that opened the dialog is gone with the card: keep focus on the board.
    container?.focus()
  }

  const dialogContribution = dialog ? known.get(dialog.card.cardId) : undefined

  return (
    <div className="flex flex-1 flex-col gap-3" data-board={kind}>
      {!headerHostsEdit ? (
        <div className="flex min-h-8 items-center justify-end gap-2">
          {editing ? (
            <>
              <p className="mr-auto truncate text-sm text-muted-foreground">{editHint}</p>
              <BoardEditActions />
            </>
          ) : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={startEditing}
                    disabled={!canEdit}
                    data-tour="board-edit"
                  />
                }
              >
                <Pencil aria-hidden />
                {m.board_edit()}
              </TooltipTrigger>
              <TooltipContent>{formatHotkey('e')}</TooltipContent>
            </Tooltip>
          )}
        </div>
      ) : null}

      {cards.length === 0 && !editing ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LayoutDashboard aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{m.board_empty_title()}</EmptyTitle>
            <EmptyDescription>{m.board_empty_description()}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={startEditing} disabled={!canEdit}>
              <Pencil aria-hidden />
              {m.board_edit()}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        // Pressing on the grid around the cards clears the selection (on press, not click: a
        // resize that ends outside its card would otherwise "click" the grid).
        // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
        <div
          ref={setContainer}
          tabIndex={-1}
          className={cn(
            editing && 'rounded-2xl outline-2 outline-offset-8 outline-border outline-dashed',
          )}
          onPointerDown={(event) => {
            const target = event.target as HTMLElement
            if (target === event.currentTarget || target.classList.contains('react-grid-layout')) {
              setSelected(null)
            }
          }}
        >
          {container ? (
            <GridLayout
              width={width}
              layout={layout}
              gridConfig={{
                cols,
                rowHeight: ROW,
                margin: GRID_MARGIN,
                containerPadding: GRID_PADDING,
              }}
              dragConfig={{
                enabled: editing && movable,
                threshold: 4,
                cancel: '[data-board-toolbar], .board-resize-handle',
              }}
              resizeConfig={RESIZE_OFF}
              // Nothing re-renders while a card is dragged (the toolbar hides by CSS); the board
              // takes the new layout on drop.
              onDragStop={dropped}
            >
              {[...cards]
                .sort((a, b) => readingOrder(position.get(a.id) ?? a, position.get(b.id) ?? b))
                .map((card) => {
                  const contribution = known.get(card.cardId)
                  if (!contribution) return null
                  const at = position.get(card.id) ?? card
                  const [w] = span(at.size, cols)
                  const sizing =
                    editing && movable && resizing?.id === card.id ? resizing.size : undefined
                  return (
                    <div
                      key={card.id}
                      className={cn(selected === card.id && 'z-20')}
                      data-resizing={sizing ? '' : undefined}
                    >
                      <CardFrame
                        scope={scope}
                        card={card}
                        contribution={contribution}
                        editing={editing}
                        movable={movable}
                        selected={editing && selected === card.id}
                        toolbarHidden={sizing !== undefined}
                        toolbarBelow={at.y === 0}
                        toolbarStart={at.x + w / 2 < cols / 2}
                        resizingTo={sizing}
                        onSelect={(on) => setSelected(on ? card.id : null)}
                        onMove={(dx, dy) =>
                          relayout((current) =>
                            moveItem(current, card.id, at.x + dx, at.y + dy, cols),
                          )
                        }
                        onResize={(size) =>
                          relayout((current) => resizeItem(current, card.id, size, cols))
                        }
                        onOpenDialog={(kind) => setDialog({ card, kind, open: true })}
                      />
                      {editing && movable && contribution.sizes.length > 1 ? (
                        <span
                          aria-hidden
                          className="board-resize-handle"
                          onPointerDown={(event) => startResize(event, card.id, card.size)}
                          onPointerMove={(event) => moveResize(event, contribution.sizes)}
                          // Also when the handle goes away mid-drag (edit mode ends, the board narrows).
                          onLostPointerCapture={stopResize}
                        />
                      ) : null}
                    </div>
                  )
                })}
            </GridLayout>
          ) : null}
        </div>
      )}
      <AddCardDialog
        kind={kind}
        present={new Set(cards.map((c) => c.cardId))}
        open={adding}
        onOpenChange={setAdding}
        onAdd={(card) => void addCard(card)}
      />
      {dialog && dialogContribution ? (
        <CardDialog
          key={dialog.card.id}
          scope={scope}
          card={cards.find((c) => c.id === dialog.card.id) ?? dialog.card}
          contribution={dialogContribution}
          dialog={dialog.kind}
          open={dialog.open}
          editing={editing}
          onClose={() => setDialog({ ...dialog, open: false })}
          onRemove={() => {
            setDialog({ ...dialog, open: false })
            removeCard(dialog.card.id)
          }}
          onDraftSettings={(settings) =>
            setDraft(
              (current) =>
                current?.map((c) => (c.id === dialog.card.id ? { ...c, settings } : c)) ?? current,
            )
          }
        />
      ) : null}
    </div>
  )
}

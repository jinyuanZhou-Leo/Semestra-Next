import type { Board as BoardData, BoardCard } from '@semestra/api-client'
import {
  layoutsBoardUpdate,
  layoutsTemplateGet,
  layoutsTemplateReset,
  layoutsTemplateSaveFromBoard,
} from '@semestra/api-client'
import {
  DndContext,
  type DragMoveEvent,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  type KeyboardCoordinateGetter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { useQueryClient } from '@tanstack/react-query'
import { Check, LayoutTemplate, MoreHorizontal, Pencil, Plus } from 'lucide-react'
import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { toastError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@/ui/empty'
import type { BoardKind, CardContribution, CardSize, Scope } from '../extensions'
import { useHostAction } from '../commands/bus'
import { formatHotkey, useHotkey } from '../hotkeys'
import { useCards } from '../registry'
import { AddCardDialog } from './AddCardDialog'
import { CardFrame } from './CardFrame'
import { compact, firstFree, moveItem, resizeItem, rows, sameLayout, SPANS } from './layout'
import { boardOptions, boardRef, type BoardRef, useBoard } from './queries'
import { useMediaQuery } from './media'

/** Row height and gap of the grid in px (`auto-rows-[10rem] gap-4`). */
const ROW = 160
const GAP = 16
const WIDE = '(min-width: 1024px)'

export type DraftCard = {
  id: string
  cardId: string
  size: CardSize
  x: number
  y: number
  settings: Record<string, unknown>
  /** Added in this edit session; created when the layout is saved. */
  isNew: boolean
}

const fromServer = (c: BoardCard): DraftCard => ({
  id: c.instance_id,
  cardId: c.card_id,
  size: c.size,
  x: c.x,
  y: c.y,
  settings: c.settings,
  isNew: false,
})

const readingOrder = (a: DraftCard, b: DraftCard) => a.y - b.y || a.x - b.x

function changed(saved: readonly DraftCard[], draft: readonly DraftCard[]): boolean {
  return draft.some((c) => c.isNew) || !sameLayout(saved, draft)
}

/** Grid placement: explicit on wide screens, reading-order flow below 1024px. */
function placement(card: DraftCard): { className: string; style: CSSProperties } {
  const [w, h] = SPANS[card.size]
  return {
    className: cn(
      'lg:[grid-column:var(--board-col)] lg:[grid-row:var(--board-row)]',
      w > 1 && 'md:col-span-2',
      h > 1 && 'row-span-2',
    ),
    style: {
      '--board-col': `${card.x + 1} / span ${w}`,
      '--board-row': `${card.y + 1} / span ${h}`,
    } as CSSProperties,
  }
}

async function saveLayout(ref: BoardRef, draft: readonly DraftCard[]): Promise<BoardData> {
  const { data } = await layoutsBoardUpdate({
    path: ref,
    body: {
      cards: draft.map((c) => ({
        instance_id: c.isNew ? null : c.id,
        card_id: c.cardId,
        size: c.size,
        x: c.x,
        y: c.y,
        settings: c.isNew ? (c.settings as Record<string, never>) : null,
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
}: {
  scope: Scope
  kind: BoardKind
  boardRef: BoardRef
  data: BoardData
}) {
  const queryClient = useQueryClient()
  const contributions = useCards(kind)
  const known = new Map(contributions.map((c) => [c.id, c]))
  const saved = data.cards.filter((c) => known.has(c.card_id)).map(fromServer)
  const wide = useMediaQuery(WIDE)

  const [draft, setDraft] = useState<DraftCard[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [drag, setDrag] = useState<{ id: string; preview: DraftCard[] } | null>(null)
  const editing = draft !== null
  const cards = drag?.preview ?? draft ?? saved
  const gridRef = useRef<HTMLDivElement>(null)

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
          settings: c.settings,
        })),
      })
    }
    try {
      queryClient.setQueryData(key, await saveLayout(ref, next))
    } catch (err) {
      if (previous) queryClient.setQueryData(key, previous)
      toast.error(m.board_save_failed())
      toastError(err)
      throw err
    }
  }

  useEffect(
    () => () => {
      if (pending.current) void commit(pending.current).catch(() => {})
    },
    // Only on unmount: leaving the page ends edit mode and saves.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  function startEditing() {
    setDraft(saved)
  }

  function finishEditing() {
    if (!draft) return
    const next = draft
    setDraft(null)
    void commit(next).catch(() => {})
  }

  useHotkey('e', () => (editing ? finishEditing() : startEditing()), {
    description: m.hotkeys_edit_board,
    order: 30,
  })

  useHostAction('board.edit', startEditing, !editing)
  useHostAction('board.add', () => {
    if (!editing) startEditing()
    setAdding(true)
  })

  function update(fn: (cards: DraftCard[]) => DraftCard[]) {
    setDraft((current) => (current ? compact(fn(current)) : current))
  }

  function addCard(card: CardContribution) {
    setAdding(false)
    const settings = card.settings?.schema.safeParse({})
    update((current) => {
      const spot = firstFree(current, card.defaultSize)
      return [
        ...current,
        {
          id: `new-${crypto.randomUUID()}`,
          cardId: card.id,
          size: card.defaultSize,
          ...spot,
          settings: settings?.success ? (settings.data as Record<string, unknown>) : {},
          isNew: true,
        },
      ]
    })
  }

  async function restoreDefault() {
    try {
      const { data: template } = await layoutsTemplateGet({
        path: { scope_type: ref.scope_type },
        throwOnError: true,
      })
      const reuse = new Map<string, DraftCard[]>()
      for (const c of draft ?? saved) reuse.set(c.cardId, [...(reuse.get(c.cardId) ?? []), c])
      const next: DraftCard[] = []
      for (const t of template.cards) {
        const card = known.get(t.card_id)
        if (!card || !card.sizes.includes(t.size)) continue
        if (!card.multiple && next.some((c) => c.cardId === card.id)) continue
        const existing = reuse.get(card.id)?.shift()
        next.push(
          existing
            ? { ...existing, size: t.size, x: t.x, y: t.y }
            : {
                id: `new-${crypto.randomUUID()}`,
                cardId: card.id,
                size: t.size,
                x: t.x,
                y: t.y,
                settings: {},
                isNew: true,
              },
        )
      }
      setDraft(compact(next))
    } catch (err) {
      toastError(err)
    }
  }

  async function saveAsDefault() {
    try {
      if (draft) {
        const next = draft
        setDraft(null)
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

  // --- dragging ------------------------------------------------------------------------------
  const metrics = useRef({ col: 0, row: ROW + GAP })
  const origin = useRef<{ x: number; y: number } | null>(null)
  const measure = () => {
    const width = gridRef.current?.getBoundingClientRect().width ?? 0
    metrics.current = { col: (width - GAP * 3) / 4 + GAP, row: ROW + GAP }
  }
  const byCell: KeyboardCoordinateGetter = (event, { currentCoordinates }) => {
    const { col, row } = metrics.current
    switch (event.code) {
      case 'ArrowRight':
        return { ...currentCoordinates, x: currentCoordinates.x + col }
      case 'ArrowLeft':
        return { ...currentCoordinates, x: currentCoordinates.x - col }
      case 'ArrowDown':
        return { ...currentCoordinates, y: currentCoordinates.y + row }
      case 'ArrowUp':
        return { ...currentCoordinates, y: currentCoordinates.y - row }
    }
    return undefined
  }
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: byCell }),
  )

  const onDragStart = ({ active }: DragStartEvent) => {
    measure()
    const card = draft?.find((c) => c.id === active.id)
    origin.current = card ? { x: card.x, y: card.y } : null
    if (draft) setDrag({ id: String(active.id), preview: draft })
  }
  const onDragMove = ({ active, delta }: DragMoveEvent) => {
    if (!draft || !origin.current) return
    const { col, row } = metrics.current
    const x = origin.current.x + Math.round(delta.x / (col || 1))
    const y = origin.current.y + Math.round(delta.y / row)
    const preview = moveItem(draft, String(active.id), x, y)
    setDrag((current) =>
      current && sameLayout(current.preview, preview)
        ? current
        : { id: String(active.id), preview },
    )
  }
  const onDragEnd = () => {
    if (drag) setDraft(drag.preview)
    setDrag(null)
    origin.current = null
  }
  const onDragCancel = () => {
    setDrag(null)
    origin.current = null
  }

  const present = new Set((draft ?? saved).map((c) => c.cardId))
  const ordered = [...cards].sort(readingOrder)
  const draggedOrigin = drag ? draft?.find((c) => c.id === drag.id) : undefined

  return (
    <div className="space-y-3" data-board={kind}>
      <div className="flex min-h-8 items-center justify-end gap-2">
        {editing ? (
          <>
            <p className="mr-auto text-sm text-muted-foreground">
              {wide ? m.board_editing_hint() : m.board_editing_hint_narrow()}
            </p>
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              <Plus aria-hidden />
              {m.board_add_card()}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="icon-sm" aria-label={m.board_default_menu()} />
                }
              >
                <MoreHorizontal aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuItem onClick={() => void saveAsDefault()}>
                  <LayoutTemplate aria-hidden />
                  {m.board_default_save()}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void restoreDefault()}>
                  {m.board_default_restore()}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void resetDefault()}>
                  {m.board_default_reset()}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" onClick={finishEditing}>
              <Check aria-hidden />
              {m.board_done()}
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={startEditing}
            title={`${m.board_edit()} (${formatHotkey('e')})`}
            data-tour="board-edit"
          >
            <Pencil aria-hidden />
            {m.board_edit()}
          </Button>
        )}
      </div>

      {cards.length === 0 && !editing ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{m.board_empty_title()}</EmptyTitle>
            <EmptyDescription>{m.board_empty_description()}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={startEditing}>
              <Pencil aria-hidden />
              {m.board_edit()}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
          accessibility={{
            screenReaderInstructions: { draggable: m.board_drag_instructions() },
          }}
        >
          <div
            ref={gridRef}
            className={cn(
              'grid auto-rows-[10rem] grid-flow-row-dense grid-cols-1 gap-4 md:grid-cols-2 lg:grid-flow-row lg:grid-cols-4',
              editing && 'rounded-2xl outline-2 outline-offset-8 outline-border outline-dashed',
            )}
            style={
              editing && wide ? { minHeight: `${(rows(cards) + 1) * (ROW + GAP)}px` } : undefined
            }
          >
            {ordered.map((card) => {
              const contribution = known.get(card.cardId)
              if (!contribution) return null
              // The dragged card stays in its original cell and follows the pointer from there.
              const at = drag?.id === card.id && draggedOrigin ? draggedOrigin : card
              const { className, style } = placement(at)
              return (
                <CardFrame
                  key={card.id}
                  scope={scope}
                  card={card}
                  contribution={contribution}
                  editing={editing}
                  movable={wide}
                  className={className}
                  style={style}
                  onResize={(size) => update((current) => resizeItem(current, card.id, size))}
                  onRemove={() => update((current) => current.filter((c) => c.id !== card.id))}
                  onDraftSettings={(settings) =>
                    setDraft(
                      (current) =>
                        current?.map((c) => (c.id === card.id ? { ...c, settings } : c)) ?? current,
                    )
                  }
                />
              )
            })}
            {drag
              ? (() => {
                  const target = drag.preview.find((c) => c.id === drag.id)
                  if (!target) return null
                  const { className, style } = placement(target)
                  return (
                    <div
                      aria-hidden
                      className={cn(
                        'rounded-2xl border-2 border-dashed border-primary/50 bg-primary/5',
                        className,
                      )}
                      style={style}
                    />
                  )
                })()
              : null}
          </div>
        </DndContext>
      )}
      <AddCardDialog
        kind={kind}
        present={present}
        open={adding}
        onOpenChange={setAdding}
        onAdd={addCard}
      />
    </div>
  )
}

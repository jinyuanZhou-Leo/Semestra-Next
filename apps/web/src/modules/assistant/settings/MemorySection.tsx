import type { MemoryOut } from '@semestra/api-client'
import {
  agentMemoryClearMutation,
  agentMemoryDeleteMutation,
  agentMemoryListOptions,
  agentMemoryUpdateMutation,
} from '@semestra/api-client/react-query'
import { type CellContext, createColumnHelper } from '@tanstack/react-table'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bookmark, Tag, Trash2 } from 'lucide-react'
import { createContext, use, useState } from 'react'
import { invalidateOperations } from '@/app/api'
import {
  DangerZone,
  RowMenu,
  SettingRow,
  SettingsTable,
  settingsTableFeatures,
} from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Input } from '@/ui/input'
import { MEMORY_QUERIES } from '../memory'

type Category = MemoryOut['category']

const CATEGORIES: Category[] = ['preference', 'goal', 'constraint', 'context']

export const CATEGORY_LABELS: Record<Category, () => string> = {
  preference: m.assistant_memory_category_preference,
  goal: m.assistant_memory_category_goal,
  constraint: m.assistant_memory_category_constraint,
  context: m.assistant_memory_category_context,
}

type Patch = { content?: string; category?: Category }

type RowHandlers = {
  patch: (memory: MemoryOut, body: Patch) => void
  onDelete: (memory: MemoryOut) => void
}

const RowContext = createContext<RowHandlers | null>(null)

function useRowHandlers(): RowHandlers {
  const handlers = use(RowContext)
  if (!handlers) throw new Error('Memory cells render inside the memory table')
  return handlers
}

type CellProps = CellContext<typeof settingsTableFeatures, MemoryOut>

function ContentCell({ row }: CellProps) {
  const { patch } = useRowHandlers()
  const memory = row.original
  return (
    <div className="space-y-1 py-1">
      <Input
        key={`${memory.id}-${memory.content}`}
        aria-label={m.assistant_memory_content()}
        defaultValue={memory.content}
        maxLength={200}
        className="h-8 w-full"
        onBlur={(e) => {
          const value = e.target.value.trim()
          if (value && value !== memory.content) patch(memory, { content: value })
        }}
      />
      <p className="px-0.5 text-xs text-muted-foreground">{CATEGORY_LABELS[memory.category]()}</p>
    </div>
  )
}

function ActionsCell({ row }: CellProps) {
  const { patch, onDelete } = useRowHandlers()
  const memory = row.original
  return (
    <RowMenu label={m.assistant_memory_actions()}>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <Tag aria-hidden />
          {m.assistant_memory_category()}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup
            value={memory.category}
            onValueChange={(next: string) => patch(memory, { category: next as Category })}
          >
            {CATEGORIES.map((category) => (
              <DropdownMenuRadioItem key={category} value={category}>
                {CATEGORY_LABELS[category]()}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onClick={() => onDelete(memory)}>
        <Trash2 aria-hidden />
        {m.common_delete()}
      </DropdownMenuItem>
    </RowMenu>
  )
}

const column = createColumnHelper<typeof settingsTableFeatures, MemoryOut>()
const columns = column.columns([
  column.accessor((r) => r.content, {
    id: 'content',
    header: () => m.assistant_memory_content(),
    cell: ContentCell,
  }),
  column.display({
    id: 'actions',
    header: () => <span className="sr-only">{m.assistant_memory_actions()}</span>,
    cell: ActionsCell,
  }),
])

const COLUMN_CLASS: Record<string, string> = { content: 'w-full max-w-0', actions: 'w-10' }

/** Account settings → AI → Memory: what Sem remembers about the user, editable (M12 记忆). */
export function MemorySection() {
  const memories = useQuery(agentMemoryListOptions())
  return (
    <AsyncBoundary query={memories}>
      {(list) =>
        list.items.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Bookmark aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{m.assistant_memory_empty()}</EmptyTitle>
              <EmptyDescription>{m.assistant_memory_empty_description()}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <MemoryTable items={list.items} />
        )
      }
    </AsyncBoundary>
  )
}

function MemoryTable({ items }: { items: MemoryOut[] }) {
  const queryClient = useQueryClient()
  const refresh = () => invalidateOperations(queryClient, MEMORY_QUERIES)
  const [deleting, setDeleting] = useState<MemoryOut | null>(null)
  const update = useMutation({
    ...agentMemoryUpdateMutation(),
    onError: toastError,
    onSettled: refresh,
  })
  const remove = useMutation({
    ...agentMemoryDeleteMutation(),
    onError: toastError,
    onSettled: async () => {
      setDeleting(null)
      await refresh()
    },
  })
  const handlers: RowHandlers = {
    patch: (memory, body) => update.mutate({ path: { id: memory.id }, body }),
    onDelete: setDeleting,
  }
  return (
    <>
      <RowContext value={handlers}>
        <SettingsTable
          label={m.assistant_settings_memories()}
          data={items}
          columns={columns}
          getRowId={(r) => r.id}
          columnClassName={COLUMN_CLASS}
        />
      </RowContext>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={m.assistant_memory_delete()}
        description={deleting?.content ?? ''}
        confirmLabel={m.common_delete()}
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate({ path: { id: deleting.id } })}
      />
    </>
  )
}

/** The last section of the Memory page: forget everything at once. */
export function ClearMemoriesSection() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const clear = useMutation({
    ...agentMemoryClearMutation(),
    onError: toastError,
    onSettled: async () => {
      setOpen(false)
      await invalidateOperations(queryClient, MEMORY_QUERIES)
    },
  })
  return (
    <>
      <DangerZone>
        <SettingRow
          label={m.assistant_memory_clear()}
          description={m.assistant_memory_clear_description()}
        >
          <Button variant="destructive" onClick={() => setOpen(true)}>
            {m.assistant_memory_clear()}
          </Button>
        </SettingRow>
      </DangerZone>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={m.assistant_memory_clear_confirm_title()}
        description={m.assistant_memory_clear_description()}
        confirmLabel={m.assistant_memory_clear()}
        pending={clear.isPending}
        onConfirm={() => clear.mutate({})}
      />
    </>
  )
}

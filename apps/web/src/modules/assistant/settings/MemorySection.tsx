import type { MemoryOut } from '@semestra/api-client'
import {
  agentMemoryClearMutation,
  agentMemoryDeleteMutation,
  agentMemoryListOptions,
  agentMemoryUpdateMutation,
} from '@semestra/api-client/react-query'
import { type CellContext, createColumnHelper } from '@tanstack/react-table'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bookmark, Pencil, Tag, Trash2 } from 'lucide-react'
import { createContext, type FormEvent, use, useId, useState } from 'react'
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
import { errorMessage, toastError } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog'
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
import { Field, FieldDescription, FieldError, FieldLabel, FieldSet } from '@/ui/field'
import { Input } from '@/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select'
import { Textarea } from '@/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { MEMORY_QUERIES } from '../memory'

type MemoryType = MemoryOut['type']

const TYPES: MemoryType[] = ['user', 'feedback', 'project', 'reference']

export const TYPE_LABELS: Record<MemoryType, () => string> = {
  user: m.assistant_memory_type_user,
  feedback: m.assistant_memory_type_feedback,
  project: m.assistant_memory_type_project,
  reference: m.assistant_memory_type_reference,
}

const TYPE_HINTS: Record<MemoryType, () => string> = {
  user: m.assistant_memory_type_user_description,
  feedback: m.assistant_memory_type_feedback_description,
  project: m.assistant_memory_type_project_description,
  reference: m.assistant_memory_type_reference_description,
}

// The same limits and name rule as the server (`agent/memory.py`).
const MAX_NAME = 64
const MAX_DESCRIPTION = 150
const MAX_BODY = 2000
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const LINK = /\[\[([a-z0-9]+(?:-[a-z0-9]+)*)\]\]/g

/** The memories `text` refers to with `[[name]]`, once each, in order. */
function linkedNames(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(LINK), (match) => match[1] ?? ''))]
}

/** A body as one line of plain text for the list: no Markdown emphasis or link brackets. */
function plain(text: string): string {
  return text.replace(/\*\*|\[\[|\]\]/g, '')
}

type Patch = { name?: string; type?: MemoryType; description?: string; body?: string }

type RowHandlers = {
  patch: (memory: MemoryOut, body: Patch) => void
  onEdit: (memory: MemoryOut) => void
  onDelete: (memory: MemoryOut) => void
}

const RowContext = createContext<RowHandlers | null>(null)

function useRowHandlers(): RowHandlers {
  const handlers = use(RowContext)
  if (!handlers) throw new Error('Memory cells render inside the memory table')
  return handlers
}

type CellProps = CellContext<typeof settingsTableFeatures, MemoryOut>

function MemoryCell({ row }: CellProps) {
  const { onEdit } = useRowHandlers()
  const memory = row.original
  const details = [TYPE_LABELS[memory.type](), formatDate(memory.updated_at)]
  return (
    <button
      type="button"
      className="block w-full min-w-0 rounded-md py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => onEdit(memory)}
    >
      <span className="block truncate">{memory.description}</span>
      <span className="block truncate text-xs text-muted-foreground">
        {memory.body ? [...details, plain(memory.body)].join(' · ') : details.join(' · ')}
      </span>
    </button>
  )
}

function ActionsCell({ row }: CellProps) {
  const { patch, onEdit, onDelete } = useRowHandlers()
  const memory = row.original
  return (
    <RowMenu label={m.assistant_memory_actions()}>
      <DropdownMenuItem onClick={() => onEdit(memory)}>
        <Pencil aria-hidden />
        {m.assistant_memory_edit()}
      </DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <Tag aria-hidden />
          {m.assistant_memory_type()}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup
            value={memory.type}
            onValueChange={(next: string) => patch(memory, { type: next as MemoryType })}
          >
            {TYPES.map((type) => (
              <DropdownMenuRadioItem key={type} value={type}>
                {TYPE_LABELS[type]()}
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
  column.accessor((r) => r.description, {
    id: 'memory',
    header: () => m.assistant_memory_content(),
    cell: MemoryCell,
  }),
  column.display({
    id: 'actions',
    header: () => <span className="sr-only">{m.assistant_memory_actions()}</span>,
    cell: ActionsCell,
  }),
])

const COLUMN_CLASS: Record<string, string> = { memory: 'w-full max-w-0', actions: 'w-10' }

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
  const [editing, setEditing] = useState<string | null>(null)
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
    onEdit: (memory) => setEditing(memory.id),
    onDelete: setDeleting,
  }
  const open = items.find((memory) => memory.id === editing) ?? null
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
      <Dialog open={open !== null} onOpenChange={(next) => !next && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{m.assistant_memory_edit()}</DialogTitle>
            <DialogDescription>{m.assistant_memory_edit_description()}</DialogDescription>
          </DialogHeader>
          {open ? (
            <MemoryForm
              key={open.id}
              memory={open}
              memories={items}
              onOpen={(memory) => setEditing(memory.id)}
              onSaved={() => setEditing(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={m.assistant_memory_delete()}
        description={deleting?.description ?? ''}
        confirmLabel={m.common_delete()}
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate({ path: { id: deleting.id } })}
      />
    </>
  )
}

/** One memory's fields; `[[name]]` links in the details open the memory they name. */
function MemoryForm({
  memory,
  memories,
  onOpen,
  onSaved,
}: {
  memory: MemoryOut
  memories: MemoryOut[]
  onOpen: (memory: MemoryOut) => void
  onSaved: () => void
}) {
  const ids = { summary: useId(), type: useId(), details: useId(), name: useId() }
  const [description, setDescription] = useState(memory.description)
  const [type, setType] = useState<MemoryType>(memory.type)
  const [body, setBody] = useState(memory.body)
  const [name, setName] = useState(memory.name)
  const queryClient = useQueryClient()
  const save = useMutation({
    ...agentMemoryUpdateMutation(),
    onSuccess: onSaved,
    onSettled: () => invalidateOperations(queryClient, MEMORY_QUERIES),
  })
  const byName = new Map(memories.map((other) => [other.name, other]))
  const links = linkedNames(body).filter((linked) => linked !== memory.name)
  const nameValid = NAME.test(name.trim())
  const changes: Patch = {
    ...(description.trim() !== memory.description ? { description: description.trim() } : {}),
    ...(type !== memory.type ? { type } : {}),
    ...(body.trim() !== memory.body ? { body: body.trim() } : {}),
    ...(name.trim() !== memory.name ? { name: name.trim() } : {}),
  }
  const canSave = description.trim() !== '' && nameValid && Object.keys(changes).length > 0
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (canSave) save.mutate({ path: { id: memory.id }, body: changes })
  }
  const typeItems = TYPES.map((value) => ({ value, label: TYPE_LABELS[value]() }))
  return (
    <form onSubmit={submit} noValidate>
      <FieldSet disabled={save.isPending} className="gap-4">
        <Field>
          <FieldLabel htmlFor={ids.summary}>{m.assistant_memory_summary()}</FieldLabel>
          <Input
            id={ids.summary}
            value={description}
            maxLength={MAX_DESCRIPTION}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel id={ids.type}>{m.assistant_memory_type()}</FieldLabel>
          <Select
            value={type}
            items={typeItems}
            onValueChange={(next) => next && setType(next as MemoryType)}
          >
            <SelectTrigger aria-labelledby={ids.type} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {TYPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    <span className="flex flex-col gap-0.5 whitespace-normal">
                      {TYPE_LABELS[value]()}
                      <span className="text-xs font-normal text-muted-foreground">
                        {TYPE_HINTS[value]()}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor={ids.details}>{m.assistant_memory_details()}</FieldLabel>
          <Textarea
            id={ids.details}
            value={body}
            rows={5}
            maxLength={MAX_BODY}
            placeholder={m.assistant_memory_details_placeholder()}
            className="max-h-64"
            onChange={(e) => setBody(e.target.value)}
          />
          {links.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">{m.assistant_memory_links()}</span>
              {links.map((linked) => {
                const target = byName.get(linked)
                return target ? (
                  <Button
                    key={linked}
                    type="button"
                    variant="secondary"
                    size="xs"
                    className="max-w-56"
                    onClick={() => onOpen(target)}
                  >
                    <span className="truncate">{target.description}</span>
                  </Button>
                ) : (
                  <Tooltip key={linked}>
                    <TooltipTrigger
                      render={
                        <Badge tabIndex={0} variant="outline" className="text-muted-foreground">
                          {linked}
                        </Badge>
                      }
                    />
                    <TooltipContent>
                      {m.assistant_memory_link_missing({ name: linked })}
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          ) : null}
        </Field>
        <Field data-invalid={!nameValid || undefined}>
          <FieldLabel htmlFor={ids.name}>{m.assistant_memory_name()}</FieldLabel>
          <Input
            id={ids.name}
            value={name}
            maxLength={MAX_NAME}
            aria-invalid={!nameValid || undefined}
            className="font-mono text-xs"
            onChange={(e) => setName(e.target.value)}
          />
          {nameValid ? (
            <FieldDescription>{m.assistant_memory_name_description()}</FieldDescription>
          ) : (
            <FieldError>{m.assistant_memory_name_invalid()}</FieldError>
          )}
        </Field>
        <FieldError>{save.error ? errorMessage(save.error) : null}</FieldError>
        <DialogFooter>
          <Button type="submit" disabled={!canSave}>
            {save.isPending ? m.common_saving() : m.common_save()}
          </Button>
        </DialogFooter>
      </FieldSet>
    </form>
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

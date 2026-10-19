import type { EventType } from '@semestra/api-client'
import {
  scheduleEventTypeCreateMutation,
  scheduleEventTypeDeleteMutation,
  scheduleEventTypeReorderMutation,
  scheduleEventTypeUpdateMutation,
} from '@semestra/api-client/react-query'
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import type { SettingsSectionProps } from '@/app/extensions'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toastError } from '@/lib/errors'
import { subjectColor } from '@/lib/subject-color'
import { type ColorRef, ColorPicker } from '@/modules/academics/components/ColorPicker'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select'
import { TYPE_ICONS } from '../icons'
import { typeName } from '../labels'
import { invalidateSchedule, useEventTypes } from '../queries'

const NO_ICON = '__none__'

function toRef(color: string | null): ColorRef | null {
  const slot = /^subject-(\d+)$/.exec(color ?? '')
  if (slot) return { palette: Number(slot[1]) } as ColorRef
  return color ? ({ hex: color } as ColorRef) : null
}

function fromRef(ref: ColorRef | null): string | null {
  if (!ref) return null
  return 'palette' in ref ? `subject-${ref.palette}` : ref.hex
}

const features = tableFeatures({})
const column = createColumnHelper<typeof features, EventType>()

/**
 * The Program's event types (M04 §5.6): code, name, color, icon and order. Built-in types keep
 * their code and name (shown in the user's language) and cannot be deleted.
 */
export function EventTypesSection({ scope }: SettingsSectionProps) {
  const programId = scope?.programId ?? ''
  const types = useEventTypes(programId)
  return (
    <AsyncBoundary query={types}>
      {(list) => <EventTypesTable programId={programId} types={list.items} />}
    </AsyncBoundary>
  )
}

function EventTypesTable({ programId, types }: { programId: string; types: EventType[] }) {
  const queryClient = useQueryClient()
  const refresh = () => invalidateSchedule(queryClient)
  const update = useMutation({
    ...scheduleEventTypeUpdateMutation(),
    onError: toastError,
    onSettled: refresh,
  })
  const reorder = useMutation({
    ...scheduleEventTypeReorderMutation(),
    onError: toastError,
    onSettled: refresh,
  })
  const remove = useMutation({
    ...scheduleEventTypeDeleteMutation(),
    onError: toastError,
    onSettled: async () => {
      setDeleting(null)
      await refresh()
    },
  })
  const create = useMutation({
    ...scheduleEventTypeCreateMutation(),
    onError: toastError,
    onSuccess: async () => {
      setCode('')
      setName('')
      await refresh()
    },
  })
  const [deleting, setDeleting] = useState<EventType | null>(null)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')

  const move = (index: number, delta: number) => {
    const ids = types.map((t) => t.id)
    const [id] = ids.splice(index, 1)
    if (!id) return
    ids.splice(index + delta, 0, id)
    reorder.mutate({ path: { program_id: programId }, body: { event_type_ids: ids } })
  }
  const patch = (
    type: EventType,
    body: { name?: string; color?: string | null; icon?: string | null },
  ) => update.mutate({ path: { event_type_id: type.id }, body })

  const columns = column.columns([
    column.accessor((t) => t.code, {
      id: 'code',
      header: () => m.schedule_type_code(),
      cell: ({ row }) => <span className="font-medium">{row.original.code}</span>,
    }),
    column.accessor((t) => t.name, {
      id: 'name',
      header: () => m.schedule_type_name(),
      cell: ({ row }) =>
        row.original.builtin ? (
          typeName(row.original)
        ) : (
          <Input
            aria-label={m.schedule_type_name()}
            defaultValue={row.original.name}
            className="h-8 w-44"
            onBlur={(e) => {
              const value = e.target.value.trim()
              if (value && value !== row.original.name) patch(row.original, { name: value })
            }}
          />
        ),
    }),
    column.display({
      id: 'color',
      header: () => m.schedule_type_color(),
      cell: ({ row }) => (
        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={m.schedule_type_color_of({ code: row.original.code })}
              />
            }
          >
            <span
              aria-hidden
              className="size-4 rounded-full border border-border"
              style={{
                backgroundColor: row.original.color
                  ? subjectColor(row.original.color)
                  : 'transparent',
              }}
            />
          </PopoverTrigger>
          <PopoverContent className="w-72">
            <ColorPicker
              label={m.schedule_type_color_of({ code: row.original.code })}
              inheritLabel={m.schedule_type_color_course()}
              value={toRef(row.original.color)}
              onChange={(ref) => patch(row.original, { color: fromRef(ref) })}
            />
          </PopoverContent>
        </Popover>
      ),
    }),
    column.display({
      id: 'icon',
      header: () => m.schedule_type_icon(),
      cell: ({ row }) => {
        const iconItems = [
          { value: NO_ICON, label: m.schedule_type_no_icon() },
          ...Object.entries(TYPE_ICONS).map(([key, Icon]) => ({
            value: key,
            label: (
              <span className="flex items-center gap-2">
                <Icon aria-hidden className="size-4" />
                {key}
              </span>
            ),
          })),
        ]
        return (
          <Select
            value={row.original.icon ?? NO_ICON}
            items={iconItems}
            onValueChange={(next) =>
              next && patch(row.original, { icon: next === NO_ICON ? null : next })
            }
          >
            <SelectTrigger aria-label={m.schedule_type_icon()} className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {iconItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )
      },
    }),
    column.display({
      id: 'actions',
      header: () => <span className="sr-only">{m.schedule_actions()}</span>,
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={m.schedule_move_up()}
            disabled={row.index === 0 || reorder.isPending}
            onClick={() => move(row.index, -1)}
          >
            <ArrowUp aria-hidden />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={m.schedule_move_down()}
            disabled={row.index === types.length - 1 || reorder.isPending}
            onClick={() => move(row.index, 1)}
          >
            <ArrowDown aria-hidden />
          </Button>
          {row.original.builtin ? null : (
            <Button
              size="icon-xs"
              variant="destructive"
              aria-label={m.schedule_type_delete({ code: row.original.code })}
              onClick={() => setDeleting(row.original)}
            >
              <Trash2 aria-hidden />
            </Button>
          )}
        </div>
      ),
    }),
  ])
  const table = useTable({ features, columns, data: types, getRowId: (t) => t.id })

  const codeValid = /^[A-Z0-9]{1,8}$/.test(code)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!codeValid || !name.trim()) return
    create.mutate({ path: { program_id: programId }, body: { code, name: name.trim() } })
  }

  return (
    <>
      <div className="overflow-hidden rounded-2xl border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((h) => (
                  <TableHead key={h.id} scope="col">
                    <table.FlexRender header={h} />
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <form onSubmit={submit} className="flex flex-wrap items-center gap-2 border-t p-3">
          <Input
            aria-label={m.schedule_type_code()}
            placeholder="SEM"
            className="w-24"
            value={code}
            onChange={(e) =>
              setCode(
                e.target.value
                  .toUpperCase()
                  .replaceAll(/[^A-Z0-9]/g, '')
                  .slice(0, 8),
              )
            }
          />
          <Input
            aria-label={m.schedule_type_name()}
            placeholder={m.schedule_type_name_placeholder()}
            className="w-48"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={!codeValid || !name.trim() || create.isPending}
          >
            <Plus aria-hidden />
            {m.schedule_type_add()}
          </Button>
        </form>
      </div>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={m.schedule_type_delete({ code: deleting?.code ?? '' })}
        description={m.schedule_type_delete_description()}
        confirmLabel={m.schedule_type_delete_confirm()}
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate({ path: { event_type_id: deleting.id } })}
      />
    </>
  )
}

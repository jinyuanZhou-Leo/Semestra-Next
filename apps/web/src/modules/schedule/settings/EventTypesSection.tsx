import type { EventType } from '@semestra/api-client'
import {
  scheduleEventTypeCreateMutation,
  scheduleEventTypeDeleteMutation,
  scheduleEventTypeReorderMutation,
  scheduleEventTypeUpdateMutation,
} from '@semestra/api-client/react-query'
import { type CellContext, createColumnHelper } from '@tanstack/react-table'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Ban, Plus, Shapes, Trash2 } from 'lucide-react'
import { createContext, type FormEvent, use, useId, useState } from 'react'
import type { SettingsSectionProps } from '@/app/extensions'
import {
  MoveMenuItems,
  SectionAction,
  RowMenu,
  SettingsTable,
  settingsTableFeatures,
} from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toastError } from '@/lib/errors'
import { subjectColor } from '@/lib/subject-color'
import { ColorDotPicker } from '@/modules/academics/components/ColorDotPicker'
import type { ColorRef } from '@/modules/academics/components/ColorPicker'
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
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import { TYPE_ICON_LABELS, TYPE_ICONS } from '../icons'
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

type Patch = { name?: string; color?: string | null; icon?: string | null }

type RowHandlers = {
  patch: (type: EventType, body: Patch) => void
  onDelete: (type: EventType) => void
}

const RowContext = createContext<RowHandlers | null>(null)

function useRowHandlers(): RowHandlers {
  const handlers = use(RowContext)
  if (!handlers) throw new Error('Event type cells render inside the event types table')
  return handlers
}

type CellProps = CellContext<typeof settingsTableFeatures, EventType>

function ColorCell({ row }: CellProps) {
  const { patch } = useRowHandlers()
  const type = row.original
  return (
    <ColorDotPicker
      label={m.schedule_type_color_of({ code: type.code })}
      color={type.color ? subjectColor(type.color) : null}
      inheritLabel={m.schedule_type_color_course()}
      value={toRef(type.color)}
      onChange={(ref) => patch(type, { color: fromRef(ref) })}
    />
  )
}

function CodeCell({ row }: CellProps) {
  const type = row.original
  const Icon = type.icon ? TYPE_ICONS[type.icon] : undefined
  return (
    <span className="flex items-center gap-2 font-medium whitespace-nowrap">
      {Icon ? <Icon aria-hidden className="size-4 text-muted-foreground" /> : null}
      {type.code}
    </span>
  )
}

function NameCell({ row }: CellProps) {
  const { patch } = useRowHandlers()
  const type = row.original
  if (type.builtin) return <span className="block truncate">{typeName(type)}</span>
  return (
    <Input
      key={`${type.id}-${type.name}`}
      aria-label={`${m.schedule_type_name()}: ${type.code}`}
      defaultValue={type.name}
      maxLength={60}
      className="h-8 w-full"
      onBlur={(e) => {
        const value = e.target.value.trim()
        if (value && value !== type.name) patch(type, { name: value })
      }}
    />
  )
}

function ActionsCell({ row }: CellProps) {
  const { patch, onDelete } = useRowHandlers()
  const type = row.original
  return (
    <RowMenu label={m.schedule_type_actions({ code: type.code })}>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <Shapes aria-hidden />
          {m.schedule_type_icon()}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup
            value={type.icon ?? NO_ICON}
            onValueChange={(next: string) => patch(type, { icon: next === NO_ICON ? null : next })}
          >
            <DropdownMenuRadioItem value={NO_ICON}>
              <Ban aria-hidden />
              {m.schedule_type_no_icon()}
            </DropdownMenuRadioItem>
            {Object.entries(TYPE_ICONS).map(([key, Icon]) => (
              <DropdownMenuRadioItem key={key} value={key}>
                <Icon aria-hidden />
                {TYPE_ICON_LABELS[key]?.() ?? key}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <MoveMenuItems id={type.id} />
      {type.builtin ? null : (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => onDelete(type)}>
            <Trash2 aria-hidden />
            {m.common_delete()}
          </DropdownMenuItem>
        </>
      )}
    </RowMenu>
  )
}

const column = createColumnHelper<typeof settingsTableFeatures, EventType>()
const columns = column.columns([
  column.display({
    id: 'color',
    header: () => m.schedule_type_color(),
    cell: ColorCell,
  }),
  column.accessor((t) => t.code, {
    id: 'code',
    header: () => m.schedule_type_code(),
    cell: CodeCell,
  }),
  column.accessor((t) => t.name, {
    id: 'name',
    header: () => m.schedule_type_name(),
    cell: NameCell,
  }),
  column.display({
    id: 'actions',
    header: () => <span className="sr-only">{m.schedule_actions()}</span>,
    cell: ActionsCell,
  }),
])

const COLUMN_CLASS: Record<string, string> = {
  color: 'w-20',
  code: 'w-28',
  name: 'w-full max-w-0',
  actions: 'w-10',
}

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
  const [deleting, setDeleting] = useState<EventType | null>(null)
  const [adding, setAdding] = useState(false)
  const handlers: RowHandlers = {
    patch: (type, body) => update.mutate({ path: { event_type_id: type.id }, body }),
    onDelete: setDeleting,
  }

  return (
    <>
      <SectionAction>
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          <Plus aria-hidden />
          {m.schedule_type_add()}
        </Button>
      </SectionAction>
      <RowContext value={handlers}>
        <SettingsTable
          label={m.schedule_settings_event_types()}
          data={types}
          columns={columns}
          getRowId={(t) => t.id}
          columnClassName={COLUMN_CLASS}
          onReorder={(ids) =>
            reorder.mutateAsync({
              path: { program_id: programId },
              body: { event_type_ids: ids },
            })
          }
          rowName={(t) => t.code}
        />
      </RowContext>
      <AddEventTypeDialog programId={programId} open={adding} onOpenChange={setAdding} />
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

/** A new event type: its code and name; color and icon are set in the table afterwards. */
function AddEventTypeDialog({
  programId,
  open,
  onOpenChange,
}: {
  programId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const fid = useId()
  const queryClient = useQueryClient()
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [touched, setTouched] = useState(false)
  const create = useMutation({
    ...scheduleEventTypeCreateMutation(),
    onError: toastError,
    onSuccess: async () => {
      await invalidateSchedule(queryClient)
      onOpenChange(false)
    },
  })
  const codeValid = /^[A-Z0-9]{1,8}$/.test(code)
  const nameValid = name.trim() !== ''
  const reset = (next: boolean) => {
    if (create.isPending) return
    if (next) {
      setCode('')
      setName('')
      setTouched(false)
    }
    onOpenChange(next)
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (!codeValid || !nameValid) return
    create.mutate({ path: { program_id: programId }, body: { code, name: name.trim() } })
  }
  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{m.schedule_type_add()}</DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="flex flex-col gap-6">
          <FieldGroup>
            <Field data-invalid={(touched && !codeValid) || undefined}>
              <FieldLabel htmlFor={`${fid}-code`}>{m.schedule_type_code()}</FieldLabel>
              <Input
                id={`${fid}-code`}
                placeholder="SEM"
                className="max-w-32"
                value={code}
                aria-invalid={(touched && !codeValid) || undefined}
                onChange={(e) =>
                  setCode(
                    e.target.value
                      .toUpperCase()
                      .replaceAll(/[^A-Z0-9]/g, '')
                      .slice(0, 8),
                  )
                }
              />
              {touched && !codeValid ? <FieldError>{m.common_required()}</FieldError> : null}
            </Field>
            <Field data-invalid={(touched && !nameValid) || undefined}>
              <FieldLabel htmlFor={`${fid}-name`}>{m.schedule_type_name()}</FieldLabel>
              <Input
                id={`${fid}-name`}
                placeholder={m.schedule_type_name_placeholder()}
                value={name}
                maxLength={60}
                aria-invalid={(touched && !nameValid) || undefined}
                onChange={(e) => setName(e.target.value)}
              />
              {touched && !nameValid ? <FieldError>{m.common_required()}</FieldError> : null}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose
              render={<Button type="button" variant="outline" disabled={create.isPending} />}
            >
              {m.common_cancel()}
            </DialogClose>
            <Button type="submit" disabled={create.isPending}>
              {m.schedule_type_add()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

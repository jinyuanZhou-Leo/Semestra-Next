import type { ImportItem } from '@semestra/api-client'
import { importsItemUpdateMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleAlert } from 'lucide-react'
import { useId, useState } from 'react'
import { toastError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { weekdayName } from '@/modules/schedule/time'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Field, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import { NativeSelect, NativeSelectOption } from '@/ui/native-select'
import { Switch } from '@/ui/switch'
import { FIELDS, type FieldSpec, PATCH_LABELS } from '../fields'
import { issueText, itemTitle, TYPE_LABELS } from '../labels'
import { storeSession } from '../queries'
import type { CoursePatchData, FieldChange } from '../types'
import { ConfidenceDot, EvidenceButton } from './Evidence'

type Values = Record<string, unknown>

/** The selected item of the review (M08 §6.2 right side): its issues and its fields. */
export function ItemEditor({ item, editable }: { item: ImportItem; editable: boolean }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-muted-foreground">{TYPE_LABELS[item.type]()}</p>
        <h3 className="font-heading text-base font-medium">{itemTitle(item)}</h3>
      </div>
      {item.result?.error_code ? (
        <p className="flex gap-2 text-sm text-destructive">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {m.imports_item_failed({
            reason: issueText({
              code: item.result.error_code,
              params: item.result.error_params ?? {},
            }),
          })}
        </p>
      ) : null}
      {item.issues.length > 0 ? (
        <ul className="space-y-1 text-sm text-destructive">
          {item.issues.map((issue) => (
            <li key={issue.code} className="flex gap-2">
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {issueText(issue)}
            </li>
          ))}
        </ul>
      ) : null}
      {item.type === 'course_patch' ? (
        <PatchEditor item={item} editable={editable} />
      ) : (
        <FieldsEditor key={item.id} item={item} editable={editable} />
      )}
    </div>
  )
}

function FieldsEditor({ item, editable }: { item: ImportItem; editable: boolean }) {
  const queryClient = useQueryClient()
  const save = useMutation({
    ...importsItemUpdateMutation(),
    onError: toastError,
    onSuccess: (session) => storeSession(queryClient, session),
  })
  const specs = FIELDS[item.type as keyof typeof FIELDS]
  const [values, setValues] = useState<Values>(() => pick(item.data, specs))
  const changed = specs.filter((spec) => !same(values[spec.key], item.data[spec.key]))

  const submit = () => {
    const data: Values = {}
    for (const spec of changed) data[spec.key] = values[spec.key] ?? null
    save.mutate({ path: { session_id: item.session_id, item_id: item.id }, body: { data } })
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (changed.length > 0) submit()
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        {specs.map((spec) => (
          <FieldInput
            key={spec.key}
            spec={spec}
            item={item}
            value={values[spec.key]}
            disabled={!editable}
            onChange={(value) => setValues((current) => ({ ...current, [spec.key]: value }))}
          />
        ))}
      </div>
      {editable ? (
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={changed.length === 0}
            onClick={() => setValues(pick(item.data, specs))}
          >
            {m.imports_edit_reset()}
          </Button>
          <Button type="submit" size="sm" disabled={changed.length === 0 || save.isPending}>
            {m.imports_edit_save()}
          </Button>
        </div>
      ) : null}
    </form>
  )
}

function FieldInput({
  spec,
  item,
  value,
  disabled,
  onChange,
}: {
  spec: FieldSpec
  item: ImportItem
  value: unknown
  disabled: boolean
  onChange: (value: unknown) => void
}) {
  const id = useId()
  const label = spec.label()
  const head = (
    <div className="flex items-center gap-1.5">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <ConfidenceDot confidence={item.confidence[spec.key]} />
      <EvidenceButton evidence={item.evidence[spec.key]} field={label} />
    </div>
  )
  const text = value == null ? '' : String(value)
  let control
  switch (spec.kind) {
    case 'switch': {
      // `planned_terms` is shown as "year-long"; other switches are booleans.
      const on = spec.key === 'planned_terms' ? Number(value ?? 1) > 1 : Boolean(value)
      control = (
        <Switch
          id={id}
          checked={on}
          disabled={disabled}
          onCheckedChange={(next) => onChange(spec.key === 'planned_terms' ? (next ? 2 : 1) : next)}
        />
      )
      break
    }
    case 'weekday':
      control = (
        <NativeSelect
          id={id}
          value={text}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
        >
          {[1, 2, 3, 4, 5, 6, 7].map((day) => (
            <NativeSelectOption key={day} value={String(day)}>
              {weekdayName(day)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )
      break
    case 'recurrence':
      control = (
        <NativeSelect
          id={id}
          value={text || 'weekly'}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          <NativeSelectOption value="weekly">{m.imports_recurrence_weekly()}</NativeSelectOption>
          <NativeSelectOption value="biweekly">
            {m.imports_recurrence_biweekly()}
          </NativeSelectOption>
        </NativeSelect>
      )
      break
    default:
      control = (
        <Input
          id={id}
          type={spec.kind}
          step={spec.kind === 'number' ? 'any' : undefined}
          value={spec.kind === 'time' ? text.slice(0, 5) : text}
          disabled={disabled}
          aria-invalid={spec.key === 'title' && !text.trim() ? true : undefined}
          onChange={(e) => {
            const raw = e.target.value
            if (raw === '') onChange(null)
            else onChange(spec.kind === 'number' ? Number(raw) : raw)
          }}
        />
      )
  }
  return (
    <Field className={cn(spec.wide && 'col-span-2')}>
      {head}
      {control}
    </Field>
  )
}

/**
 * A change to an existing course: old → new per field, each one can be left out
 * (`changes[field].apply`, M08 §6.2).
 */
function PatchEditor({ item, editable }: { item: ImportItem; editable: boolean }) {
  const queryClient = useQueryClient()
  const save = useMutation({
    ...importsItemUpdateMutation(),
    onError: toastError,
    onSuccess: (session) => storeSession(queryClient, session),
  })
  const { changes } = item.data as CoursePatchData
  const toggle = (field: string, change: FieldChange, apply: boolean) =>
    save.mutate({
      path: { session_id: item.session_id, item_id: item.id },
      body: { data: { changes: { [field]: { ...change, apply } } } },
    })
  return (
    <ul className="divide-y rounded-2xl border">
      {Object.entries(changes).map(([field, change]) => {
        const label = PATCH_LABELS[field]?.() ?? field
        return (
          <li key={field} className="flex gap-3 p-3">
            <Checkbox
              aria-label={m.imports_patch_apply({ field: label })}
              checked={change.apply !== false}
              disabled={!editable || save.isPending}
              onCheckedChange={(on) => toggle(field, change, on)}
              className="mt-0.5"
            />
            <div className="min-w-0 flex-1 space-y-1 text-sm">
              <div className="flex items-center gap-1.5 font-medium">
                {label}
                <ConfidenceDot confidence={item.confidence[field]} />
                <EvidenceButton evidence={item.evidence[field]} field={label} />
              </div>
              <p className="text-muted-foreground line-through">{display(change.old) || '—'}</p>
              <p className="break-words whitespace-pre-wrap">{display(change.new)}</p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function display(value: unknown): string {
  if (value == null) return ''
  if (Array.isArray(value)) {
    return value
      .map((v) =>
        typeof v === 'object' && v ? String((v as { name?: unknown }).name ?? '') : String(v),
      )
      .join(', ')
  }
  return String(value)
}

function pick(data: Values, specs: readonly FieldSpec[]): Values {
  return Object.fromEntries(specs.map((spec) => [spec.key, data[spec.key] ?? null]))
}

function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string' && a.length === 5 && b.length === 8) {
    return b.startsWith(a) // "10:00" vs "10:00:00"
  }
  return (a ?? null) === (b ?? null)
}

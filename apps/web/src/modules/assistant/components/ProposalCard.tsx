import type { AgentProposalOut } from '@semestra/api-client'
import { ArrowRight } from 'lucide-react'
import { useId, useState } from 'react'
import { useAllModules } from '@/app/registry'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import { NativeSelect, NativeSelectOption } from '@/ui/native-select'
import { Switch } from '@/ui/switch'
import { fieldLabel, formatValue } from '../labels'
import type { Change } from '../stream'

type Schema = {
  type?: string
  title?: string
  enum?: unknown[]
  anyOf?: Schema[]
  $ref?: string
  properties?: Record<string, Schema>
  $defs?: Record<string, Schema>
}

type Preview = {
  target?: string
  changes?: Change[]
  link?: { to: string; page?: string }
}

/** The schema of one argument, following `$ref` and dropping the `null` of optional fields. */
function resolve(schema: Schema | undefined, root: Schema): Schema | undefined {
  if (!schema) return undefined
  if (schema.$ref) {
    const name = schema.$ref.split('/').at(-1) ?? ''
    return resolve(root.$defs?.[name], root)
  }
  if (schema.anyOf) {
    const nonNull = schema.anyOf.find((s) => s.type !== 'null')
    const inner = resolve(nonNull, root)
    return inner ? { ...inner, title: schema.title ?? inner.title } : undefined
  }
  return schema
}

type Editable = { key: string; schema: Schema; kind: 'text' | 'number' | 'boolean' | 'enum' }

/** The arguments a person can change: plain values, not ids. */
export function editableFields(proposal: AgentProposalOut): Editable[] {
  const root = (proposal.input_schema ?? {}) as Schema
  const out: Editable[] = []
  for (const [key, raw] of Object.entries(root.properties ?? {})) {
    if (key === 'id' || key.endsWith('_id') || key.endsWith('_ids')) continue
    const schema = resolve(raw, root)
    if (!schema) continue
    const kind = schema.enum
      ? 'enum'
      : schema.type === 'boolean'
        ? 'boolean'
        : schema.type === 'number' || schema.type === 'integer'
          ? 'number'
          : schema.type === 'string'
            ? 'text'
            : null
    if (kind && key in proposal.args) out.push({ key, schema, kind })
  }
  return out
}

export function EditForm({
  proposal,
  onSubmit,
  onCancel,
  disabled,
}: {
  proposal: AgentProposalOut
  onSubmit: (args: Record<string, unknown>) => void
  onCancel: () => void
  disabled: boolean
}) {
  const id = useId()
  const fields = editableFields(proposal)
  const [values, setValues] = useState<Record<string, unknown>>(proposal.args)
  const set = (key: string, value: unknown) =>
    setValues((current) => ({ ...current, [key]: value }))
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit(values)
      }}
    >
      <FieldGroup className="gap-3">
        {fields.map(({ key, schema, kind }) => {
          const label = fieldLabel(key, schema.title)
          const value = values[key]
          const inputId = `${id}-${key}`
          if (kind === 'boolean') {
            return (
              <Field key={key} orientation="horizontal">
                <Switch
                  id={inputId}
                  checked={Boolean(value)}
                  onCheckedChange={(checked) => set(key, checked)}
                />
                <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
              </Field>
            )
          }
          return (
            <Field key={key}>
              <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
              {kind === 'enum' ? (
                <NativeSelect
                  id={inputId}
                  value={String(value ?? '')}
                  onChange={(event) => set(key, event.target.value)}
                >
                  {(schema.enum ?? []).map((option) => (
                    <NativeSelectOption key={String(option)} value={String(option)}>
                      {String(option)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              ) : (
                <Input
                  id={inputId}
                  type={kind === 'number' ? 'number' : 'text'}
                  step="any"
                  value={value === null || value === undefined ? '' : String(value)}
                  onChange={(event) => {
                    const text = event.target.value
                    if (kind === 'number') set(key, text === '' ? null : Number(text))
                    else set(key, text)
                  }}
                />
              )}
            </Field>
          )
        })}
      </FieldGroup>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={disabled}>
          {m.common_cancel()}
        </Button>
        <Button type="submit" size="sm" disabled={disabled}>
          {m.assistant_proposal_save_approve()}
        </Button>
      </div>
    </form>
  )
}

/** What an empty value means for a field: a task without a list is in the inbox, a file
 * without a folder at the course's root, a class without a change as scheduled. */
function emptyText(field: string, after: boolean): string {
  if (field === 'list') return m.tasks_view_inbox()
  if (field === 'folder') return m.assistant_value_root_folder()
  if (field === 'exception') return m.assistant_value_as_scheduled()
  return after ? m.assistant_value_cleared() : formatValue(null)
}

function changeText(
  change: Change,
  side: 'before' | 'after',
  cardTitles: ReadonlyMap<string, string>,
): string {
  const value = change[side]
  if (value === null || value === undefined) return emptyText(change.field, side === 'after')
  if (change.field === 'card' && typeof value === 'string') return cardTitles.get(value) ?? value
  const text = formatValue(value, change.field)
  const count = change.count
  if (Array.isArray(value) && count !== undefined && count > value.length) {
    return m.assistant_value_more({ items: text, more: count - value.length, total: count })
  }
  return text
}

/** A write's before → after list (M12 §3.5), on its card and later in its step. A value a
 * delete removes is struck through, without a "cleared" after it. `schema` (the card's input
 * schema, only while it waits) names fields the shared labels do not. */
export function ChangeList({
  changes,
  destructive = false,
  schema,
}: {
  changes: readonly Change[]
  destructive?: boolean
  schema?: Record<string, unknown> | null
}) {
  const modules = useAllModules()
  if (changes.length === 0) return null
  const root = (schema ?? {}) as Schema
  const cardTitles = new Map(
    modules.flatMap((module) => (module.cards ?? []).map((card) => [card.id, card.title()])),
  )
  return (
    <dl className="space-y-1 text-sm">
      {changes.map((change) => {
        const removed = destructive && change.after === null && 'before' in change
        return (
          <div key={change.field} className="flex flex-wrap items-baseline gap-x-2">
            <dt className="text-muted-foreground">
              {fieldLabel(change.field, resolve(root.properties?.[change.field], root)?.title)}
            </dt>
            <dd className="flex min-w-0 items-baseline gap-1.5">
              {'before' in change ? (
                <>
                  <span className="text-muted-foreground line-through">
                    {changeText(change, 'before', cardTitles)}
                  </span>
                  {removed ? null : (
                    <ArrowRight
                      aria-label={m.assistant_proposal_becomes()}
                      className="size-3 self-center"
                    />
                  )}
                </>
              ) : null}
              {removed ? null : (
                <span className="font-medium">{changeText(change, 'after', cardTitles)}</span>
              )}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

/** What a proposal changes, from the capability's preview. */
export function proposalChanges(proposal: AgentProposalOut): Change[] {
  return ((proposal.preview ?? {}) as Preview).changes ?? []
}

export function ProposalChanges({ proposal }: { proposal: AgentProposalOut }) {
  return (
    <ChangeList
      changes={proposalChanges(proposal)}
      destructive={proposal.effect === 'destructive'}
      schema={proposal.input_schema}
    />
  )
}

/** Where the change can be seen, from the capability's preview. */
export function proposalLink(proposal: AgentProposalOut): string | null {
  return ((proposal.preview ?? {}) as Preview).link?.to ?? null
}

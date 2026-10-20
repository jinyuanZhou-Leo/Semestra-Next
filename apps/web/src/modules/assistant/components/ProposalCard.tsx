import type { AgentProposalOut } from '@semestra/api-client'
import { ArrowRight, PencilLine, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Field, FieldGroup, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemMedia,
  ItemTitle,
} from '@/ui/item'
import { Label } from '@/ui/label'
import { NativeSelect, NativeSelectOption } from '@/ui/native-select'
import { Switch } from '@/ui/switch'
import { Textarea } from '@/ui/textarea'
import { capabilityTitle, fieldLabel, formatValue } from '../labels'
import type { Decision } from '../use-chat'

type Schema = {
  type?: string
  title?: string
  enum?: unknown[]
  anyOf?: Schema[]
  $ref?: string
  properties?: Record<string, Schema>
  $defs?: Record<string, Schema>
}

type Change = { field: string; before?: unknown; after?: unknown }

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
function editableFields(proposal: AgentProposalOut): Editable[] {
  const root = proposal.input_schema as Schema
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

function EditForm({
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

/** A proposal's before → after list (M12 §3.5), on the card and later in its step. */
export function ProposalChanges({ proposal }: { proposal: AgentProposalOut }) {
  const preview = (proposal.preview ?? {}) as Preview
  const root = proposal.input_schema as Schema
  const changes = preview.changes ?? []
  if (changes.length === 0) return null
  return (
    <dl className="space-y-1 text-sm">
      {changes.map((change) => (
        <div key={change.field} className="flex flex-wrap items-baseline gap-x-2">
          <dt className="text-muted-foreground">
            {fieldLabel(change.field, resolve(root.properties?.[change.field], root)?.title)}
          </dt>
          <dd className="flex min-w-0 items-baseline gap-1.5">
            {'before' in change ? (
              <>
                <span className="text-muted-foreground line-through">
                  {formatValue(change.before, change.field)}
                </span>
                <ArrowRight
                  aria-label={m.assistant_proposal_becomes()}
                  className="size-3 self-center"
                />
              </>
            ) : null}
            <span className="font-medium">{formatValue(change.after, change.field)}</span>
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** Where the change can be seen, from the capability's preview. */
export function proposalLink(proposal: AgentProposalOut): string | null {
  return ((proposal.preview ?? {}) as Preview).link?.to ?? null
}

/**
 * A write the assistant wants to make, waiting for the user (M12 §3.5, §6.1; AI Elements
 * "Confirmation"): what changes (before → after), approve, reject with an optional reason, or
 * change the values first. Once decided it is a step line again.
 */
export function ProposalCard({
  proposal,
  disabled,
  onDecide,
}: {
  proposal: AgentProposalOut
  disabled: boolean
  onDecide: (decision: Decision) => void
}) {
  const id = useId()
  const [mode, setMode] = useState<'view' | 'edit' | 'reject'>('view')
  const [remember, setRemember] = useState(false)
  const [reason, setReason] = useState('')
  const preview = (proposal.preview ?? {}) as Preview
  const destructive = proposal.effect === 'destructive'
  const canEdit = editableFields(proposal).length > 0
  const title = capabilityTitle(proposal.capability)

  return (
    <Item variant="outline" size="sm" aria-label={title} className="flex-wrap">
      <ItemMedia variant="icon">{destructive ? <Trash2 /> : <PencilLine />}</ItemMedia>
      <ItemContent>
        <ItemTitle>
          {title}
          {destructive ? (
            <Badge variant="destructive">{m.assistant_proposal_destructive()}</Badge>
          ) : null}
        </ItemTitle>
        {preview.target ? <ItemDescription>{preview.target}</ItemDescription> : null}
      </ItemContent>
      {mode === 'view' ? (
        <ItemActions>
          <Button variant="outline" size="sm" disabled={disabled} onClick={() => setMode('reject')}>
            {m.assistant_proposal_reject()}
          </Button>
          {canEdit ? (
            <Button variant="outline" size="sm" disabled={disabled} onClick={() => setMode('edit')}>
              {m.assistant_proposal_edit()}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant={destructive ? 'destructive' : 'default'}
            disabled={disabled}
            onClick={() => onDecide({ proposalId: proposal.id, decision: 'approve', remember })}
          >
            {m.assistant_proposal_approve()}
          </Button>
        </ItemActions>
      ) : null}
      <ItemFooter className="flex-col items-stretch gap-3">
        {mode === 'edit' ? (
          <EditForm
            proposal={proposal}
            disabled={disabled}
            onCancel={() => setMode('view')}
            onSubmit={(args) =>
              onDecide({ proposalId: proposal.id, decision: 'edit', args, remember })
            }
          />
        ) : (
          <ProposalChanges proposal={proposal} />
        )}
        {mode === 'reject' ? (
          <div className="space-y-2">
            <Label htmlFor={`${id}-reason`}>{m.assistant_proposal_reason()}</Label>
            <Textarea
              id={`${id}-reason`}
              rows={2}
              value={reason}
              placeholder={m.assistant_proposal_reason_placeholder()}
              onChange={(event) => setReason(event.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setMode('view')} disabled={disabled}>
                {m.common_cancel()}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() =>
                  onDecide({
                    proposalId: proposal.id,
                    decision: 'reject',
                    reason: reason.trim() || undefined,
                  })
                }
              >
                {m.assistant_proposal_reject()}
              </Button>
            </div>
          </div>
        ) : null}
        {mode === 'view' && proposal.effect === 'write' ? (
          <Label className="text-xs font-normal text-muted-foreground">
            <Checkbox checked={remember} onCheckedChange={(checked) => setRemember(checked)} />
            {m.assistant_proposal_remember()}
          </Label>
        ) : null}
      </ItemFooter>
    </Item>
  )
}

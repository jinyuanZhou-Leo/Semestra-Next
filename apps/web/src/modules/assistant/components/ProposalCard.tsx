import type { AgentProposalOut } from '@semestra/api-client'
import { useRouter } from '@tanstack/react-router'
import { ArrowRight, Check, CircleDashed, X } from 'lucide-react'
import { useId, useState } from 'react'
import { errorMessage } from '@/lib/errors'
import * as messages from '@/paraglide/messages'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/ui/card'
import { Checkbox } from '@/ui/checkbox'
import { Field, FieldGroup, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import { Label } from '@/ui/label'
import { NativeSelect, NativeSelectOption } from '@/ui/native-select'
import { Switch } from '@/ui/switch'
import { Textarea } from '@/ui/textarea'
import { capabilityTitle } from '../labels'
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

const byKey = messages as unknown as Record<string, (() => string) | undefined>

/** A field's name for people: a shared translation when there is one, else the schema title. */
function fieldLabel(field: string, schema: Schema | undefined): string {
  return byKey[`assistant_field_${field}`]?.() ?? schema?.title ?? field.replaceAll('_', ' ')
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? m.assistant_value_yes() : m.assistant_value_no()
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return JSON.stringify(value)
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
          const label = fieldLabel(key, schema)
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

function ResultLine({ proposal, link }: { proposal: AgentProposalOut; link?: Preview['link'] }) {
  const router = useRouter()
  if (proposal.status === 'executed') {
    return (
      <div className="flex w-full items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Check aria-hidden className="size-4 text-primary" />
          {m.assistant_proposal_done()}
        </span>
        {link ? (
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0"
            onClick={() => router.history.push(link.to)}
          >
            {m.assistant_proposal_open()}
            <ArrowRight aria-hidden />
          </Button>
        ) : null}
      </div>
    )
  }
  if (proposal.status === 'failed') {
    return (
      <p className="flex items-center gap-1.5 text-sm text-destructive">
        <X aria-hidden className="size-4" />
        {m.assistant_proposal_failed({
          reason: errorMessage({ error: { code: proposal.error_code ?? 'unknown' } }),
        })}
      </p>
    )
  }
  return (
    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
      {proposal.status === 'expired' ? (
        <CircleDashed aria-hidden className="size-4" />
      ) : (
        <X aria-hidden className="size-4" />
      )}
      {proposal.status === 'expired'
        ? m.assistant_proposal_expired()
        : m.assistant_proposal_rejected()}
    </p>
  )
}

/**
 * A write the assistant wants to make, waiting for the user (M12 §3.5, §6.1): what changes
 * (before → after), approve, reject with an optional reason, or change the values first.
 * Once decided it shows how it went and a link to the page that changed.
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
  const root = proposal.input_schema as Schema
  const pending = proposal.status === 'pending'
  const destructive = proposal.effect === 'destructive'
  const changes = preview.changes ?? []
  const canEdit = editableFields(proposal).length > 0

  return (
    <Card size="sm" className="gap-3" aria-label={capabilityTitle(proposal.capability)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {capabilityTitle(proposal.capability)}
          {destructive ? (
            <Badge variant="destructive">{m.assistant_proposal_destructive()}</Badge>
          ) : null}
        </CardTitle>
        {preview.target ? <CardDescription>{preview.target}</CardDescription> : null}
      </CardHeader>
      {mode === 'edit' && pending ? (
        <CardContent>
          <EditForm
            proposal={proposal}
            disabled={disabled}
            onCancel={() => setMode('view')}
            onSubmit={(args) =>
              onDecide({ proposalId: proposal.id, decision: 'edit', args, remember })
            }
          />
        </CardContent>
      ) : changes.length > 0 ? (
        <CardContent>
          <dl className="space-y-1 text-sm">
            {changes.map((change) => (
              <div key={change.field} className="flex flex-wrap items-baseline gap-x-2">
                <dt className="text-muted-foreground">
                  {fieldLabel(change.field, resolve(root.properties?.[change.field], root))}
                </dt>
                <dd className="flex min-w-0 items-baseline gap-1.5">
                  {'before' in change ? (
                    <>
                      <span className="text-muted-foreground line-through">
                        {formatValue(change.before)}
                      </span>
                      <ArrowRight
                        aria-label={m.assistant_proposal_becomes()}
                        className="size-3 self-center"
                      />
                    </>
                  ) : null}
                  <span className="font-medium">{formatValue(change.after)}</span>
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      ) : null}
      {mode === 'reject' && pending ? (
        <CardContent className="space-y-2">
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
        </CardContent>
      ) : null}
      <CardFooter className="flex-wrap gap-2">
        {!pending ? (
          <ResultLine proposal={proposal} link={preview.link} />
        ) : mode === 'view' ? (
          <>
            {proposal.effect === 'write' ? (
              <Label className="mr-auto text-xs font-normal text-muted-foreground">
                <Checkbox checked={remember} onCheckedChange={(checked) => setRemember(checked)} />
                {m.assistant_proposal_remember()}
              </Label>
            ) : (
              <span className="mr-auto" />
            )}
            <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setMode('reject')}>
              {m.assistant_proposal_reject()}
            </Button>
            {canEdit ? (
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => setMode('edit')}
              >
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
          </>
        ) : null}
      </CardFooter>
    </Card>
  )
}

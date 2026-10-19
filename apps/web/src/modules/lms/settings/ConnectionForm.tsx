import type { Connection } from '@semestra/api-client'
import {
  lmsConnectionCreateMutation,
  lmsConnectionUpdateMutation,
  lmsProvidersListOptions,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type FormEvent } from 'react'
import { errorMessage } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { DialogFooter } from '@/ui/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select'
import { useProviderUis } from '../providers'
import { invalidateLms } from '../queries'

type Strings = Record<string, string>

function strings(value: Record<string, unknown>): Strings {
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, v == null ? '' : String(v)]))
}

/**
 * Add or edit a connection (M09 §7.1): pick the platform, fill in the form it contributes, then
 * "Check and save". The server signs in with the credentials before storing anything, so a
 * wrong address or token shows here and nothing is saved.
 */
export function ConnectionForm({
  connection,
  onSaved,
}: {
  connection?: Connection
  onSaved: (connection: Connection) => void
}) {
  const queryClient = useQueryClient()
  const id = useId()
  const uis = useProviderUis()
  const offered = (useQuery(lmsProvidersListOptions()).data?.items ?? []).filter((p) =>
    uis.has(p.kind),
  )
  const editing = connection !== undefined
  const [kind, setKind] = useState(connection?.provider ?? '')
  const [name, setName] = useState(connection?.display_name ?? '')
  const [config, setConfig] = useState<Strings>(() => strings(connection?.config ?? {}))
  const [credentials, setCredentials] = useState<Strings>({})
  const create = useMutation(lmsConnectionCreateMutation())
  const update = useMutation(lmsConnectionUpdateMutation())
  // Until the user picks one, the first platform the server offers (Canvas for now).
  const chosen = kind || offered[0]?.kind || ''
  const ui = uis.get(chosen)
  const pending = create.isPending || update.isPending
  const error = create.error ?? update.error
  const saved = connection ? strings(connection.config) : null
  const complete = ui ? ui.isComplete({ config, credentials }, saved) : false

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!ui || !complete || pending) return
    const filled = Object.fromEntries(
      Object.entries(credentials).filter(([, v]) => v.trim() !== ''),
    )
    const trimmed = Object.fromEntries(Object.entries(config).map(([k, v]) => [k, v.trim()]))
    const displayName = name.trim() || null
    const save = connection
      ? update.mutateAsync({
          path: { id: connection.id },
          body: {
            display_name: displayName,
            config: trimmed,
            credentials: Object.keys(filled).length > 0 ? filled : null,
          },
        })
      : create.mutateAsync({
          body: {
            provider: chosen,
            display_name: displayName,
            config: trimmed,
            credentials: filled,
          },
        })
    const saved = await save.catch(() => null) // the error is shown below the form
    if (!saved) return
    setCredentials({})
    await invalidateLms(queryClient)
    onSaved(saved)
  }

  const kindItems = offered.map((p) => ({
    value: p.kind,
    label: uis.get(p.kind)?.label() ?? p.display_name,
  }))
  const Form = ui?.ConfigForm
  const Help = ui?.credentialHelp

  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      <fieldset disabled={pending}>
        <FieldGroup>
          {editing || kindItems.length < 2 ? null : (
            <Field>
              <FieldLabel id={`${id}-kind`}>{m.lms_connection_provider()}</FieldLabel>
              <Select
                value={chosen}
                items={kindItems}
                onValueChange={(next) => {
                  if (!next) return
                  setKind(next)
                  setConfig({})
                  setCredentials({})
                  create.reset()
                }}
              >
                <SelectTrigger aria-labelledby={`${id}-kind`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {kindItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          )}
          {Form ? (
            <Form
              config={config}
              credentials={credentials}
              onConfig={setConfig}
              onCredentials={setCredentials}
              editing={editing}
              hints={connection?.credentials_hint ?? {}}
            />
          ) : null}
          {Help ? <Help /> : null}
          <Field>
            <FieldLabel htmlFor={`${id}-name`}>{m.lms_connection_name()}</FieldLabel>
            <Input
              id={`${id}-name`}
              placeholder={ui?.label()}
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <FieldError>{error ? errorMessage(error) : null}</FieldError>
          <DialogFooter>
            <Button type="submit" disabled={!complete}>
              {pending ? m.lms_connection_checking() : m.lms_connection_save()}
            </Button>
          </DialogFooter>
        </FieldGroup>
      </fieldset>
    </form>
  )
}

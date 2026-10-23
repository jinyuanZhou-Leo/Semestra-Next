import type { Connection } from '@semestra/api-client'
import {
  lmsConnectionCreateMutation,
  lmsConnectionUpdateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type FormEvent } from 'react'
import { errorMessage } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { DialogFooter } from '@/ui/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import { useProviderUis } from '../providers'
import { invalidateLms } from '../queries'

type Strings = Record<string, string>

function strings(value: Record<string, unknown>): Strings {
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, v == null ? '' : String(v)]))
}

/**
 * Add or edit a connection (M09 §7.1): fill in the form the platform contributes (`kind`, picked
 * in the step before), then "Check and save". The server signs in with the credentials before storing anything, so a
 * wrong address or token shows here and nothing is saved.
 */
export function ConnectionForm({
  kind,
  connection,
  onSaved,
  onBack,
}: {
  kind: string
  connection?: Connection
  onSaved: (connection: Connection) => void
  /** Back to the platform list (adding only). */
  onBack?: () => void
}) {
  const queryClient = useQueryClient()
  const id = useId()
  const uis = useProviderUis()
  const editing = connection !== undefined
  const [name, setName] = useState(connection?.display_name ?? '')
  const [config, setConfig] = useState<Strings>(() => strings(connection?.config ?? {}))
  const [credentials, setCredentials] = useState<Strings>({})
  const create = useMutation(lmsConnectionCreateMutation())
  const update = useMutation(lmsConnectionUpdateMutation())
  const ui = uis.get(kind)
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
            provider: kind,
            display_name: displayName,
            config: trimmed,
            credentials: filled,
          },
        })
    const result = await save.catch(() => null) // the error is shown below the form
    if (!result) return
    setCredentials({})
    await invalidateLms(queryClient, { all: true })
    onSaved(result)
  }

  const Form = ui?.ConfigForm
  const Help = ui?.credentialHelp

  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      <fieldset disabled={pending}>
        <FieldGroup>
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
            {onBack ? (
              <Button type="button" variant="ghost" onClick={onBack} className="sm:mr-auto">
                {m.lms_connection_back()}
              </Button>
            ) : null}
            <Button type="submit" disabled={!complete}>
              {pending ? m.lms_connection_checking() : m.lms_connection_save()}
            </Button>
          </DialogFooter>
        </FieldGroup>
      </fieldset>
    </form>
  )
}

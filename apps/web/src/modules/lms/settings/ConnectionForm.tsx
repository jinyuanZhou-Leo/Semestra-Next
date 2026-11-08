import type { Connection } from '@semestra/api-client'
import {
  lmsConnectionCreateMutation,
  lmsConnectionUpdateMutation,
  lmsProviderListOptions,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Suspense, useId, useState, type FormEvent, type ReactNode } from 'react'
import { errorMessage } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { DialogClose, DialogFooter } from '@/ui/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import { Spinner } from '@/ui/spinner'
import { useProviderUis } from '../providers'
import { invalidateLms } from '../queries'
import type { LmsFormStep } from '../types'

type Strings = Record<string, string>

function strings(value: Record<string, unknown>): Strings {
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, v == null ? '' : String(v)]))
}

/**
 * Add or edit a connection (M09 §7.1): fill in the form the platform contributes (`kind`, picked
 * in the step before), then "Check and save". The server signs in with the credentials before storing anything, so a
 * wrong address or token shows here and nothing is saved. Self-hosted Canvas can also paste the
 * address the school's login page ended on (`sign_in`) instead of a token.
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
  const providers = useQuery(lmsProviderListOptions())
  const editing = connection !== undefined
  const [name, setName] = useState(connection?.display_name ?? '')
  const [config, setConfig] = useState<Strings>(() => strings(connection?.config ?? {}))
  const [credentials, setCredentials] = useState<Strings>({})
  const [signIn, setSignIn] = useState('')
  const create = useMutation(lmsConnectionCreateMutation())
  const update = useMutation(lmsConnectionUpdateMutation())
  const ui = uis.get(kind)
  const signInEnabled =
    providers.data?.items.find((provider) => provider.kind === kind)?.sign_in ?? false
  const pending = create.isPending || update.isPending
  const error = create.error ?? update.error
  const saved = connection ? strings(connection.config) : null
  const complete = ui ? ui.isComplete({ config, credentials, signIn }, saved) : false

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!ui || !complete || pending) return
    const filled = Object.fromEntries(
      Object.entries(credentials).filter(([, v]) => v.trim() !== ''),
    )
    const trimmed = Object.fromEntries(Object.entries(config).map(([k, v]) => [k, v.trim()]))
    const displayName = name.trim() || null
    const pasted = signIn.trim()
    const save = connection
      ? update.mutateAsync({
          path: { id: connection.id },
          body: {
            display_name: displayName,
            config: trimmed,
            credentials: !pasted && Object.keys(filled).length > 0 ? filled : null,
            sign_in: pasted || null,
          },
        })
      : create.mutateAsync({
          body: {
            provider: kind,
            display_name: displayName,
            config: trimmed,
            ...(pasted ? { sign_in: pasted } : { credentials: filled }),
          },
        })
    const result = await save.catch(() => null) // the error is shown below the form
    if (!result) return
    setCredentials({})
    setSignIn('')
    await invalidateLms(queryClient, { all: true })
    onSaved(result)
  }

  const Form = ui?.ConfigForm
  const saveError = error ? errorMessage(error) : null

  const frame = (fields: ReactNode, step: LmsFormStep = {}) => {
    const back = step.back ?? onBack
    const last = !step.next && !step.noAction
    return (
      <FieldGroup>
        {fields}
        {last ? (
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
        ) : null}
        {last && !step.showsSaveError ? <FieldError>{saveError}</FieldError> : null}
        <DialogFooter>
          {back ? (
            <Button type="button" variant="ghost" onClick={back} className="sm:mr-auto">
              {m.lms_connection_back()}
            </Button>
          ) : null}
          <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>
            {m.common_cancel()}
          </DialogClose>
          {step.next ? (
            <Button
              type="button"
              variant={step.next.secondary ? 'secondary' : 'default'}
              disabled={step.next.disabled}
              onClick={step.next.onClick}
            >
              {step.next.label}
            </Button>
          ) : null}
          {last ? (
            <Button type="submit" disabled={!complete || step.saveDisabled}>
              {pending ? m.lms_connection_checking() : m.lms_connection_save()}
            </Button>
          ) : null}
        </DialogFooter>
      </FieldGroup>
    )
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      <fieldset disabled={pending}>
        {Form ? (
          // Preloaded by the connections section; this only shows if the code is still on its way.
          <Suspense fallback={<Spinner className="mx-auto my-6" />}>
            <Form
              config={config}
              credentials={credentials}
              onConfig={setConfig}
              onCredentials={setCredentials}
              signIn={signIn}
              onSignIn={setSignIn}
              signInEnabled={signInEnabled}
              editing={editing}
              hints={connection?.credentials_hint ?? {}}
              kind={kind}
              saveError={saveError}
              frame={frame}
            />
          </Suspense>
        ) : (
          frame(null)
        )}
      </fieldset>
    </form>
  )
}

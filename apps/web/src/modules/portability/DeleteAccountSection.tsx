import { accountDeleteMutation } from '@semestra/api-client/react-query'
import { useMutation } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { DangerZone, SettingRow } from '@/app/settings'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useAuth } from '@/modules/auth/useAuth'
import { errorCode, errorMessage } from '@/lib/errors'
import { toApiError } from '@/app/api'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'

/** Delete the account (M13 §5): typed sentence, a tick, and a recent sign-in or the password. */
export function DeleteAccountSection() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <DangerZone>
        <SettingRow label={m.portability_delete_title()} description={m.portability_delete_desc()}>
          <Button variant="destructive" onClick={() => setOpen(true)}>
            {m.portability_delete_title()}
          </Button>
        </SettingRow>
      </DangerZone>
      {open ? <DeleteAccountDialog onClose={() => setOpen(false)} /> : null}
    </>
  )
}

function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const id = useId()
  const { signOut } = useAuth()
  const [phrase, setPhrase] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [password, setPassword] = useState('')
  const remove = useMutation({
    ...accountDeleteMutation(),
    // The server has signed this account out everywhere; forget the session here too.
    onSuccess: () => signOut({ to: '/account-deleted', flush: false }),
  })
  const error = remove.error
  const reauth = error && errorCode(error) === 'auth.reauth_required'
  const needsPassword = Boolean(reauth && toApiError(error).params.password)
  const passwordWrong = error ? errorCode(error) === 'auth.invalid_credentials' : false
  const matches = phrase.trim().toLowerCase() === m.portability_delete_phrase().toLowerCase()

  return (
    <ConfirmDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={m.portability_delete_dialog_title()}
      description={m.portability_delete_dialog_desc()}
      confirmLabel={m.portability_delete_title()}
      pending={remove.isPending}
      confirmDisabled={!matches || !acknowledged || (needsPassword && password === '')}
      extra={
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor={`${id}-phrase`}>
              {m.portability_type_to_confirm({ phrase: m.portability_delete_phrase() })}
            </FieldLabel>
            <Input
              id={`${id}-phrase`}
              autoComplete="off"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
            />
          </Field>
          <Field orientation="horizontal">
            <Checkbox
              id={`${id}-ack`}
              checked={acknowledged}
              onCheckedChange={(checked) => setAcknowledged(checked)}
            />
            <FieldLabel htmlFor={`${id}-ack`} className="font-normal">
              {m.portability_delete_acknowledge()}
            </FieldLabel>
          </Field>
          {needsPassword || passwordWrong ? (
            <Field data-invalid={passwordWrong || undefined}>
              <FieldLabel htmlFor={`${id}-password`}>{m.portability_delete_password()}</FieldLabel>
              <Input
                id={`${id}-password`}
                type="password"
                autoComplete="current-password"
                aria-invalid={passwordWrong || undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <FieldError>{passwordWrong ? errorMessage(error) : null}</FieldError>
            </Field>
          ) : null}
          {reauth && !needsPassword ? (
            <Field>
              <FieldError>{m.portability_delete_reauth()}</FieldError>
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => void signOut()}
              >
                {m.portability_delete_sign_in_again()}
              </Button>
            </Field>
          ) : null}
          {error && !reauth && !passwordWrong ? (
            <FieldError>{errorMessage(error)}</FieldError>
          ) : null}
        </FieldGroup>
      }
      onConfirm={() =>
        remove.mutate({
          body: {
            confirmation: phrase,
            acknowledged,
            password: password === '' ? null : password,
          },
        })
      }
    />
  )
}

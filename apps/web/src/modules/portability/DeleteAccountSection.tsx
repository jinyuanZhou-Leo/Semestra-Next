import { accountDeleteMutation, accountReauthStatusOptions } from '@semestra/api-client/react-query'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { DangerZone, SettingRow } from '@/app/settings'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useAuth } from '@/modules/auth/useAuth'
import { ReauthGate, needsReauth, useReauthRequired } from '@/modules/auth/components/ReauthGate'
import { errorMessage } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'

/** Delete the account (M13 §5): typed sentence, a tick, and a recent check that it is the user. */
export function DeleteAccountSection() {
  const [open, setOpen] = useState(false)
  // Known before the dialog opens, so it starts on the right step instead of switching to it.
  useQuery(accountReauthStatusOptions())
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
  const remove = useMutation({
    ...accountDeleteMutation(),
    // The server has signed this account out everywhere; forget the session here too.
    onSuccess: () => signOut({ to: '/account-deleted', flush: false }),
  })
  const error = remove.error
  const reauth = useReauthRequired(error)
  // Also sent again once the user confirms it's them: with what the dialog shows by then.
  const confirm = () => remove.mutate({ body: { confirmation: phrase, acknowledged } })
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
      confirmDisabled={!matches || !acknowledged || reauth}
      extra={
        <FieldGroup className="gap-4">
          <ReauthGate error={error} onVerified={confirm} className="gap-4">
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
          </ReauthGate>
          {error && !needsReauth(error) ? <FieldError>{errorMessage(error)}</FieldError> : null}
        </FieldGroup>
      }
      onConfirm={confirm}
    />
  )
}

import { type FormEvent, useId, useState } from 'react'
import { errorCode, errorMessage } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
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

/** Errors about the name itself, shown under the name field until the name is changed. */
const NAME_ERRORS = new Set(['files.folder_name_taken'])

/** A name (and for links, an address) for a new or renamed file, folder or link. */
export function NameDialog({
  open,
  onOpenChangeComplete,
  title,
  label,
  initial,
  submitLabel,
  pending,
  error,
  onSubmit,
  onClose,
  extraField,
}: {
  open: boolean
  /** Clear what the dialog is about here, once it has closed (`useDialogTarget`). */
  onOpenChangeComplete?: (open: boolean) => void
  title: string
  label: string
  initial: string
  submitLabel: string
  pending: boolean
  /** The failed request's error, if any. */
  error: unknown
  onSubmit: (value: string, extra: string) => void
  onClose: () => void
  extraField?: { label: string; placeholder?: string; required: boolean }
}) {
  const id = useId()
  const [value, setValue] = useState(initial)
  const [extra, setExtra] = useState('')
  const [touched, setTouched] = useState(false)
  // The name last sent: an error about it no longer applies once the name is edited.
  const [sent, setSent] = useState<string | null>(null)
  const nameMissing = !extraField?.required && value.trim() === ''
  const extraMissing = Boolean(extraField?.required) && extra.trim() === ''
  const failed = error ? errorMessage(error) : null
  const aboutName = error ? NAME_ERRORS.has(errorCode(error)) : false
  const nameError =
    touched && nameMissing ? m.files_required() : aboutName && value.trim() === sent ? failed : null
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (nameMissing || extraMissing) return
    setSent(value.trim())
    onSubmit(value.trim(), extra.trim())
  }
  return (
    <Dialog
      open={open}
      onOpenChangeComplete={onOpenChangeComplete}
      onOpenChange={(next) => !next && !pending && onClose()}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={submit}>
          <FieldGroup className="gap-4">
            {extraField ? (
              <Field data-invalid={(touched && extraMissing) || undefined}>
                <FieldLabel htmlFor={`${id}-extra`}>{extraField.label}</FieldLabel>
                <Input
                  id={`${id}-extra`}
                  type="url"
                  inputMode="url"
                  placeholder={extraField.placeholder}
                  aria-invalid={(touched && extraMissing) || undefined}
                  value={extra}
                  onChange={(event) => setExtra(event.target.value)}
                />
                {touched && extraMissing ? <FieldError>{m.files_required()}</FieldError> : null}
              </Field>
            ) : null}
            <Field data-invalid={nameError ? true : undefined}>
              <FieldLabel htmlFor={`${id}-name`}>{label}</FieldLabel>
              <Input
                id={`${id}-name`}
                aria-invalid={nameError ? true : undefined}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
              {nameError ? <FieldError>{nameError}</FieldError> : null}
            </Field>
            {failed && !aboutName ? <FieldError>{failed}</FieldError> : null}
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>
                {m.common_cancel()}
              </DialogClose>
              <Button type="submit" disabled={pending}>
                {pending ? m.common_saving() : submitLabel}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

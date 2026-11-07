import { type FormEvent, useId, useState } from 'react'
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
import { Field, FieldError, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'

/**
 * Names a new grade category (the course's or a Program default); its color is set in the table
 * afterwards. `onSubmit` closes the dialog itself once the category is added.
 */
export function NewCategoryDialog({
  open,
  onOpenChange,
  pending = false,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending?: boolean
  onSubmit: (name: string) => void
}) {
  const fid = useId()
  const [name, setName] = useState('')
  const [touched, setTouched] = useState(false)
  const invalid = touched && name.trim() === ''
  const change = (next: boolean) => {
    if (!pending) onOpenChange(next)
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (name.trim() !== '') onSubmit(name.trim())
  }
  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{m.grading_category_new()}</DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="flex flex-col gap-6">
          <Field data-invalid={invalid || undefined}>
            <FieldLabel htmlFor={`${fid}-name`}>{m.grading_category_name()}</FieldLabel>
            <Input
              id={`${fid}-name`}
              value={name}
              maxLength={60}
              aria-invalid={invalid || undefined}
              onChange={(event) => setName(event.target.value)}
            />
            {invalid ? <FieldError>{m.common_required()}</FieldError> : null}
          </Field>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>
              {m.common_cancel()}
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {m.grading_category_add()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

import { useState } from 'react'
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
import { Field, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import { ChoiceControl } from '@/app/settings/choice'

export type ListDialogValue = { name: string; termLevel: boolean }

/** Create or rename a list. `canChooseLevel` offers "this term" / "all terms" when creating. */
export function ListDialog({
  open,
  onOpenChange,
  title,
  initialName = '',
  canChooseLevel,
  submitLabel = m.common_save(),
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  initialName?: string
  canChooseLevel?: boolean
  /** The primary button: "Create" for a new list, "Save" (default) when renaming. */
  submitLabel?: string
  onSubmit: (value: ListDialogValue) => Promise<unknown>
}) {
  const [name, setName] = useState(initialName)
  const [termLevel, setTermLevel] = useState(true)
  const [busy, setBusy] = useState(false)
  const valid = name.trim().length > 0
  const submit = async () => {
    if (!valid || busy) return
    setBusy(true)
    // On failure the action already showed why (e.g. the name is taken); keep the dialog open.
    const ok = await onSubmit({ name: name.trim(), termLevel }).then(
      () => true,
      () => false,
    )
    setBusy(false)
    if (ok) onOpenChange(false)
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-sm">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="task-list-name">{m.tasks_list_name_label()}</FieldLabel>
            <Input
              id="task-list-name"
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          {canChooseLevel ? (
            <Field>
              <FieldLabel>{m.tasks_list_level_label()}</FieldLabel>
              <ChoiceControl
                label={m.tasks_list_level_label()}
                value={termLevel ? 'term' : 'program'}
                onChange={(value) => setTermLevel(value === 'term')}
                options={[
                  { value: 'term', label: m.tasks_list_level_term() },
                  { value: 'program', label: m.tasks_list_level_program() },
                ]}
              />
            </Field>
          ) : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={busy} />}>
              {m.common_cancel()}
            </DialogClose>
            <Button type="submit" disabled={!valid || busy}>
              {busy ? m.common_saving() : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

import { type FormEvent, useId, useState } from 'react'
import { z } from 'zod'
import { FieldControlView } from '../settings/fields'
import { describeFields, type JsonSchema } from '../settings/schema'
import { fieldDescription, fieldLabel } from '../settings/texts'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog'
import { FieldError } from '@/ui/field'
import { Label } from '@/ui/label'
import type { CardContribution } from '../extensions'
import { cardNamespace } from './settings'

type Props = {
  card: CardContribution
  value: unknown
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Resolves when saved; the dialog stays open (and shows the error) if it rejects. */
  onSubmit: (value: unknown) => Promise<void> | void
}

function GeneratedForm({
  card,
  value,
  onChange,
}: {
  card: CardContribution
  value: Record<string, unknown>
  onChange: (value: Record<string, unknown>) => void
}) {
  const baseId = useId()
  const namespace = cardNamespace(card.id)
  const schema = z.toJSONSchema(card.settings!.schema, {
    io: 'input',
    unrepresentable: 'any',
  }) as JsonSchema
  const fields = describeFields(schema, card.settings?.fields)
  return (
    <div className="space-y-4">
      {fields.map((field) => {
        const id = `${baseId}-${field.key}`
        const description = fieldDescription(namespace, field.key)
        return (
          <div key={field.key} className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Label id={`${id}-label`} htmlFor={id}>
                {fieldLabel(namespace, field.key)}
              </Label>
              {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
            </div>
            <FieldControlView
              namespace={namespace}
              field={field}
              id={id}
              labelId={`${id}-label`}
              value={value[field.key]}
              onChange={(next) => onChange({ ...value, [field.key]: next })}
            />
          </div>
        )
      })}
    </div>
  )
}

/** Settings of one card instance (M10 §5.2): the card's own component or a generated form. */
export function CardSettingsDialog({ card, value, open, onOpenChange, onSubmit }: Props) {
  const [draft, setDraft] = useState(value)
  const [invalid, setInvalid] = useState(false)
  const [pending, setPending] = useState(false)
  // Start from the stored value each time the dialog opens.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setDraft(value)
      setInvalid(false)
    }
  }
  if (!card.settings) return null
  const Custom = card.settings.component

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const parsed = card.settings!.schema.safeParse(draft)
    if (!parsed.success) {
      setInvalid(true)
      return
    }
    setPending(true)
    try {
      await onSubmit(parsed.data)
      onOpenChange(false)
    } catch {
      // The caller reported the error; keep the dialog open with the user's input.
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.board_card_settings_title({ card: card.title() })}</DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={(event) => void submit(event)} className="space-y-4">
          {Custom ? (
            <Custom value={draft} onChange={setDraft} />
          ) : (
            <GeneratedForm
              card={card}
              value={(draft ?? {}) as Record<string, unknown>}
              onChange={setDraft}
            />
          )}
          {invalid ? <FieldError>{m.board_card_settings_invalid()}</FieldError> : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              {m.common_cancel()}
            </Button>
            <Button type="submit" disabled={pending}>
              {m.common_save()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

import { type FormEvent, useId, useState } from 'react'
import { z } from 'zod'
import { FieldControlView } from '../settings/fields'
import { describeFields, type JsonSchema } from '../settings/schema'
import { fieldDescription, fieldLabel } from '../settings/texts'
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
import { FieldError } from '@/ui/field'
import { SettingRow, SettingsGroup } from '../settings/rows'
import type { CardContribution, Scope } from '../extensions'
import { cardNamespace } from './settings'

type Props = {
  card: CardContribution
  /** The board the card is on, for a custom form (`card.settings.component`). */
  scope: Scope
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
    <SettingsGroup>
      {fields.map((field) => {
        const id = `${baseId}-${field.key}`
        return (
          <SettingRow
            key={field.key}
            label={fieldLabel(namespace, field.key)}
            description={fieldDescription(namespace, field.key)}
            labelId={`${id}-label`}
            htmlFor={id}
          >
            <FieldControlView
              namespace={namespace}
              field={field}
              id={id}
              labelId={`${id}-label`}
              value={value[field.key]}
              onChange={(next) => onChange({ ...value, [field.key]: next })}
            />
          </SettingRow>
        )
      })}
    </SettingsGroup>
  )
}

/** Settings of one card instance (M10 §5.2): the card's own component or a generated form. */
export function CardSettingsDialog({ card, scope, value, open, onOpenChange, onSubmit }: Props) {
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
    }
    setPending(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      {/* Wide enough for a settings row: the name on the left, a w-56 control on the right. */}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{m.board_card_settings_title({ card: card.title() })}</DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={(event) => void submit(event)} className="space-y-4">
          {Custom ? (
            <Custom value={draft} onChange={setDraft} scope={scope} />
          ) : (
            <GeneratedForm
              card={card}
              value={(draft ?? {}) as Record<string, unknown>}
              onChange={setDraft}
            />
          )}
          {invalid ? <FieldError>{m.board_card_settings_invalid()}</FieldError> : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>
              {m.common_cancel()}
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? m.common_saving() : m.common_save()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

import type { JsonValue, ProgramCreateInputBody } from '@semestra/api-client'
import { type FormEvent, type ReactNode, useId, useState } from 'react'
import { useExtensions } from '@/app/registry'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import { Label } from '@/ui/label'
import { PROGRAM_SETUP_FIELDS, type ProgramSetupField } from '../types'
import { TimezoneSelect, detectTimezone } from './TimezoneSelect'

/**
 * The fields of a new Program (M02 §5.7 step 2): name, school, time zone (detected), default
 * course credits, plus the `academics.programSetupFields` other modules contribute.
 */
export function ProgramForm({
  onSubmit,
  pending,
  submitLabel,
  footer,
}: {
  onSubmit: (body: ProgramCreateInputBody) => void
  pending?: boolean
  submitLabel: string
  footer?: ReactNode
}) {
  const id = useId()
  const setupFields = useExtensions<ProgramSetupField>(PROGRAM_SETUP_FIELDS).toSorted(
    (a, b) => a.order - b.order,
  )
  const [name, setName] = useState('')
  const [institution, setInstitution] = useState('')
  const [timezone, setTimezone] = useState(detectTimezone)
  const [credits, setCredits] = useState('0.5')
  const [setup, setSetup] = useState<Record<string, unknown>>({})
  const [touched, setTouched] = useState(false)

  const creditsValue = Number(credits)
  const creditsInvalid = credits.trim() === '' || !(creditsValue >= 0 && creditsValue <= 100)
  const nameMissing = name.trim() === ''
  const nameError = touched && nameMissing
  const creditsError = touched && creditsInvalid

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (nameMissing || creditsInvalid) return
    onSubmit({
      name: name.trim(),
      institution: institution.trim() || null,
      timezone,
      default_course_credits: creditsValue,
      setup: setup as Record<string, JsonValue>,
    })
  }

  return (
    <form noValidate onSubmit={submit}>
      <FieldGroup className="gap-4">
        <Field data-invalid={nameError || undefined}>
          <FieldLabel htmlFor={`${id}-name`}>{m.academics_program_name()}</FieldLabel>
          <Input
            id={`${id}-name`}
            aria-invalid={nameError || undefined}
            aria-describedby={nameError ? `${id}-name-error` : undefined}
            placeholder={m.academics_program_name_placeholder()}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          {nameError ? (
            <FieldError id={`${id}-name-error`}>{m.academics_required()}</FieldError>
          ) : null}
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-institution`}>{m.academics_program_institution()}</FieldLabel>
          <Input
            id={`${id}-institution`}
            placeholder={m.academics_program_institution_placeholder()}
            value={institution}
            onChange={(event) => setInstitution(event.target.value)}
          />
        </Field>
        <div>
          <Label id={`${id}-tz`} className="mb-2">
            {m.academics_program_timezone()}
          </Label>
          <TimezoneSelect aria-labelledby={`${id}-tz`} value={timezone} onChange={setTimezone} />
        </div>
        <Field data-invalid={creditsError || undefined} className="max-w-40">
          <FieldLabel htmlFor={`${id}-credits`}>{m.academics_program_default_credits()}</FieldLabel>
          <Input
            id={`${id}-credits`}
            type="number"
            inputMode="decimal"
            step="any"
            min={0}
            aria-invalid={creditsError || undefined}
            aria-describedby={creditsError ? `${id}-credits-error` : `${id}-credits-hint`}
            value={credits}
            onChange={(event) => setCredits(event.target.value)}
          />
          {creditsError ? (
            <FieldError id={`${id}-credits-error`}>{m.academics_credits_invalid()}</FieldError>
          ) : (
            <FieldDescription id={`${id}-credits-hint`}>
              {m.academics_program_default_credits_hint()}
            </FieldDescription>
          )}
        </Field>
        {setupFields.map((field) => (
          <field.component
            key={field.id}
            value={setup[field.id]}
            onChange={(value) => setSetup((current) => ({ ...current, [field.id]: value }))}
          />
        ))}
        <div className="flex justify-end gap-2 pt-2">
          {footer}
          <Button type="submit" disabled={pending}>
            {pending ? m.common_saving() : submitLabel}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}

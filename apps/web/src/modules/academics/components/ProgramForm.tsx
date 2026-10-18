import type { JsonValue, ProgramCreateInputBody } from '@semestra/api-client'
import { type FormEvent, type ReactNode, useId, useState } from 'react'
import { useExtensions } from '@/app/registry'
import { TextField } from '@/components/TextField'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
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
    <form noValidate onSubmit={submit} className="space-y-4">
      <TextField
        label={m.academics_program_name()}
        placeholder={m.academics_program_name_placeholder()}
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={touched && nameMissing ? m.academics_required() : null}
      />
      <TextField
        label={m.academics_program_institution()}
        placeholder={m.academics_program_institution_placeholder()}
        value={institution}
        onChange={(event) => setInstitution(event.target.value)}
      />
      <div>
        <Label id={`${id}-tz`} className="mb-2">
          {m.academics_program_timezone()}
        </Label>
        <TimezoneSelect aria-labelledby={`${id}-tz`} value={timezone} onChange={setTimezone} />
      </div>
      <TextField
        label={m.academics_program_default_credits()}
        hint={m.academics_program_default_credits_hint()}
        type="number"
        inputMode="decimal"
        step="any"
        min={0}
        className="max-w-40"
        value={credits}
        onChange={(event) => setCredits(event.target.value)}
        error={touched && creditsInvalid ? m.academics_credits_invalid() : null}
      />
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
    </form>
  )
}

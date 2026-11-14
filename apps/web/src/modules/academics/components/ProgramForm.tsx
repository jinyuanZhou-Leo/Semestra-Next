import type { JsonValue, ProgramCreateInputBody } from '@semestra/api-client'
import { type FormEvent, type ReactNode, useId, useState } from 'react'
import { useExtensions } from '@/app/registry'
import { SettingRow, SettingsGroup } from '@/app/settings/rows'
import { m } from '@/paraglide/messages'
import { FieldError } from '@/ui/field'
import { Input } from '@/ui/input'
import { PROGRAM_SETUP_FIELDS, type ProgramSetupField } from '../types'
import { TimezoneSelect, detectTimezone } from './TimezoneSelect'

export type ProgramFormValues = ProgramCreateInputBody

/**
 * The fields of a Program (M02 §5.7) as settings rows: name, school, time zone (detected),
 * default course credits, plus the `academics.programSetupFields` other modules contribute.
 * `footer` holds the buttons, one of them `type="submit"`.
 */
export function ProgramForm({
  initial,
  onSubmit,
  footer,
}: {
  initial?: ProgramFormValues
  onSubmit: (body: ProgramFormValues) => void
  footer: ReactNode
}) {
  const id = useId()
  const setupFields = useExtensions<ProgramSetupField>(PROGRAM_SETUP_FIELDS).toSorted(
    (a, b) => a.order - b.order,
  )
  const [name, setName] = useState(initial?.name ?? '')
  const [institution, setInstitution] = useState(initial?.institution ?? '')
  const [timezone, setTimezone] = useState(initial?.timezone ?? detectTimezone)
  const [credits, setCredits] = useState(String(initial?.default_course_credits ?? 0.5))
  const [setup, setSetup] = useState<Record<string, unknown>>(initial?.setup ?? {})
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
    <form noValidate onSubmit={submit} className="flex flex-1 flex-col gap-6">
      <SettingsGroup>
        <SettingRow label={m.academics_program_name()} htmlFor={`${id}-name`}>
          <div className="flex flex-col items-end gap-1">
            <Input
              id={`${id}-name`}
              className="w-72"
              aria-invalid={nameError || undefined}
              aria-describedby={nameError ? `${id}-name-error` : undefined}
              placeholder={m.academics_program_name_placeholder()}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            {nameError ? (
              <FieldError id={`${id}-name-error`} className="text-xs">
                {m.academics_required()}
              </FieldError>
            ) : null}
          </div>
        </SettingRow>
        <SettingRow label={m.academics_program_institution()} htmlFor={`${id}-institution`}>
          <Input
            id={`${id}-institution`}
            className="w-72"
            placeholder={m.academics_program_institution_placeholder()}
            value={institution}
            onChange={(event) => setInstitution(event.target.value)}
          />
        </SettingRow>
        <SettingRow label={m.academics_program_timezone()}>
          {(labelId) => (
            <TimezoneSelect aria-labelledby={labelId} value={timezone} onChange={setTimezone} />
          )}
        </SettingRow>
        <SettingRow
          label={m.academics_program_default_credits()}
          description={m.academics_program_default_credits_hint()}
          htmlFor={`${id}-credits`}
        >
          <div className="flex flex-col items-end gap-1">
            <Input
              id={`${id}-credits`}
              className="w-28"
              type="number"
              inputMode="decimal"
              step="any"
              min={0}
              aria-invalid={creditsError || undefined}
              aria-describedby={creditsError ? `${id}-credits-error` : undefined}
              value={credits}
              onChange={(event) => setCredits(event.target.value)}
            />
            {creditsError ? (
              <FieldError id={`${id}-credits-error`} className="text-xs">
                {m.academics_credits_invalid()}
              </FieldError>
            ) : null}
          </div>
        </SettingRow>
        {setupFields.map((field) => (
          <field.component
            key={field.id}
            value={setup[field.id]}
            onChange={(value) => setSetup((current) => ({ ...current, [field.id]: value }))}
          />
        ))}
      </SettingsGroup>
      {footer}
    </form>
  )
}

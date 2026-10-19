import { m } from '@/paraglide/messages'
import { Field, FieldDescription, FieldLabel } from '@/ui/field'
import { PresetSelect } from '../components/PresetSelect'
import { useScalePresets } from '../queries'

const DEFAULT_PRESET = 'uoft_4_0'

/** "How are grades converted to GPA?" on the Program form of onboarding (M03 §5.4). */
export function ScalePresetField({
  value,
  onChange,
}: {
  value: unknown
  onChange: (value: unknown) => void
}) {
  const presets = useScalePresets().data?.items
  const current = typeof value === 'string' ? value : DEFAULT_PRESET
  return (
    <Field>
      <FieldLabel>{m.grading_setup_label()}</FieldLabel>
      <PresetSelect
        label={m.grading_setup_label()}
        ids={presets?.map((p) => p.id) ?? [current]}
        value={current}
        onChange={onChange}
      />
      <FieldDescription>{m.grading_setup_hint()}</FieldDescription>
    </Field>
  )
}

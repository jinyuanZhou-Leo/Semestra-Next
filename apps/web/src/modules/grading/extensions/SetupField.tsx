import { SettingRow } from '@/app/settings/rows'
import { ChoiceControl } from '@/app/settings/choice'
import { m } from '@/paraglide/messages'
import { presetOptions } from '../presets'
import { useScalePresets } from '../queries'
import { DEFAULT_PRESET } from './scale-preset'

/** "Grade scale" on the Program form (M03 §5.4); `program.created` creates the scale from it. */
export default function ScalePresetField({
  value,
  onChange,
}: {
  value: unknown
  onChange: (value: unknown) => void
}) {
  const presets = useScalePresets().data?.items
  const current = typeof value === 'string' ? value : DEFAULT_PRESET
  return (
    <SettingRow label={m.grading_setup_label()} description={m.grading_setup_hint()}>
      {(labelId) => (
        <ChoiceControl
          labelId={labelId}
          selectClassName="w-72"
          options={presetOptions(presets?.map((p) => p.id) ?? [current])}
          value={current}
          onChange={onChange}
        />
      )}
    </SettingRow>
  )
}

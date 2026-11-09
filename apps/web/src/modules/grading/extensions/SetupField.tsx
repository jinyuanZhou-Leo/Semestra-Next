import { gradingScaleListPresets, gradingScaleUpdate } from '@semestra/api-client'
import { SettingRow } from '@/app/settings'
import { ChoiceControl } from '@/app/settings/choice'
import { m } from '@/paraglide/messages'
import { presetOptions } from '../presets'
import { useScalePresets } from '../queries'

export const DEFAULT_PRESET = 'uoft_4_0'

/** "Grade scale" on the Program form (M03 §5.4); `program.created` creates the scale from it. */
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

/** A preset picked again for a Program that exists: its table replaces the Program's scale. */
export async function applyScalePreset(programId: string, value: unknown) {
  const id = typeof value === 'string' ? value : DEFAULT_PRESET
  const { data } = await gradingScaleListPresets({ throwOnError: true })
  const preset = data.items.find((p) => p.id === id)
  if (!preset) return
  await gradingScaleUpdate({
    path: { program_id: programId },
    body: { bands: preset.bands, max_points: preset.max_points },
    throwOnError: true,
  })
}

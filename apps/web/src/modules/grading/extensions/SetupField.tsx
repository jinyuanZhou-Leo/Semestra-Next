import { Label } from '@/ui/label'
import { m } from '@/paraglide/messages'
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
    <div>
      <Label className="mb-2">{m.grading_setup_label()}</Label>
      <PresetSelect
        label={m.grading_setup_label()}
        ids={presets?.map((p) => p.id) ?? [current]}
        value={current}
        onChange={onChange}
      />
      <p className="mt-1.5 text-xs text-muted-foreground">{m.grading_setup_hint()}</p>
    </div>
  )
}

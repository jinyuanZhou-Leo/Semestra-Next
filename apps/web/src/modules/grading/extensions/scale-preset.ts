import { gradingScaleListPresets, gradingScaleUpdate } from '@semestra/api-client'

export const DEFAULT_PRESET = 'uoft_4_0'

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

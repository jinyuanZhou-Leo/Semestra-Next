import { m } from '@/paraglide/messages'
import type { ChoiceOption } from '@/app/settings/choice'

/** Ids the backend offers (`presets.PRESET_IDS`); the texts live here. */
const PRESET_TEXTS: Record<string, { label: () => string; hint: () => string }> = {
  uoft_4_0: {
    label: () => m.grading_preset_uoft_4_0(),
    hint: () => m.grading_preset_uoft_4_0_hint(),
  },
  us_4_0: { label: () => m.grading_preset_us_4_0(), hint: () => m.grading_preset_us_4_0_hint() },
  us_4_33: { label: () => m.grading_preset_us_4_33(), hint: () => m.grading_preset_us_4_33_hint() },
  standard_4_0: {
    label: () => m.grading_preset_standard_4_0(),
    hint: () => m.grading_preset_standard_4_0_hint(),
  },
  cn_100: { label: () => m.grading_preset_cn_100(), hint: () => m.grading_preset_cn_100_hint() },
  au_7: { label: () => m.grading_preset_au_7(), hint: () => m.grading_preset_au_7_hint() },
  kr_4_5: { label: () => m.grading_preset_kr_4_5(), hint: () => m.grading_preset_kr_4_5_hint() },
  custom: { label: () => m.grading_preset_custom(), hint: () => m.grading_preset_custom_hint() },
}

/** The options of a `ChoiceControl`: one line each on what the table is. */
export const presetOptions = (ids: readonly string[]): ChoiceOption<string>[] =>
  ids.map((id) => ({
    value: id,
    label: PRESET_TEXTS[id]?.label() ?? id,
    hint: PRESET_TEXTS[id]?.hint(),
  }))

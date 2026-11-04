import { type LucideIcon, Moon, Sun, SunMoon } from 'lucide-react'
import { m } from '@/paraglide/messages'
import type { Theme } from './appearance'

/** The three theme choices in display order, wherever the theme can be changed. */
export const THEME_OPTIONS: readonly { value: Theme; label: () => string; icon: LucideIcon }[] = [
  { value: 'system', label: m.settings_theme_system, icon: SunMoon },
  { value: 'light', label: m.settings_theme_light, icon: Sun },
  { value: 'dark', label: m.settings_theme_dark, icon: Moon },
]

import { Languages } from 'lucide-react'
import { type AppLocale, useLocale } from '@/app/locale'
import { m } from '@/paraglide/messages'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'

const LANGUAGES: readonly { value: AppLocale; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'zh-CN', label: '简体中文' },
]

/**
 * Language picker for signed-out pages (M11 §5.4). The choice is kept in localStorage and
 * becomes the account's language at the first sign-in.
 */
export function LanguageSwitcher() {
  const { locale, changeLocale } = useLocale()
  return (
    <Select
      value={locale}
      items={LANGUAGES}
      onValueChange={(next) => changeLocale(next as AppLocale, { chosenByUser: true })}
    >
      <SelectTrigger
        aria-label={m.settings_language_label()}
        className="min-w-0 gap-1.5 border-0 bg-transparent px-2 text-muted-foreground"
      >
        <Languages aria-hidden className="size-4" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LANGUAGES.map((l) => (
          <SelectItem key={l.value} value={l.value}>
            {l.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

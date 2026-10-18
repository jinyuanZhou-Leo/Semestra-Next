import { useId } from 'react'
import { useUiPref } from '@/app/ui-pref'
import { m } from '@/paraglide/messages'

export default function TemplateSettings() {
  const id = useId()
  const [compact, setCompact] = useUiPref('template.compact', false)
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="checkbox"
        className="size-4 accent-primary"
        checked={compact}
        onChange={(event) => setCompact(event.target.checked)}
      />
      <label htmlFor={id} className="text-sm">
        {m.template_settings_compact()}
      </label>
    </div>
  )
}

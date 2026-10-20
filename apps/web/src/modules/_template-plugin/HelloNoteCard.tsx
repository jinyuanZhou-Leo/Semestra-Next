import { settingsValueGetOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import type { CardProps } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { Textarea } from '@/ui/textarea'
import { useCardSettings } from '../plugin-kit/useCardSettings'
import type { HelloNoteCardSettings } from './schema'

/**
 * The card's content area (M10 §5.2). The host draws the frame: title, size menu, settings and
 * remove. A card only reacts to `size`, so each declared size needs a design: here the small card
 * shows the first line and bigger ones are editable.
 */
export default function HelloNoteCard({
  instanceId,
  size,
  settings,
}: CardProps<HelloNoteCardSettings>) {
  // `update` changes the text at once and saves it after a short delay.
  const { value, update } = useCardSettings(instanceId, settings, 800)
  // Plugin configuration set on the settings page; courses can override it (see the backend).
  const config = useQuery(settingsValueGetOptions({ path: { namespace: 'plugin.hello-note' } }))
  const showCount = config.data?.values.show_count !== false
  const lines = value.text === '' ? 0 : value.text.split('\n').length

  if (size === 's') {
    return (
      <p className="line-clamp-3 text-sm whitespace-pre-wrap">
        {value.text.split('\n')[0] || m.hello_card_empty()}
      </p>
    )
  }
  return (
    <div className="flex h-full flex-col gap-1">
      <Textarea
        aria-label={m.hello_card_text_aria()}
        placeholder={m.hello_card_empty()}
        maxLength={2000}
        value={value.text}
        onChange={(event) => update({ text: event.target.value })}
        className="min-h-0 flex-1 resize-none"
      />
      {showCount ? (
        <p className="text-xs text-muted-foreground">{m.hello_card_lines({ count: lines })}</p>
      ) : null}
    </div>
  )
}

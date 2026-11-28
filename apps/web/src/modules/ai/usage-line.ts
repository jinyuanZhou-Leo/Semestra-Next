import { useQuery } from '@tanstack/react-query'
import { CirclePause } from 'lucide-react'
import type { StatusItem } from '@/app/extensions'
import { useSettingsDialog } from '@/app/settings/use-settings-dialog'
import { aiStatusOptions } from '@/hooks/use-ai-status'
import { formatDate } from '@/lib/format'
import { m } from '@/paraglide/messages'

/**
 * Shown while this month's AI usage is at the user's limit (M06 §7.1): background AI is paused
 * until the next month; clicking the line opens the usage settings, where the limit is set.
 */
export function useUsageLimitLine(): StatusItem | null {
  const settings = useSettingsDialog()
  // The month ending reopens background AI without an event: look again on coming back.
  const limit = useQuery({ ...aiStatusOptions(), refetchOnWindowFocus: true }).data?.usage_limit
  if (!limit?.reached) return null
  return {
    icon: CirclePause,
    label: m.ai_usage_line_paused(),
    hint: m.ai_usage_line_paused_hint({ date: formatDate(limit.resets_on) }),
    rank: 'attention',
    onSelect: () => settings.open({ level: 'account', group: 'ai-usage' }),
  }
}

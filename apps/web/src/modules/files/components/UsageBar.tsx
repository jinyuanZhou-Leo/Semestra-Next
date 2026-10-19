import { formatBytes } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Progress } from '@/ui/progress'
import { useFilesUsage } from '../queries'

/** Storage used by the account against its quota, under the file list (M07 §6.1). */
export function UsageBar() {
  const usage = useFilesUsage().data
  // Same height while loading, so the page does not move when it arrives.
  if (!usage) return <div className="h-9" />
  const limited = usage.quota_bytes > 0
  const label = limited
    ? m.files_usage_of({
        used: formatBytes(usage.used_bytes),
        quota: formatBytes(usage.quota_bytes),
      })
    : m.files_usage_unlimited({ used: formatBytes(usage.used_bytes) })
  return (
    <div className="flex h-9 items-center gap-3 text-xs text-muted-foreground">
      <span className="tabular-nums">{label}</span>
      {limited ? (
        <Progress
          value={Math.min(100, (usage.used_bytes / usage.quota_bytes) * 100)}
          aria-label={label}
          className="w-40 [&_[data-slot=progress-track]]:h-1"
        />
      ) : null}
    </div>
  )
}

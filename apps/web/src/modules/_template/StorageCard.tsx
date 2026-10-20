import { coreStorageGetOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { formatBytes } from '@/lib/format'
import { m } from '@/paraglide/messages'

/** Cards receive `CardProps` (scope, size, settings); this one needs none of them. */
export default function StorageCard() {
  const usage = useQuery(coreStorageGetOptions())
  return (
    <AsyncBoundary query={usage}>
      {(u) => (
        <p className="text-sm" data-testid="storage-usage">
          {u.quota_bytes === 0
            ? m.template_storage_used_unlimited({ used: formatBytes(u.used_bytes) })
            : m.template_storage_used({
                used: formatBytes(u.used_bytes),
                quota: formatBytes(u.quota_bytes),
              })}
        </p>
      )}
    </AsyncBoundary>
  )
}

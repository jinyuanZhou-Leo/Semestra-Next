import type { ReactNode } from 'react'
import { m } from '@/paraglide/messages'

/**
 * The bottom of a settings section for actions that cannot be undone (delete a Program, delete
 * the account). Put a `ConfirmDialog`-guarded button inside (M11 §5.1, M00 §4.8).
 */
export function DangerZone({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 rounded-2xl border border-destructive/30 p-4">
      <h3 className="mb-3 text-sm font-medium text-destructive">{m.settings_danger_zone()}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

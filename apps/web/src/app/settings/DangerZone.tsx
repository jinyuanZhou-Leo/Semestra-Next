import type { ReactNode } from 'react'
import { SettingsGroup } from './rows'

/**
 * The list of a `danger` section (delete a Program, delete the account): `SettingRow`s whose
 * control is a destructive button guarded by a `ConfirmDialog` (M11 §5.1, M00 §4.8).
 */
export function DangerZone({ children }: { children: ReactNode }) {
  return (
    <SettingsGroup className="gap-0 rounded-2xl border border-destructive/30">
      {children}
    </SettingsGroup>
  )
}

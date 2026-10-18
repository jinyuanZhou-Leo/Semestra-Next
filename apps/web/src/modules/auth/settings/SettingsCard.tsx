import type { ReactNode } from 'react'
import { Card, CardContent } from '@/ui/card'

/** The card a settings section's content sits in; the title belongs to the section (M11). */
export function SettingsCard({ children }: { children: ReactNode }) {
  return (
    <Card>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  )
}

export function Row({
  label,
  value,
  action,
}: {
  label: string
  value?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {value ? <div className="truncate text-sm text-muted-foreground">{value}</div> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  )
}

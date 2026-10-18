import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

type Props = {
  icon?: LucideIcon
  title: string
  description?: ReactNode
  action?: ReactNode
}

/** Placeholder for empty lists, unavailable pages and errors (M00 §4.8). */
export function EmptyState({ icon: Icon, title, description, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {Icon ? <Icon aria-hidden className="size-8 text-muted-foreground" /> : null}
      <p className="font-heading text-base font-medium">{title}</p>
      {description ? (
        <div className="max-w-sm text-sm text-muted-foreground">{description}</div>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

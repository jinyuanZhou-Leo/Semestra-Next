import type { ReactNode } from 'react'

/**
 * The frame of a phone page (M17): a large title, a line under it and an action on the right,
 * the content scrolling under them, and an optional footer (an input) kept above the tab bar.
 */
export function MobilePage({
  title,
  subtitle,
  action,
  footer,
  children,
}: {
  title: string
  subtitle?: ReactNode
  action?: ReactNode
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pb-6">
        <header className="flex items-end justify-between gap-3 px-5 pt-[max(env(safe-area-inset-top),3rem)] pb-3">
          <div className="min-w-0">
            <h1 className="font-heading text-3xl font-semibold tracking-tight">{title}</h1>
            {/* Always reserved, so the content does not move when the line loads. */}
            <p className="mt-0.5 min-h-5 truncate text-sm text-muted-foreground">{subtitle}</p>
          </div>
          {action}
        </header>
        {children}
      </div>
      {footer ? <div className="shrink-0 border-t bg-background px-4 py-2.5">{footer}</div> : null}
    </>
  )
}

/** A small heading over a group of rows. */
export function MobileSection({
  title,
  tone,
  children,
}: {
  title: string
  tone?: 'destructive'
  children: ReactNode
}) {
  return (
    <section className="px-4 pt-5">
      <h2
        className={
          tone === 'destructive'
            ? 'px-1 pb-1.5 text-xs font-medium text-destructive'
            : 'px-1 pb-1.5 text-xs font-medium text-muted-foreground'
        }
      >
        {title}
      </h2>
      {children}
    </section>
  )
}

/** Rows in one rounded box, with lines between them. */
export function MobileList({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <ul aria-label={label} className="divide-y overflow-hidden rounded-2xl border bg-card">
      {children}
    </ul>
  )
}

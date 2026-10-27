import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A one-colour brand mark (an AI provider, an LMS) drawn from an SVG file as a CSS mask, so it
 * takes the text colour and follows the theme instead of carrying colours of its own.
 */
export function BrandLogo({ src, className }: { src: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block shrink-0 bg-current [mask:var(--brand-logo)_center/contain_no-repeat]',
        className ?? 'size-4',
      )}
      style={{ '--brand-logo': `url("${src}")` } as CSSProperties}
    />
  )
}

/** A brand mark in the small rounded tile used by the provider and connection tables. */
export function BrandTile({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background text-foreground',
        className,
      )}
    >
      {children}
    </span>
  )
}

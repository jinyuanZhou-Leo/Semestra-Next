import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A progress ring with content in the middle (counter, habit ring, pomodoro). `ratio` is 0–1,
 * `color` any CSS color (use a token, e.g. `var(--primary)` or `habitColor(...)`).
 */
export function Ring({
  ratio,
  color = 'var(--primary)',
  children,
  className,
  strokeWidth = 8,
  label,
}: {
  ratio: number
  color?: string
  children?: ReactNode
  className?: string
  strokeWidth?: number
  /** Announces the progress to assistive technology; omit when the content already says it. */
  label?: string
}) {
  const radius = 50 - strokeWidth / 2
  const circumference = 2 * Math.PI * radius
  const clamped = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0))
  return (
    <div
      className={cn('relative inline-flex aspect-square items-center justify-center', className)}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full -rotate-90" aria-hidden>
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.12"
          strokeWidth={strokeWidth}
        />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          className="transition-[stroke-dashoffset] duration-300 motion-reduce:transition-none"
        />
      </svg>
      <div className="relative">{children}</div>
    </div>
  )
}

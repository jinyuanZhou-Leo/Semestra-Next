import { cn } from '@/lib/utils'

/** Thin determinate bar. `value` is 0–100. */
export function ProgressBar({
  value,
  label,
  tone = 'default',
  className,
}: {
  value: number
  label: string
  tone?: 'default' | 'success' | 'error'
  className?: string
}) {
  return (
    <progress
      value={value}
      max={100}
      aria-label={label}
      className={cn(
        'block h-1 w-full appearance-none overflow-hidden rounded-full bg-muted',
        '[&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:transition-[width] [&::-webkit-progress-value]:duration-300 motion-reduce:[&::-webkit-progress-value]:transition-none',
        tone === 'default' &&
          '[&::-moz-progress-bar]:bg-primary [&::-webkit-progress-value]:bg-primary',
        tone === 'success' &&
          '[&::-moz-progress-bar]:bg-success [&::-webkit-progress-value]:bg-success',
        tone === 'error' &&
          '[&::-moz-progress-bar]:bg-destructive [&::-webkit-progress-value]:bg-destructive',
        className,
      )}
    />
  )
}

/** Small ring for compact places (table rows, the status bar). Decorative: pair it with text. */
export function ProgressRing({ value, className }: { value: number; className?: string }) {
  const circumference = 2 * Math.PI * 9
  return (
    <svg className={cn('size-5 -rotate-90', className)} viewBox="0 0 24 24" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.15"
        strokeWidth="2.5"
      />
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - value / 100)}
        className="transition-[stroke-dashoffset] duration-300 motion-reduce:transition-none"
      />
    </svg>
  )
}

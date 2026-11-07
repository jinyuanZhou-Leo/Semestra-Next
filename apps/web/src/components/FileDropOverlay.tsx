import { Upload } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Shown over a page or panel while files are dragged onto it: a dashed frame, with `label` (where
 * the files will go) in a pill at the bottom. The content stays visible, so a folder under the
 * pointer can show it is the target. The parent must be `relative`.
 */
export function FileDropOverlay({ label, className }: { label: string; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute -inset-2 z-20 flex flex-col justify-end rounded-3xl border-2 border-dashed border-primary bg-primary/5',
        className,
      )}
    >
      <div className="sticky bottom-6 mx-auto mb-6 flex max-w-[calc(100%-2rem)] items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg">
        <Upload aria-hidden className="size-4 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
    </div>
  )
}

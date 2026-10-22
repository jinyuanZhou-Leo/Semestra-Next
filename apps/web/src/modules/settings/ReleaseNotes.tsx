import type { Message } from '@/app/extensions'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { itemText, KIND_ORDER, type Release, type ReleaseItem } from './release-notes'

const KIND_TITLES: Record<ReleaseItem['kind'], Message> = {
  breaking: m.settings_release_kind_breaking,
  new: m.settings_release_kind_new,
  improved: m.settings_release_kind_improved,
  fixed: m.settings_release_kind_fixed,
}

const KIND_DOTS: Record<ReleaseItem['kind'], string> = {
  breaking: 'bg-destructive',
  new: 'bg-primary',
  improved: 'bg-chart-2',
  fixed: 'bg-muted-foreground',
}

/** One version's notes, grouped as "Needs your attention", "New", "Improved", "Fixed". */
export function ReleaseNotes({ release, className }: { release: Release; className?: string }) {
  const groups = KIND_ORDER.map((kind) => ({
    kind,
    items: release.items.filter((item) => item.kind === kind),
  })).filter((group) => group.items.length > 0)
  return (
    <div className={cn('space-y-4', className)}>
      {groups.map(({ kind, items }) => (
        <section key={kind} aria-label={KIND_TITLES[kind]()} className="space-y-1.5">
          <h4 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <span aria-hidden className={cn('size-1.5 rounded-full', KIND_DOTS[kind])} />
            {KIND_TITLES[kind]()}
          </h4>
          <ul className="space-y-1.5 text-sm">
            {items.map((item, index) => (
              <li
                // Static list; two notes can share their text ("Fixed a typo.").
                key={index}
                className="relative pl-4 leading-relaxed before:absolute before:top-[calc(0.5lh-2px)] before:left-1 before:size-1 before:rounded-full before:bg-border"
              >
                {itemText(item)}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

import { type LucideIcon, Sparkles, TrendingUp, TriangleAlert, Wrench } from 'lucide-react'
import type { Message } from '@/app/extensions'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import {
  byArea,
  itemArea,
  itemText,
  KIND_ORDER,
  type Release,
  type ReleaseItem,
} from './release-notes'

const KINDS: Record<
  ReleaseItem['kind'],
  { title: Message; icon: LucideIcon; chip: string; rail: string }
> = {
  breaking: {
    title: m.settings_release_kind_breaking,
    icon: TriangleAlert,
    chip: 'bg-destructive/10 text-destructive',
    rail: 'border-destructive/30',
  },
  new: {
    title: m.settings_release_kind_new,
    icon: Sparkles,
    chip: 'bg-primary/10 text-primary',
    rail: 'border-primary/30',
  },
  improved: {
    title: m.settings_release_kind_improved,
    icon: TrendingUp,
    chip: 'bg-success/10 text-success',
    rail: 'border-success/30',
  },
  fixed: {
    title: m.settings_release_kind_fixed,
    icon: Wrench,
    chip: 'bg-muted text-muted-foreground',
    rail: 'border-border',
  },
}

/** Consecutive notes about the same part of the app, so its name is written once. */
function areaRuns(items: ReleaseItem[]) {
  const runs: { area: string | undefined; items: ReleaseItem[] }[] = []
  for (const item of items) {
    const area = itemArea(item)
    const last = runs.at(-1)
    if (last && last.area === area) last.items.push(item)
    else runs.push({ area, items: [item] })
  }
  return runs
}

/**
 * One version's notes, grouped as "Needs your attention", "New", "Improved", "Fixed": each group
 * has an icon in its color and a count, and inside it the notes sit under the part of the app
 * they are about.
 */
export function ReleaseNotes({ release, className }: { release: Release; className?: string }) {
  const groups = KIND_ORDER.map((kind) => ({
    kind,
    items: byArea(release.items.filter((item) => item.kind === kind)),
  })).filter((group) => group.items.length > 0)
  return (
    <div className={cn('space-y-5', className)}>
      {groups.map(({ kind, items }) => {
        const { title, icon: Icon, chip, rail } = KINDS[kind]
        return (
          <section key={kind} aria-label={title()} className="space-y-2">
            <h4 className="flex items-center gap-2 text-sm font-medium">
              <span
                aria-hidden
                className={cn('flex size-6 items-center justify-center rounded-md', chip)}
              >
                <Icon className="size-3.5" />
              </span>
              {title()}
              <span className="font-normal text-muted-foreground tabular-nums">{items.length}</span>
            </h4>
            <div className={cn('ml-3 space-y-3 border-l-2 pl-5 text-sm', rail)}>
              {areaRuns(items).map(({ area, items: notes }) => (
                <div key={area ?? ''} className="space-y-1">
                  {area ? (
                    <h5 className="text-xs font-medium text-muted-foreground">{area}</h5>
                  ) : null}
                  <ul className="space-y-1.5">
                    {notes.map((item, index) => (
                      <li
                        // Static list; two notes can share their text ("Fixed a typo.").
                        key={index}
                        className="leading-relaxed"
                      >
                        {itemText(item)}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

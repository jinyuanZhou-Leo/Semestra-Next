import { useLocation, useRouter } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { HistoryLink } from '@/components/HistoryLink'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Empty, EmptyHeader, EmptyTitle } from '@/ui/empty'
import type { Scope, SettingsGroup, SettingsLevel } from '../extensions'
import { useSettingsSections } from '../registry'
import { GROUP_TITLES, buildNavigation } from './groups'
import { SettingsSections } from './SettingsSections'

type Props = {
  level: SettingsLevel
  scope?: Scope
  /** The group in the URL; unknown or missing shows the first group. */
  groupId?: string
  title: string
  /** URL of a group's page (the host's routes decide the shape). */
  hrefFor: (group: SettingsGroup) => string
  /** Where "Back" goes when the page was opened directly, without history. */
  fallbackHref: string
}

/** Highlights the section being read as the page scrolls (M11 §5.1). */
function useActiveSection(ids: readonly string[]): [string | undefined, (id: string) => void] {
  const key = ids.join('\n')
  // The choice belongs to one list of sections; a different list starts from its first one.
  const [chosen, setChosen] = useState<{ key: string; id: string }>()
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const sectionIds = key === '' ? [] : key.split('\n')
    const visible = new Set<string>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id)
          else visible.delete(entry.target.id)
        }
        const first = sectionIds.find((id) => visible.has(id))
        if (first) setChosen({ key, id: first })
      },
      { rootMargin: '-10% 0px -70% 0px' },
    )
    for (const id of sectionIds) {
      const element = document.getElementById(id)
      if (element) observer.observe(element)
    }
    return () => observer.disconnect()
  }, [key])
  const active = chosen?.key === key ? chosen.id : ids[0]
  return [active, (id) => setChosen({ key, id })]
}

/**
 * The shared settings layout (M11 §5.2): a sticky navigation of groups and sections on the
 * left, the sections of the chosen group on the right, a back button at the top left. Account
 * settings and the Program, term and course settings pages all render it.
 */
export function SettingsPage({ level, scope, groupId, title, hrefFor, fallbackHref }: Props) {
  const router = useRouter()
  const sections = useSettingsSections(level)
  const groups = buildNavigation(sections, level)
  const current = groups.find((g) => g.id === groupId) ?? groups[0]
  const [active, setActive] = useActiveSection(current?.sections.map((s) => s.id) ?? [])

  // Jump to `#section` when the page opens with a hash or the group changes.
  const hash = useLocation({ select: (location) => location.hash })
  useEffect(() => {
    if (hash) document.getElementById(hash)?.scrollIntoView()
  }, [hash, current?.id])

  const goBack = () => {
    if (router.history.canGoBack()) router.history.back()
    else router.history.push(fallbackHref)
  }

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-8 p-6 md:grid-cols-[14rem_minmax(0,1fr)]">
      <nav aria-label={title} className="md:sticky md:top-6 md:self-start">
        <Button variant="ghost" size="sm" className="mb-4 -ml-2" onClick={goBack}>
          <ArrowLeft aria-hidden />
          {m.settings_back()}
        </Button>
        <h1 className="mb-3 font-heading text-xl font-semibold tracking-tight">{title}</h1>
        <ul className="space-y-4">
          {groups.map((group) => (
            <li key={group.id}>
              <HistoryLink
                href={hrefFor(group.id)}
                aria-current={group.id === current?.id ? 'page' : undefined}
                className={cn(
                  'block text-xs font-medium',
                  group.id === current?.id ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {GROUP_TITLES[group.id]()}
              </HistoryLink>
              {group.id === current?.id ? (
                <ul className="mt-1.5 space-y-0.5 border-l border-border">
                  {group.sections.map((section) => (
                    <li key={section.id}>
                      <HistoryLink
                        href={`${hrefFor(group.id)}#${section.id}`}
                        onClick={() => setActive(section.id)}
                        aria-current={section.id === active ? 'location' : undefined}
                        className={cn(
                          '-ml-px flex items-center gap-2 border-l-2 py-1 pl-3 text-sm',
                          section.id === active
                            ? 'border-primary font-medium text-foreground'
                            : 'border-transparent text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {section.icon ? <section.icon aria-hidden className="size-4" /> : null}
                        {section.title()}
                      </HistoryLink>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0">
        {current ? (
          <SettingsSections level={level} scope={scope} group={current.id} />
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{m.settings_empty()}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </div>
  )
}

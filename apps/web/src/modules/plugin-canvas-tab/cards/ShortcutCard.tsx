import { Link } from '@tanstack/react-router'
import { School } from 'lucide-react'
import { CardSkeleton } from '@/app/board/CardSkeleton'
import type { CardProps } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { NAV_ICONS } from '../icons'
import { placePath, UnreadBadge, Unlinked, natives, useCourseCanvas } from './shared'
import type { ShortcutSettings } from './shortcut'

/**
 * One place of a course's Canvas tab, the whole card a link to it (M16 §6): a view chosen in the
 * card's settings, or where the user left the tab.
 */
export default function ShortcutCard({ scope, settings }: CardProps<ShortcutSettings>) {
  const courseId = scope.kind === 'course' ? scope.courseId : ''
  const place = settings.place ?? 'last'
  const { loading, overview, unread } = useCourseCanvas(scope.programId, courseId)
  if (loading) return <CardSkeleton />
  if (!overview) {
    return (
      <div className="flex flex-1 flex-col p-4">
        <Unlinked />
      </div>
    )
  }
  const view = place === 'last' ? undefined : place
  const Icon = view ? NAV_ICONS[view] : School
  // The course's own name for the view; one the instructor hid still opens, under its usual name.
  const label = view
    ? (natives(overview).find((e) => e.key === view)?.label ?? fallbackLabel(view))
    : m.canvas_tab_page_title()
  return (
    <Link
      to={placePath(scope.programId, courseId, view)}
      className="flex flex-1 flex-col items-center justify-center gap-2 rounded-[inherit] p-4 transition-colors hover:bg-muted/50"
    >
      <span className="relative">
        <Icon aria-hidden className="size-8 text-muted-foreground" />
        {view === 'announcements' ? (
          <UnreadBadge count={unread} className="-top-1.5 -right-3 text-xs leading-5" />
        ) : null}
      </span>
      <span className="max-w-full truncate text-sm font-medium">{label}</span>
    </Link>
  )
}

function fallbackLabel(view: Exclude<ShortcutSettings['place'], 'last'>): string {
  switch (view) {
    case 'home':
      return m.settings_card_canvas_tab_shortcut_place_option_home()
    case 'announcements':
      return m.settings_card_canvas_tab_shortcut_place_option_announcements()
    case 'syllabus':
      return m.settings_card_canvas_tab_shortcut_place_option_syllabus()
    case 'modules':
      return m.settings_card_canvas_tab_shortcut_place_option_modules()
    case 'assignments':
      return m.canvas_tab_work()
    case 'pages':
      return m.settings_card_canvas_tab_shortcut_place_option_pages()
    case 'files':
      return m.settings_card_canvas_tab_shortcut_place_option_files()
  }
}

import type { ReactNode } from 'react'
import {
  BoardEditActions,
  EditLayoutButton,
  useBoardEditHint,
  useBoardEditing,
} from '../board/BoardToolbar'
import { useHostAction } from '../commands/bus'

/**
 * The header every page on the right side shares (title, subtitle, actions, optional tabs), so
 * a term, a course, the Today page and a table page look alike. Its height never changes:
 * the subtitle line is always reserved, and while a board on the page is edited the edit
 * controls take the place of the header's buttons and the subtitle (M10 §5.2).
 */
export function PageHeader({
  title,
  switcher,
  breadcrumb,
  subtitle,
  actions,
  children,
}: {
  title: string
  /** Next to the title, e.g. a menu to jump to a sibling. */
  switcher?: ReactNode
  /** The parents of this page, above the title. */
  breadcrumb?: ReactNode
  subtitle?: ReactNode
  /** Icon buttons on the right, after "Edit layout" when the page has a board. */
  actions?: ReactNode
  /** The tab bar, when the page has tabs. */
  children?: ReactNode
}) {
  useHostAction('header.shown', () => {})
  const editing = useBoardEditing()
  const hint = useBoardEditHint()
  return (
    <header className="space-y-1 px-6 pt-6">
      {breadcrumb}
      <div className="flex min-h-8 items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-1">
          <h1 className="min-w-0 truncate font-heading text-2xl font-semibold tracking-tight">
            {title}
          </h1>
          {switcher}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {editing ? (
            <BoardEditActions />
          ) : (
            <>
              <EditLayoutButton />
              {actions}
            </>
          )}
        </div>
      </div>
      <div className="min-h-5 truncate text-sm text-muted-foreground">
        {editing ? hint : subtitle}
      </div>
      {children ? <div className="pt-3">{children}</div> : null}
    </header>
  )
}

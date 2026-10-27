import { type ReactNode, useState } from 'react'
import { useAuth } from '@/modules/auth/useAuth'
import { courseColor, courseLabel } from '@/modules/academics/color'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '@/ui/combobox'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/ui/sidebar'
import type { SettingsLevel } from '../extensions'
import type { PathIds, SettingsPath } from './scope-path'

/** The level names on the path, as nouns ("Term"), not the phrases used in "follow …". */
export const PATH_LEVEL_NAMES: Record<SettingsLevel, () => string> = {
  account: m.settings_path_account,
  program: m.settings_path_program,
  term: m.settings_path_term,
  course: m.settings_path_course,
}

type PickItem = { id: string; label: string; current?: boolean; color?: string }

type Props = {
  path: SettingsPath
  /** Show a level; `ids` is the whole path after the change. */
  onSelect: (level: SettingsLevel, ids: PathIds) => void
}

/**
 * The levels of the settings dialog as a vertical path, account at the top and course at the
 * bottom, which is also the direction values are inherited in (M11 §5.2). The Program (when
 * there are several), term and course nodes have a searchable picker; picking another term
 * leaves the course empty until one is picked.
 */
export function ScopePath({ path, onSelect }: Props) {
  const { user } = useAuth()
  const { program, term, course } = path
  const ids: PathIds = {
    programId: program ? program.id : undefined,
    termId: term ? term.id : undefined,
    courseId: course ? course.id : null,
  }
  const courses = path.courses ?? []
  const [coursePickerOpen, setCoursePickerOpen] = useState(false)

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu aria-label={m.settings_path_label()} className="relative">
          {/* The line joining the nodes, drawn behind their dots. */}
          <span
            aria-hidden
            className="absolute top-5 bottom-5 left-[1.0625rem] w-px bg-sidebar-border"
          />
          <PathNode
            level="account"
            active={!path.pending && path.level === 'account'}
            name={user ? user.display_name : ''}
            onClick={() => onSelect('account', ids)}
          />
          {program ? (
            <PathNode
              level="program"
              active={!path.pending && path.level === 'program'}
              name={program.name}
              onClick={() => onSelect('program', ids)}
            >
              {path.programs.length > 1 ? (
                <ScopePicker
                  label={m.settings_path_pick_program()}
                  search={m.settings_path_search_program()}
                  items={path.programs.map((p) => ({ id: p.id, label: p.name }))}
                  value={program.id}
                  onPick={(id) => onSelect('program', { programId: id, courseId: null })}
                />
              ) : null}
            </PathNode>
          ) : null}
          {program ? (
            <PathNode
              level="term"
              active={!path.pending && path.level === 'term'}
              name={term?.name}
              placeholder={m.settings_path_choose_term()}
              onClick={() => (term ? onSelect('term', ids) : undefined)}
            >
              <ScopePicker
                label={m.settings_path_pick_term()}
                search={m.settings_path_search_term()}
                items={(path.terms ?? []).map((t) => ({
                  id: t.id,
                  label: t.name,
                  current: t.id === path.currentTermId,
                }))}
                value={term?.id}
                onPick={(id) =>
                  onSelect('term', { programId: program.id, termId: id, courseId: null })
                }
              />
            </PathNode>
          ) : null}
          {program && term ? (
            <PathNode
              level="course"
              active={!path.pending && path.level === 'course'}
              name={course ? courseLabel(course) : undefined}
              color={course ? courseColor(course) : undefined}
              placeholder={m.settings_path_choose_course()}
              onClick={() => (course ? onSelect('course', ids) : setCoursePickerOpen(true))}
            >
              <ScopePicker
                label={m.settings_path_pick_course()}
                search={m.settings_path_search_course()}
                empty={courses.length === 0 ? m.settings_path_no_courses() : undefined}
                items={courses.map((c) => ({
                  id: c.id,
                  label: courseLabel(c),
                  color: courseColor(c),
                }))}
                value={course?.id}
                open={coursePickerOpen}
                onOpenChange={setCoursePickerOpen}
                onPick={(id) =>
                  onSelect('course', { programId: program.id, termId: term.id, courseId: id })
                }
              />
            </PathNode>
          ) : null}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function PathNode({
  level,
  active,
  name,
  placeholder,
  color,
  onClick,
  children,
}: {
  level: SettingsLevel
  active: boolean
  name?: string
  placeholder?: string
  color?: string
  onClick: () => void
  children?: ReactNode
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        aria-current={active ? 'true' : undefined}
        data-settings-level-current={active ? '' : undefined}
        className="h-auto gap-3 py-1.5"
        onClick={onClick}
      >
        {/* A course's dot takes its subject color, so its name lines up with the levels above. */}
        <span
          aria-hidden
          className={cn(
            'relative z-10 size-2.5 shrink-0 rounded-full border-2 bg-sidebar',
            color
              ? 'border-transparent'
              : active
                ? 'border-primary bg-primary'
                : 'border-sidebar-border',
            color && active && 'ring-2 ring-primary ring-offset-1 ring-offset-sidebar',
          )}
          style={color ? { backgroundColor: color } : undefined}
        />
        <span className="grid min-w-0 leading-tight">
          <span className="text-xs text-muted-foreground">{PATH_LEVEL_NAMES[level]()}</span>
          <span className={cn('truncate', name ? 'font-medium' : 'text-muted-foreground')}>
            {name ?? placeholder}
          </span>
        </span>
      </SidebarMenuButton>
      {children}
    </SidebarMenuItem>
  )
}

function ScopePicker({
  label,
  search,
  empty,
  items,
  value,
  open,
  onOpenChange,
  onPick,
}: {
  label: string
  search: string
  /** Shown instead of the list when there is nothing to pick from at all. */
  empty?: string
  items: PickItem[]
  value?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onPick: (id: string) => void
}) {
  return (
    <Combobox
      items={items}
      value={items.find((item) => item.id === value) ?? null}
      onValueChange={(next) => {
        if (next && next.id !== value) onPick(next.id)
      }}
      itemToStringLabel={(item) => item.label}
      isItemEqualToValue={(a, b) => a.id === b.id}
      open={open}
      onOpenChange={onOpenChange}
    >
      <ComboboxTrigger
        aria-label={label}
        render={
          <SidebarMenuAction className="top-1/2 -translate-y-1/2 peer-data-[size=default]/menu-button:top-1/2" />
        }
      />
      <ComboboxContent align="end" className="w-64">
        <ComboboxInput showTrigger={false} placeholder={search} aria-label={search} />
        <ComboboxEmpty>{empty ?? m.settings_path_no_match()}</ComboboxEmpty>
        <ComboboxList>
          {(item: PickItem) => (
            <ComboboxItem key={item.id} value={item}>
              {item.color ? (
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
              ) : null}
              <span className="truncate">{item.label}</span>
              {item.current ? (
                <Badge variant="secondary" className="ml-auto">
                  {m.settings_path_current()}
                </Badge>
              ) : null}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

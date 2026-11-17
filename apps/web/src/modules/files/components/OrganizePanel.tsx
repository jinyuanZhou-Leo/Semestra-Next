import { Link, useParams } from '@tanstack/react-router'
import { courseColor } from '@/modules/academics/color'
import { useCourses } from '@/modules/academics/queries'
import { m } from '@/paraglide/messages'
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from '@/ui/item'
import { organizeLink, organizeStageText, useOrganizing } from '../organize-link'

/** The status line's panel when several courses are being organized: each leads to its own. */
export default function OrganizePanel({ onClose }: { onClose: () => void }) {
  const { programId } = useParams({ strict: false }) as { programId?: string }
  const items = useOrganizing(programId)
  const courses = new Map((useCourses(programId ?? '').data?.items ?? []).map((c) => [c.id, c]))
  if (!programId) return null
  return (
    <div className="flex flex-col gap-2">
      <h2 className="px-1 text-sm font-medium">{m.files_organize_title()}</h2>
      <ItemGroup>
        {items.map((item) => {
          const course = courses.get(item.course_id)
          return (
            <Item
              key={item.course_id}
              size="xs"
              render={
                <Link
                  to={organizeLink({ program_id: programId, course_id: item.course_id }) ?? '.'}
                  onClick={onClose}
                />
              }
            >
              <ItemContent className="min-w-0">
                <ItemTitle className="w-full">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={course ? { backgroundColor: courseColor(course) } : undefined}
                  />
                  <span className="truncate">{course ? course.code || course.title : ''}</span>
                </ItemTitle>
              </ItemContent>
              <ItemActions className="text-xs text-muted-foreground">
                {organizeStageText(item)}
              </ItemActions>
            </Item>
          )
        })}
      </ItemGroup>
    </div>
  )
}

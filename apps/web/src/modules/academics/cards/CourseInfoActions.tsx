import { MoreHorizontal } from 'lucide-react'
import type { CardProps } from '@/app/extensions'
import { useExtensions } from '@/app/registry'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { COURSE_INFO_ACTIONS, type CourseInfoAction } from '../types'

/** The course info card's "…" menu: actions other modules contribute (M08 "Update from syllabus"). */
export default function CourseInfoActions({ scope }: CardProps) {
  const actions = useExtensions<CourseInfoAction>(COURSE_INFO_ACTIONS)
  if (scope.kind !== 'course' || actions.length === 0) return null
  const ctx = { programId: scope.programId, courseId: scope.courseId }
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={m.academics_course_info_actions()}
                  className="text-muted-foreground"
                />
              }
            />
          }
        >
          <MoreHorizontal aria-hidden />
        </TooltipTrigger>
        <TooltipContent>{m.academics_course_info_actions()}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.id}
            onClick={() => void Promise.resolve(action.run(ctx)).catch(toastError)}
          >
            <action.icon aria-hidden />
            {action.title()}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

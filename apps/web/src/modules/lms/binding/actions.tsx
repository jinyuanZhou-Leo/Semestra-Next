import { lmsCourseLinkGetOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { Suspense, useEffect } from 'react'
import { preload, preloadable } from '@/app/extensions'
import type {
  AssessmentAction,
  AssessmentActionDialogProps,
  AssessmentActionItemProps,
} from '@/modules/grading/types'
import { m } from '@/paraglide/messages'
import { DropdownMenuItem } from '@/ui/dropdown-menu'
import { useProgramProviderName, useProviderName } from '../providers'

// The dialogs load once a gradebook row offers them, not with the app.
const BindDialog = preloadable<AssessmentActionDialogProps>(() =>
  import('./dialogs').then((mod) => ({ default: mod.BindDialog })),
)
const UnbindDialog = preloadable<AssessmentActionDialogProps>(() =>
  import('./dialogs').then((mod) => ({ default: mod.UnbindDialog })),
)

function useCourseLink(courseId: string) {
  return useQuery(lmsCourseLinkGetOptions({ path: { course_id: courseId } })).data?.link ?? null
}

/** "Bind {provider} assignment…": an assessment made by hand, in a course linked to the platform. */
function BindItem({ assessment, open }: AssessmentActionItemProps) {
  const link = useCourseLink(assessment.course_id)
  const provider = useProviderName(link?.provider)
  const offered = Boolean(link) && assessment.source_kind !== 'lms'
  useEffect(() => {
    if (offered) void preload(BindDialog)
  }, [offered])
  if (!link || !offered) return null
  return (
    <DropdownMenuItem onClick={open}>
      {m.lms_bind_assignment({ provider: provider ?? link.provider })}
    </DropdownMenuItem>
  )
}

/** "Unbind from {provider} assignment": any assessment that follows one (imported or bound). */
function UnbindItem({ assessment, programId, open }: AssessmentActionItemProps) {
  const provider = useProgramProviderName(programId)
  const offered = assessment.source_kind === 'lms'
  useEffect(() => {
    if (offered) void preload(UnbindDialog)
  }, [offered])
  if (!offered) return null
  return (
    <DropdownMenuItem variant="destructive" onClick={open}>
      {m.lms_unbind_assignment({ provider: provider ?? m.lms_platform() })}
    </DropdownMenuItem>
  )
}

function LazyBindDialog(props: AssessmentActionDialogProps) {
  return (
    <Suspense fallback={null}>
      <BindDialog {...props} />
    </Suspense>
  )
}

function LazyUnbindDialog(props: AssessmentActionDialogProps) {
  return (
    <Suspense fallback={null}>
      <UnbindDialog {...props} />
    </Suspense>
  )
}

export const bindAction: AssessmentAction = {
  id: 'lms.bind',
  query: ({ courseId }) => lmsCourseLinkGetOptions({ path: { course_id: courseId } }),
  Item: BindItem,
  Dialog: LazyBindDialog,
}

export const unbindAction: AssessmentAction = {
  id: 'lms.unbind',
  destructive: true,
  Item: UnbindItem,
  Dialog: LazyUnbindDialog,
}

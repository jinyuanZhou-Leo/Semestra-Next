import {
  academicsProgramGetOptions,
  academicsTermListOptions,
} from '@semestra/api-client/react-query'
import { Outlet, createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'
import { usePreferences, useUpdatePreferences } from '@/app/preferences'
import { navOptions } from '@/app/host/nav'
import { prefetchCurrentTermCourses } from '@/modules/academics/current-term'
import { AppShell } from '@/modules/academics/shell/AppShell'

/** Everything inside a Program: the navigation shell (M02 §5.1). */
export const Route = createFileRoute('/_authed/p/$programId')({
  // The shell and every page start from the Program, its terms and its sidebar (with the current
  // term's courses); fetch them with the page's code instead of after the first render. Not
  // awaited: the shell shows its own loading state and errors. Only when not cached: the loader
  // runs on every navigation and hover, and the shell, which stays mounted, is kept fresh by
  // realtime events.
  loader: ({ context: { queryClient }, params: { programId } }) => {
    const path = { program_id: programId }
    const ignore = () => undefined
    queryClient.ensureQueryData(academicsProgramGetOptions({ path })).catch(ignore)
    queryClient.ensureQueryData(academicsTermListOptions({ path })).catch(ignore)
    queryClient.ensureQueryData(navOptions('program')).catch(ignore)
    prefetchCurrentTermCourses(queryClient, programId).catch(ignore)
  },
  component: ProgramLayout,
})

function ProgramLayout() {
  const { programId } = Route.useParams()
  const active = usePreferences().data?.active_program_id
  const loaded = active !== undefined
  const update = useUpdatePreferences()
  // Remember the Program last opened, so `/` returns to it (M11 `active_program_id`).
  useEffect(() => {
    if (loaded && active !== programId) update({ active_program_id: programId })
  }, [loaded, active, programId, update])
  return (
    <AppShell programId={programId}>
      <Outlet />
    </AppShell>
  )
}

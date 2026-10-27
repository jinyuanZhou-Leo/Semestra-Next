import {
  academicsProgramGetOptions,
  academicsTermListOptions,
} from '@semestra/api-client/react-query'
import { Outlet, createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'
import { usePreferences, useUpdatePreferences } from '@/app/preferences'
import { navOptions } from '@/app/host/nav'
import { AppShell } from '@/modules/academics/shell/AppShell'

/** Everything inside a Program: the navigation shell (M02 §5.1). */
export const Route = createFileRoute('/_authed/p/$programId')({
  // The shell and every page start from the Program, its terms and its sidebar; fetch them with
  // the page's code instead of after the first render. Not awaited: the shell shows its own
  // loading state.
  loader: ({ context: { queryClient }, params: { programId } }) => {
    void queryClient.prefetchQuery(academicsProgramGetOptions({ path: { program_id: programId } }))
    void queryClient.prefetchQuery(academicsTermListOptions({ path: { program_id: programId } }))
    void queryClient.prefetchQuery(navOptions('program'))
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

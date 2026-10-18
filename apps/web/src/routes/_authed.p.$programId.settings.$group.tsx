import { createFileRoute } from '@tanstack/react-router'
import { scopePath, scopeSettingsPath } from '@/app/extensions'
import { SettingsPage } from '@/app/settings'
import { useProgram } from '@/modules/academics/queries'
import { m } from '@/paraglide/messages'

export const Route = createFileRoute('/_authed/p/$programId/settings/$group')({
  component: ProgramSettings,
})

/** Program settings (M11 §5.2): `/p/<id>/settings/<group>`. */
function ProgramSettings() {
  const { programId, group } = Route.useParams()
  const scope = { kind: 'program', programId } as const
  const name = useProgram(programId).data?.name
  return (
    <SettingsPage
      level="program"
      scope={scope}
      groupId={group}
      title={name ?? m.settings_title()}
      hrefFor={(id) => scopeSettingsPath(scope, id)}
      fallbackHref={scopePath(scope)}
    />
  )
}

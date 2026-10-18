import { academicsTermGetOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { scopePath, scopeSettingsPath } from '@/app/extensions'
import { SettingsPage } from '@/app/settings'
import { m } from '@/paraglide/messages'

export const Route = createFileRoute('/_authed/p/$programId/t/$termId/settings/$group')({
  component: TermSettings,
})

function TermSettings() {
  const { programId, termId, group } = Route.useParams()
  const scope = { kind: 'term', programId, termId } as const
  const name = useQuery(academicsTermGetOptions({ path: { term_id: termId } })).data?.name
  return (
    <SettingsPage
      key={termId}
      level="term"
      scope={scope}
      groupId={group}
      title={name ?? m.settings_title()}
      hrefFor={(id) => scopeSettingsPath(scope, id)}
      fallbackHref={scopePath(scope)}
    />
  )
}

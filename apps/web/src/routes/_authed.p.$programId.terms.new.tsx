import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '@/app/host/PageHeader'
import { m } from '@/paraglide/messages'
import { TermWizard } from '@/modules/academics/wizard/TermWizard'

export const Route = createFileRoute('/_authed/p/$programId/terms/new')({ component: NewTerm })

function NewTerm() {
  const { programId } = Route.useParams()
  return (
    <div className="flex flex-col">
      <PageHeader title={m.academics_term_new()} />
      <div className="px-6 py-4">
        <TermWizard key={programId} programId={programId} />
      </div>
    </div>
  )
}

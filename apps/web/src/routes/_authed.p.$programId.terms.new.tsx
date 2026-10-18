import { createFileRoute } from '@tanstack/react-router'
import { m } from '@/paraglide/messages'
import { TermWizard } from '@/modules/academics/wizard/TermWizard'

export const Route = createFileRoute('/_authed/p/$programId/terms/new')({ component: NewTerm })

function NewTerm() {
  const { programId } = Route.useParams()
  return (
    <div className="space-y-6 p-6">
      <h1 className="mx-auto max-w-3xl font-heading text-2xl font-semibold tracking-tight">
        {m.academics_term_new()}
      </h1>
      <TermWizard key={programId} programId={programId} />
    </div>
  )
}

import { settingsValuesGetOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import type { PageProps } from '@/app/extensions'
import { m } from '@/paraglide/messages'

/**
 * A Page (M10 §5.1): a tab in the header of a Program, term or course. It gets the `scope` it is
 * shown for. Data comes from the generated API client, never from hand-written `fetch`.
 */
export default function HelloPage({ scope }: PageProps) {
  const config = useQuery(settingsValuesGetOptions({ path: { namespace: 'plugin.hello-note' } }))
  const formal = config.data?.values.greeting === 'formal'
  return (
    <div className="space-y-2 p-6">
      <h1 className="font-heading text-2xl font-semibold">{m.hello_page_title()}</h1>
      <p>{formal ? m.hello_page_greeting_formal() : m.hello_page_greeting_casual()}</p>
      <p className="text-sm text-muted-foreground">{m.hello_page_scope({ scope: scope.kind })}</p>
    </div>
  )
}

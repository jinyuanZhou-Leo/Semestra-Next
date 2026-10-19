import { lmsPagesListOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { CanvasBoundary } from '../CanvasBoundary'
import { useCanvasPage } from '../context'
import { homeView } from '../navigation'
import { AnnouncementsView } from './AnnouncementsView'
import { AssignmentsView } from './AssignmentsView'
import { ModulesView } from './ModulesView'
import { PageView } from './PagesView'
import { SyllabusView } from './SyllabusView'

/** The course home, as Canvas's `default_view` says (M16 §4). */
export function HomeView({ defaultView }: { defaultView: string | null | undefined }) {
  switch (homeView(defaultView)) {
    case 'front_page':
      return <FrontPage />
    case 'syllabus':
      return <SyllabusView />
    case 'assignments':
      return <AssignmentsView />
    case 'announcements':
      return <AnnouncementsView />
    default:
      return <ModulesView />
  }
}

/** A course whose home is a page (`wiki`); the modules when it has no front page. */
function FrontPage() {
  const { courseId, query } = useCanvasPage()
  const pages = useQuery(lmsPagesListOptions({ path: { course_id: courseId }, query }))
  return (
    <CanvasBoundary query={pages}>
      {(data) => {
        const front = data.items.find((p) => p.front_page)
        return front ? <PageView pageRef={front.ref} /> : <ModulesView />
      }}
    </CanvasBoundary>
  )
}

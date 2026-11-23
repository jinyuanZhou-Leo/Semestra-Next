import { useQuery } from '@tanstack/react-query'
import { errorCode } from '@/lib/errors'
import { useCanvasPage } from '../context'
import { homeView } from '../navigation'
import { FRONT_PAGE_REF, viewQueries } from '../queries'
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
  const { courseId } = useCanvasPage()
  const front = useQuery({
    ...viewQueries.page(courseId, FRONT_PAGE_REF),
  })
  if (front.isError && errorCode(front.error) === 'lms.not_found') return <ModulesView />
  return <PageView pageRef={FRONT_PAGE_REF} />
}

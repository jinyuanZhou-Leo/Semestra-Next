import { lmsPageGetOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { errorCode } from '@/lib/errors'
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

/** M09's page ref for the course's front page (Canvas `GET /courses/:id/front_page`). */
export const FRONT_PAGE_REF = '@front'

/** A course whose home is a page (`wiki`); the modules when it has no front page. */
function FrontPage() {
  const { courseId } = useCanvasPage()
  const front = useQuery(lmsPageGetOptions({ path: { course_id: courseId, ref: FRONT_PAGE_REF } }))
  if (front.isError && errorCode(front.error) === 'common.not_found') return <ModulesView />
  return <PageView pageRef={FRONT_PAGE_REF} />
}

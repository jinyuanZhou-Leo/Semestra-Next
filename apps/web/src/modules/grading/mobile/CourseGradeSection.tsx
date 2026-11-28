import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { MobileList, MobileSection } from '@/app/mobile/MobilePage'
import { HideGrades } from '../components/GradeValue'
import { useGradebook } from '../queries'
import { phoneGrade } from './headline'

/** The course's grade on its phone overview (M17 §4.1); opens the grades segment. */
export default function CourseGradeSection({
  programId,
  courseId,
}: {
  programId: string
  courseId: string
}) {
  const data = useGradebook(courseId).data
  if (!data) return null
  const grade = phoneGrade(data)
  return (
    <MobileSection title={grade.label}>
      <HideGrades hidden={data.scale.hide_grades}>
        <MobileList>
          <li>
            <Link
              to="/p/$programId/c/$courseId/$page"
              params={{ programId, courseId, page: 'grades' }}
              replace
              className="flex items-center gap-3 px-4 py-3"
            >
              <span className="flex-1 font-heading text-2xl font-semibold tabular-nums">
                {grade.value}
              </span>
              {grade.gpa ? (
                <span className="text-sm text-muted-foreground tabular-nums">{grade.gpa}</span>
              ) : null}
              <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
            </Link>
          </li>
        </MobileList>
      </HideGrades>
    </MobileSection>
  )
}

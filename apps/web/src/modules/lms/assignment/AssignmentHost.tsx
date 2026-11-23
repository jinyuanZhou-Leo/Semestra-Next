import { type ComponentType, Suspense, useState } from 'react'
import { type AssignmentTarget, useAssignmentDetails, useOpenAssignmentTarget } from './target'

/** What the details take: the assignment the URL names (null while closing) and how to close. */
export type AssignmentDetailsProps = { target: AssignmentTarget | null; onClose: () => void }

/**
 * The assignment details of the signed-in app (an `overlays` entry): open while the URL names an
 * assignment. The manifest hands in the view (a dialog; on a phone a page that slides up, M17),
 * whose code loads the first time an assignment is opened.
 */
export function assignmentHost(Details: ComponentType<AssignmentDetailsProps>) {
  return function AssignmentHost() {
    const target = useOpenAssignmentTarget()
    const { close } = useAssignmentDetails()
    const [used, setUsed] = useState(false)
    if (target && !used) setUsed(true)
    if (!used) return null
    return (
      <Suspense fallback={null}>
        <Details target={target} onClose={close} />
      </Suspense>
    )
  }
}

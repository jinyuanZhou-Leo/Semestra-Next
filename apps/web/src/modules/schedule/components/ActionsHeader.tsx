import { m } from '@/paraglide/messages'

/** The unlabeled header of a table's row-menu column, named for screen readers. */
export const ActionsHeader = () => <span className="sr-only">{m.schedule_actions()}</span>

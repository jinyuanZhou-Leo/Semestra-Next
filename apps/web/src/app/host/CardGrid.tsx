import type { Scope } from '../extensions'
import { Board } from '../board/Board'

/**
 * The card grid of an overview or the Today page (M00 §4.4): M10's editable board. `board`
 * selects the Today board of the scope's Program (M04 §5.1).
 */
export function CardGrid({ scope, board }: { scope: Scope; board?: 'today' }) {
  return <Board scope={scope} board={board} />
}

import type { Scope } from '../extensions'
import { Board } from '../board/Board'

/**
 * The card grid of an overview or the Today page (M00 §4.4): M10's editable board. `board`
 * selects the Today board of the scope's Program (M04 §5.1). `data-tour` lets the first-run tour
 * point at the cards from whichever board page onboarding lands on (M02 §5.7).
 */
export function CardGrid({ scope, board }: { scope: Scope; board?: 'today' }) {
  return (
    <div data-tour="cards" className="flex flex-col">
      <Board scope={scope} board={board} />
    </div>
  )
}

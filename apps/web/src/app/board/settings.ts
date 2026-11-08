import { use } from 'react'
import type { CardContribution, CardSettings } from '../extensions'

type Spec = Promise<CardSettings | null>

// React's `use` reads a promise at once, without suspending, when its `status` says it settled.
const NONE: Spec = Object.assign(Promise.resolve(null), { status: 'fulfilled', value: null })
const loaded = new Map<string, Spec>()

/**
 * Loads a card's settings spec (`CardContribution.settings`), once per card type. A failed load
 * is forgotten so the next call tries again.
 */
export function loadCardSettings(card: CardContribution): Spec {
  if (!card.settings) return NONE
  let promise = loaded.get(card.id)
  if (!promise) {
    const next: Spec = card.settings().then((module) => module.default)
    next.then(
      (value) => Object.assign(next, { status: 'fulfilled', value }),
      (reason: unknown) => {
        Object.assign(next, { status: 'rejected', reason })
        loaded.delete(card.id)
      },
    )
    loaded.set(card.id, next)
    promise = next
  }
  return promise
}

/** The card's settings spec; suspends while it loads (the board preloads it with the card). */
export function useCardSettingsSpec(card: CardContribution): CardSettings | null {
  return use(loadCardSettings(card))
}

/** A card's stored settings parsed by its schema; invalid or missing values get the defaults. */
export function parseCardSettings(spec: CardSettings | null, stored: unknown): unknown {
  if (!spec) return {}
  const parsed = spec.schema.safeParse(stored ?? {})
  if (parsed.success) return parsed.data
  const defaults = spec.schema.safeParse({})
  return defaults.success ? defaults.data : {}
}

export function cardNamespace(cardId: string): string {
  return `card.${cardId}`
}

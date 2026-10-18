import type { CardContribution } from '../extensions'

/** A card's stored settings parsed by its schema; invalid or missing values get the defaults. */
export function parseCardSettings(card: CardContribution, stored: unknown): unknown {
  if (!card.settings) return {}
  const parsed = card.settings.schema.safeParse(stored ?? {})
  if (parsed.success) return parsed.data
  const defaults = card.settings.schema.safeParse({})
  return defaults.success ? defaults.data : {}
}

export function cardNamespace(cardId: string): string {
  return `card.${cardId}`
}

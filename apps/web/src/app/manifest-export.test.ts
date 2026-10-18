import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'
import { exportManifests } from './manifest-export'
import { builtInModules } from './registry'

// Vitest runs in apps/web.
const FILE = path.resolve('../api/src/semestra/modules/plugins/web_manifest.json')

// `pnpm --filter @semestra/web manifest:export` rewrites the file instead of comparing.
test('the backend copy of the module manifests is up to date', () => {
  const current = `${JSON.stringify(exportManifests(builtInModules), null, 2)}\n`
  if (process.env.UPDATE_MANIFEST) writeFileSync(FILE, current)
  expect(readFileSync(FILE, 'utf8'), 'run `pnpm --filter @semestra/web manifest:export`').toBe(
    current,
  )
})

test('card and page ids are unique and default layouts name known cards', () => {
  const cards = builtInModules.flatMap((m) => m.cards ?? [])
  expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length)
  for (const m of builtInModules) {
    for (const [kind, slots] of Object.entries(m.defaultBoard ?? {})) {
      for (const slot of slots ?? []) {
        const card = cards.find((c) => c.id === slot.card)
        expect(card, `${m.id} defaultBoard.${kind}: ${slot.card}`).toBeDefined()
        expect(card?.scopes).toContain(kind)
        expect(slot.size === undefined || card?.sizes.includes(slot.size)).toBe(true)
      }
    }
  }
  expect(new Set(builtInModules.map((m) => m.id)).size).toBe(builtInModules.length)
})

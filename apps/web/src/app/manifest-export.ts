import { type ZodType, z } from 'zod'
import type { ModuleManifest } from './extensions'

/**
 * What the backend needs to know about the frontend modules (M10 §3): kinds, pages, cards with
 * their sizes and settings JSON Schema, and default layouts. Written to
 * `apps/api/src/semestra/modules/plugins/web_manifest.json` by `pnpm manifest:export`; the
 * backend validates layouts with it and a test keeps the file in step with the manifests.
 */
export async function exportManifests(modules: readonly ModuleManifest[]) {
  const schemas = new Map<string, ZodType>()
  for (const card of modules.flatMap((m) => m.cards ?? [])) {
    if (card.settings) schemas.set(card.id, (await card.settings()).default.schema)
  }
  return {
    modules: modules.map((m) => ({
      id: m.id,
      kind: m.kind,
      pages: (m.pages ?? []).map((p) => ({ id: p.id, scopes: [...p.scopes] })),
      cards: (m.cards ?? []).map((c) => ({
        id: c.id,
        scopes: [...c.scopes],
        sizes: [...c.sizes],
        default_size: c.defaultSize,
        multiple: c.multiple,
        settings_schema: schemas.has(c.id)
          ? z.toJSONSchema(schemas.get(c.id)!, { io: 'input', unrepresentable: 'any' })
          : null,
      })),
      default_board: Object.fromEntries(
        Object.entries(m.defaultBoard ?? {}).map(([kind, slots]) => [
          kind,
          (slots ?? []).map((s) => (s.size ? { card: s.card, size: s.size } : { card: s.card })),
        ]),
      ),
    })),
  }
}

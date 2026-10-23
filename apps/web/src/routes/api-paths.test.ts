import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'

// Hosted on one origin, the API answers a GET before the SPA does (M15), so a backend GET path
// that starts like a page URL breaks that page on reload or from a link in an email.
test('no backend GET path shares its first segment with a page or a sibling site', () => {
  const tree = readFileSync(path.resolve(import.meta.dirname, '../routeTree.gen.ts'), 'utf8')
  const pages = tree.slice(tree.indexOf('fullPaths:'), tree.indexOf('fileRoutesByTo'))
  const pageRoots = new Set([...pages.matchAll(/'\/([^/'$]+)/g)].map((match) => match[1]))
  for (const site of ['docs', 'landing']) pageRoots.add(site)

  const spec = JSON.parse(
    readFileSync(
      path.resolve(import.meta.dirname, '../../../../packages/api-client/openapi.json'),
      'utf8',
    ),
  ) as { paths: Record<string, Record<string, unknown>> }
  const clashes = Object.entries(spec.paths)
    .filter(([url, ops]) => 'get' in ops && pageRoots.has(url.split('/')[1] ?? ''))
    .map(([url]) => url)

  expect(pageRoots).toContain('settings')
  expect(clashes).toEqual([])
})

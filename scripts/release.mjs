#!/usr/bin/env node
// Release notes and versioning on top of Changesets (see .changeset/README.md).
//
//   node scripts/release.mjs check     every pending changeset has an area and an English and a
//                                      Chinese note
//   node scripts/release.mjs version   write release-notes/<version>.json, then `changeset version`,
//                                      sync apps/api (pyproject.toml, uv.lock, OpenAPI schema) and
//                                      regenerate CHANGELOG.md
//   node scripts/release.mjs tag       on main after the version PR merged: tag v<version> once,
//                                      and print `tag=v<version>` to $GITHUB_OUTPUT
//
// release-notes/*.json is the one source for the app's About page and "What's new" dialog, the
// docs changelog and the GitHub Release text.
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const NOTES_DIR = path.join(ROOT, 'release-notes')
const VERSION_SOURCE = path.join(ROOT, 'apps/web/package.json')
const KINDS = ['breaking', 'new', 'improved', 'fixed']
/** The part of the app each note is about: `{ key: { en, zh } }`, in display order. */
export const AREAS = JSON.parse(readFileSync(path.join(ROOT, '.changeset/areas.json'), 'utf8'))
const DEFAULT_KIND = { major: 'new', minor: 'new', patch: 'fixed' }
const LEVELS = ['patch', 'minor', 'major']

/** Splits a changeset body into `{ kind, area, en, zh }`; returns an error string when it is malformed. */
export function parseNote(summary, bump) {
  const markers = [...summary.matchAll(/<!--\s*([\s\S]*?)\s*-->/g)].map((m) => m[1])
  const unknown = markers.filter(
    (name) => name !== 'en' && name !== 'zh' && !KINDS.includes(name) && !name.startsWith('area:'),
  )
  if (unknown.length > 0) {
    return `has an unknown marker <!-- ${unknown[0]} --> (use ${KINDS.join(', ')} or area: <area>)`
  }
  const marker = summary.match(/<!--\s*(breaking|new|improved|fixed)\s*-->/)
  const area = summary.match(/<!--\s*area:\s*([\w-]*)\s*-->/)?.[1]
  const en = summary.match(/<!--\s*en\s*-->([\s\S]*?)(?=<!--\s*zh\s*-->|$)/)
  const zh = summary.match(/<!--\s*zh\s*-->([\s\S]*?)(?=<!--\s*en\s*-->|$)/)
  const clean = (m) => m?.[1].replace(/<!--[\s\S]*?-->/g, '').trim() ?? ''
  const note = { kind: marker?.[1] ?? DEFAULT_KIND[bump], area, en: clean(en), zh: clean(zh) }
  if (area !== undefined && !Object.hasOwn(AREAS, area)) {
    return `has an unknown area "${area}" (use one of ${Object.keys(AREAS).join(', ')})`
  }
  if (!note.en || !note.zh) return 'needs both an <!-- en --> and a <!-- zh --> section'
  return note
}

const MISSING_AREA = `needs an <!-- area: ... --> marker (one of the keys in .changeset/areas.json)`

/**
 * The notes of the pending changesets. `strict` (the PR check) also requires an area; the release
 * itself takes a note without one (a changeset merged before areas existed) and lists it last.
 */
async function pendingNotes({ strict = false } = {}) {
  // Loaded here so `notes` runs without `pnpm install` (the release workflow).
  const { readChangesets } = await import('@changesets/read')
  const changesets = await readChangesets(ROOT)
  const notes = []
  const errors = []
  for (const changeset of changesets) {
    if (changeset.releases.length === 0) continue // `changeset --empty`
    const bump = LEVELS.findLast((level) => changeset.releases.some((r) => r.type === level))
    const note = parseNote(changeset.summary, bump)
    if (typeof note === 'string') errors.push(`.changeset/${changeset.id}.md ${note}`)
    else if (strict && !note.area) errors.push(`.changeset/${changeset.id}.md ${MISSING_AREA}`)
    else notes.push({ ...note, bump })
  }
  return { notes, errors }
}

/** `YYYY-MM-DD` in `timeZone` (UTC when unset). */
export function today(timeZone = 'UTC', now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now)
}

function currentVersion() {
  return JSON.parse(readFileSync(VERSION_SOURCE, 'utf8')).version
}

function allReleases() {
  return readdirSync(NOTES_DIR)
    .filter((name) => /^\d+\.\d+\.\d+.*\.json$/.test(name))
    .map((name) => JSON.parse(readFileSync(path.join(NOTES_DIR, name), 'utf8')))
    .toSorted((a, b) => compareVersions(b.version, a.version))
}

function compareVersions(a, b) {
  const pa = a.split(/[.-]/).map(Number)
  const pb = b.split(/[.-]/).map(Number)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]
  return 0
}

/** Position in `areas.json`; a note without an area goes last. */
function areaRank(note) {
  const index = Object.keys(AREAS).indexOf(note.area)
  return index === -1 ? Object.keys(AREAS).length : index
}

const KIND_TITLES = {
  breaking: 'Needs your attention',
  new: 'New',
  improved: 'Improved',
  fixed: 'Fixed',
}

function renderGroups(release) {
  return KINDS.map((kind) => {
    const items = release.items.filter((item) => item.kind === kind)
    if (items.length === 0) return ''
    const lines = items.map((item) =>
      item.area ? `- **${AREAS[item.area]?.en ?? item.area}:** ${item.en}` : `- ${item.en}`,
    )
    return `### ${KIND_TITLES[kind]}\n\n${lines.join('\n')}\n`
  })
    .filter(Boolean)
    .join('\n')
}

export function writeChangelog() {
  const sections = allReleases().map(
    (release) => `## ${release.version} (${release.date})\n\n${renderGroups(release)}`,
  )
  const header =
    '# Changelog\n\nGenerated from `release-notes/*.json` by `scripts/release.mjs`; do not edit by hand.\n' +
    'The same notes in Chinese are in the JSON files and on the docs site.\n'
  writeFileSync(path.join(ROOT, 'CHANGELOG.md'), [header, ...sections].join('\n'))
}

async function check() {
  const { notes, errors } = await pendingNotes({ strict: true })
  for (const error of errors) console.error(`::error::${error}`)
  console.log(`${notes.length} pending release note(s)`)
  if (errors.length > 0) process.exit(1)
}

async function version() {
  const { notes, errors } = await pendingNotes()
  if (errors.length > 0) {
    for (const error of errors) console.error(error)
    process.exit(1)
  }
  const { getReleasePlan } = await import('@changesets/get-release-plan')
  const plan = await getReleasePlan(ROOT)
  const release = plan.releases.find((r) => r.name === '@semestra/web')
  if (!release || release.type === 'none') {
    console.log('Nothing to release')
    return
  }
  const next = release.newVersion
  const level = notes.reduce(
    (top, note) => (LEVELS.indexOf(note.bump) > LEVELS.indexOf(top) ? note.bump : top),
    'patch',
  )
  const items = notes
    .toSorted((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || areaRank(a) - areaRank(b))
    .map(({ kind, area, en, zh }) => ({ kind, area, en, zh }))
  const notesFile = {
    version: next,
    date: today(process.env.RELEASE_TIMEZONE),
    level,
    items,
  }
  writeFileSync(path.join(NOTES_DIR, `${next}.json`), `${JSON.stringify(notesFile, null, 2)}\n`)
  execFileSync('pnpm', ['exec', 'changeset', 'version'], { cwd: ROOT, stdio: 'inherit' })
  execFileSync('uv', ['version', next, '--project', 'apps/api'], { cwd: ROOT, stdio: 'inherit' })
  // The OpenAPI schema carries the version (info.version); keep the committed copy in sync.
  execFileSync('pnpm', ['--filter', '@semestra/api', 'openapi'], { cwd: ROOT, stdio: 'inherit' })
  writeChangelog()
  console.log(`Prepared ${next}`)
}

function tag() {
  const next = currentVersion()
  const name = `v${next}`
  if (!existsSync(path.join(NOTES_DIR, `${next}.json`))) {
    console.log(`${next} has no release notes; nothing to tag`)
    return
  }
  const remote = execFileSync('git', ['ls-remote', '--tags', 'origin', `refs/tags/${name}`], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  if (remote.trim()) {
    console.log(`${name} already exists`)
    return
  }
  execFileSync('git', ['tag', name], { cwd: ROOT, stdio: 'inherit' })
  execFileSync('git', ['push', 'origin', `refs/tags/${name}`], { cwd: ROOT, stdio: 'inherit' })
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `tag=${name}\n`)
  console.log(`Tagged ${name}`)
}

/** Prints the English notes of one version as Markdown (the GitHub Release body). */
function notesMarkdown(versionArg) {
  const release = allReleases().find((r) => r.version === versionArg.replace(/^v/, ''))
  if (!release) throw new Error(`No release notes for ${versionArg}`)
  process.stdout.write(renderGroups(release))
}

const commands = { check, version, tag, notes: () => notesMarkdown(process.argv[3] ?? '') }
if (import.meta.main) {
  const command = commands[process.argv[2]]
  if (!command) {
    console.error(`Usage: node scripts/release.mjs ${Object.keys(commands).join('|')}`)
    process.exit(2)
  }
  await command()
}

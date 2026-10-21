// Shared settings for the capture scripts. Override with environment variables when needed.
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const here = dirname(fileURLToPath(import.meta.url))
export const REPO = resolve(here, '../../../..')
export const OUT = process.env.CAPTURE_OUT ?? resolve(here, '.out')
export const API = process.env.CAPTURE_API ?? 'http://localhost:8000'
export const WEB = process.env.CAPTURE_WEB ?? 'http://localhost:5173'
mkdirSync(OUT + '/out', { recursive: true })

// Uses Playwright's Chromium unless CHROMIUM_PATH points at another build.
export const launch = () =>
  chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})

// The page tells the story of Wednesday 2026-10-21 in Toronto; the app's "now" is pinned to 08:40 that day.
export const NOW = new Date(process.env.CAPTURE_NOW ?? '2026-10-21T12:40:00Z')

// Saves one piece of the real UI. By default a margin of the page comes along and the site frames the
// piece as a snippet of the app. With `cut`, the element is cut out on a transparent background with
// its own rounded corners and ring (`pad` 2 by default), so the site can show it without a frame.
export async function part(page, name, target, { cut = false, pad = cut ? 2 : 16 } = {}) {
  const style = await page.addStyleTag({
    content: '[data-slot=dialog-overlay] { display: none !important }',
  })
  const element = typeof target.boundingBox === 'function'
  // Clear the backgrounds behind the element, from its parent up to <html>. An element that shows the
  // page through (a bordered section on the page background) gets the page background itself.
  if (cut) {
    await target.evaluate((el) => {
      for (let n = el.parentElement; n; n = n.parentElement)
        n.style.setProperty('background', 'transparent', 'important')
      // Lay its own background over the page background it was designed on (it may be translucent).
      const bg = getComputedStyle(el).backgroundColor
      el.style.setProperty('background', `linear-gradient(${bg}, ${bg}), var(--background)`)
      el.style.setProperty('transition', 'none')
      el.dataset.capturePart = ''
    })
  }
  // Only the element itself is painted: the rest of the page would show through around a dialog.
  const only = cut
    ? await page.addStyleTag({
        content:
          'body * { visibility: hidden } [data-capture-part], [data-capture-part] * { visibility: visible }',
      })
    : null
  const box = element ? await target.boundingBox() : target
  if (!box) return console.log('missing part', name)
  const clip = {
    x: box.x - pad,
    y: box.y - pad,
    width: box.width + pad * 2,
    height: box.height + pad * 2,
  }
  const size = page.viewportSize()
  mkdirSync(OUT + '/parts', { recursive: true })
  // A full-page shot re-lays out the page, so only use it when the box runs past the viewport.
  const fullPage = clip.y + clip.height > size.height || clip.x + clip.width > size.width
  await page.screenshot({ path: `${OUT}/parts/${name}.png`, clip, fullPage, omitBackground: cut })
  if (cut) {
    await target.evaluate((el) => {
      for (let n = el; n; n = n.parentElement) n.style.removeProperty('background')
      el.style.removeProperty('transition')
      delete el.dataset.capturePart
    })
    await only.evaluate((n) => n.remove())
  }
  await style.evaluate((n) => n.remove())
}

// The smallest box around several elements.
export async function around(...locators) {
  const boxes = (await Promise.all(locators.map((l) => l.boundingBox()))).filter(Boolean)
  const x = Math.min(...boxes.map((b) => b.x)),
    y = Math.min(...boxes.map((b) => b.y))
  const r = Math.max(...boxes.map((b) => b.x + b.width)),
    btm = Math.max(...boxes.map((b) => b.y + b.height))
  return { x, y, width: r - x, height: btm - y }
}

// Leaves the gradebook's plan mode, confirming the dialog that guards dropping the filled-in scores.
export async function exitPlan(page) {
  const exit = page.locator('button', { hasText: /Exit plan mode|退出规划/ }).first()
  if (!(await exit.isVisible().catch(() => false))) return
  await exit.click()
  await page.waitForTimeout(500)
  const confirm = page.locator('[role=alertdialog] button').last()
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await page.waitForTimeout(800)
}

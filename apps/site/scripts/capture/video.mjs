// Screen recordings of the real app for the site's scroll-driven clips: one call per scheme and
// locale. Each clip records a part of the window while the script works the UI, through Chrome's
// screencast (sharper than Playwright's recorder), then crops and encodes it with ffmpeg as H.264
// with a keyframe on every frame, so scrubbing it by scroll position is smooth in both directions.
// Needs the same running app as the other capture scripts, and ffmpeg on PATH.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { OUT, WEB, NOW, around, launch } from './env.mjs'

const ids = JSON.parse(readFileSync(OUT + '/ids.json', 'utf8'))
const [scheme = 'light', locale = 'en-US', only] = process.argv.slice(2)
const tag = `${scheme}-${locale}`
const zh = locale === 'zh-CN'
const scale = 2
// Chrome's screencast sends frames at 1x unless the whole browser runs at 2x. That throws off
// Playwright's pointer coordinates, so the clips click through the DOM (`el.click()`) or the keyboard.
const b = await launch([`--force-device-scale-factor=${scale}`])
const ctx = await b.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: scale,
  colorScheme: scheme,
  locale,
  storageState: OUT + '/state.json',
  timezoneId: 'America/Toronto',
})
const P = `${WEB}/p/${ids.prog}`
const open = async (url, height = 900) => {
  const p = await ctx.newPage()
  await p.setViewportSize({ width: 1440, height })
  await p.clock.setFixedTime(NOW)
  // Toasts are not part of these clips.
  await p.addInitScript(() =>
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style')
      style.textContent = '[data-sonner-toaster] { display: none !important }'
      document.head.append(style)
    }),
  )
  await p.goto(url)
  await p.waitForLoadState('networkidle')
  await p.waitForTimeout(1200)
  return p
}

// Records `act` on page `p`, then keeps the part of the window `box()` returns (in CSS pixels).
// `act` gets `mark(name)` to note when something happens; the times, in seconds of the encoded clip,
// go to <clip>.json next to it, and the site lines its captions up with them.
async function clip(name, p, act, box) {
  const dir = `${OUT}/video/${name}-${tag}`
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const cdp = await ctx.newCDPSession(p)
  const frames = []
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    const file = `${dir}/${String(frames.length).padStart(5, '0')}.jpg`
    writeFileSync(file, Buffer.from(data, 'base64'))
    frames.push({ file, t: metadata.timestamp })
    await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  })
  const view = p.viewportSize()
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 95,
    maxWidth: view.width * scale,
    maxHeight: view.height * scale,
  })
  await p.waitForTimeout(600)
  const marks = {}
  await act((name) => (marks[name] = Date.now() / 1000))
  await p.waitForTimeout(1200)
  await cdp.send('Page.stopScreencast')
  // The screencast only sends a frame when something changed: hold each one until the next, but no
  // longer than `hold`, so waiting on the model doesn't stretch the clip.
  const hold = 0.5
  const durations = frames.map((f, i) =>
    i + 1 < frames.length ? Math.min(frames[i + 1].t - f.t, hold) : 0.6,
  )
  const list = frames
    .map((f, i) => `file '${f.file}'\nduration ${durations[i].toFixed(3)}`)
    .join('\n')
  // A mark falls in the frame on screen at that moment.
  const at = (time) => {
    let t = 0
    for (let i = 0; i < frames.length && frames[i].t <= time; i++)
      t += Math.min(durations[i], time - frames[i].t)
    return Math.round(t * 100) / 100
  }
  const timing = {
    duration: Math.round(durations.reduce((a, d) => a + d, 0) * 100) / 100,
    marks: Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, at(v)])),
  }
  writeFileSync(`${dir}/frames.txt`, `${list}\nfile '${frames.at(-1).file}'\n`)
  const r = await box()
  // The screencast may come in smaller than asked: scale the box to the frames it sent.
  const { width: frameWidth } = await import('sharp').then(({ default: sharp }) =>
    sharp(frames[0].file).metadata(),
  )
  const k = frameWidth / view.width
  // Even sizes, as H.264 with 4:2:0 chroma needs.
  const even = (n) => Math.round((n * k) / 2) * 2
  const crop = `crop=${even(r.width)}:${even(r.height)}:${even(r.x)}:${even(r.y)}`
  mkdirSync(`${OUT}/clips`, { recursive: true })
  execFileSync('ffmpeg', [
    ...['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${dir}/frames.txt`],
    ...['-vf', `${crop},scale='min(1600,iw)':-2,fps=30`],
    ...['-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-pix_fmt', 'yuv420p'],
    ...['-x264-params', 'keyint=1', '-movflags', '+faststart', '-an'],
    `${OUT}/clips/${name}-${tag}.mp4`,
  ])
  writeFileSync(`${OUT}/clips/${name}-${tag}.json`, JSON.stringify(timing))
  console.log('clip', name, tag, frames.length, 'frames')
}

const want = (name) => !only || only.split(',').includes(name)

// A new task written the way the quick add reads it: the date, time, course and priority turn
// into chips as they are typed, and the task joins the list.
if (want('quickadd')) {
  const p = await open(P + '/tasks', 1400)
  const rows = p.locator('main li')
  const before = await rows.count()
  const top = rows.nth(Math.max(0, before - 4))
  await clip(
    'quickadd',
    p,
    async (mark) => {
      await p
        .getByRole('button', { name: /^(New task|新待办)$/ })
        .first()
        .evaluate((el) => el.click())
      await p.waitForTimeout(500)
      await p.keyboard.type(
        zh ? '周五下午5点 ECE216 期中复习 !!' : 'ECE216 midterm review Fri 5pm !!',
        { delay: 90 },
      )
      await p.waitForTimeout(1500)
      await p.keyboard.press('Enter')
      mark('added')
      await p.waitForTimeout(1500)
      await p.keyboard.press('Escape')
    },
    async () => {
      const r = await around(top, rows.last())
      return { x: r.x - 20, y: r.y - 6, width: r.width + 40, height: r.height + 60 }
    },
  )
  await p.close()
}

// Sem from the question to the approved change, against the scripted model (server.py). Run
// clean.mjs first: the clip starts from an empty conversation list.
if (want('sem')) {
  const ask = zh
    ? '帮我在其他截止日期之间安排 ECE216 期中复习。'
    : 'Help me prep for the ECE216 midterm around my other deadlines.'
  const p = await open(`${P}/assistant`)
  const approve = p.locator('button', { hasText: /^(Approve|批准|允许|同意)$/ })
  const input = await p.locator('[contenteditable=true]').first().boundingBox()
  const column = { x: input.x - 32, y: 0, width: input.width + 64, height: 900 }
  await clip(
    'sem',
    p,
    async (mark) => {
      await p.locator('[contenteditable=true]').first().focus()
      await p.keyboard.type(ask, { delay: 45 })
      await p.waitForTimeout(400)
      await p.keyboard.press('Enter')
      mark('sent')
      await approve.first().waitFor({ timeout: 60000 })
      mark('proposed')
      await p.waitForTimeout(1500)
      // Sem proposes one change per card: approve them together.
      const all = p.locator('button', { hasText: /^(Approve all|全部批准)/ })
      const button = (await all
        .first()
        .isVisible()
        .catch(() => false))
        ? all
        : approve
      await button.first().evaluate((el) => el.click())
      mark('approved')
      await p
        .locator('main button')
        .filter({ has: p.locator('svg.lucide-copy') })
        .last()
        .waitFor({ timeout: 60000 })
        .catch(() => {})
      // The approval bar folds back into the message box: end on the finished conversation.
      await p
        .locator('[contenteditable=true]')
        .first()
        .waitFor({ timeout: 20000 })
        .catch(() => {})
      await p.waitForTimeout(1000)
    },
    // The conversation column, without the chat list beside it: as wide as the message box.
    () => column,
  )
  await p.close()
}

console.log('video', tag)
await b.close()

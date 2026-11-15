// Screen recordings of the real app for the site's scroll-driven clips: one call per scheme and
// locale. Each clip records a part of the window while the script works the UI, through Chrome's
// screencast (sharper than Playwright's recorder), then crops and encodes it with ffmpeg as H.264
// with a keyframe every few frames (0.2 s), so scrubbing it by scroll position stays smooth both ways.
// Needs the same running app as the other capture scripts, and ffmpeg on PATH.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { OUT, WEB, NOW, around, launch } from './env.mjs'

const ids = JSON.parse(readFileSync(OUT + '/ids.json', 'utf8'))
const [scheme = 'light', locale = 'en-US', only] = process.argv.slice(2)
const tag = `${scheme}-${locale}`
const zh = locale === 'zh-CN'
// Recorded at 3x: the site zooms in on parts of the clip, and they should stay sharp there.
const scale = 3
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
  // The app's own transitions fall behind while the screencast runs (a card can take seconds to fade
  // in), so they are off: the camera on the site supplies the motion.
  reducedMotion: 'reduce',
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
// `act` gets `mark(name, focus?)` to note when something happens, and optionally the part of the
// window that matters then (a box in CSS pixels, or a locator). The times, in seconds of the encoded
// clip, and the focus boxes, as fractions of the clip, go to <clip>.json next to it: the site lines
// its captions up with the times and moves its camera from one focus to the next.
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
  const focus = []
  // The screencast runs behind the page: a mark lands on the second frame that reaches us after it,
  // so the moment it names is on screen in the clip.
  const painted = async () => {
    const want = frames.length + 2
    for (let i = 0; i < 40 && frames.length < want; i++) await p.waitForTimeout(50)
    return frames.length >= want ? frames[want - 1].t : Date.now() / 1000
  }
  await act(async (name, target) => {
    const t = await painted()
    marks[name] = t
    if (!target) return
    // 'all' is the whole clip.
    const rect =
      target === 'all'
        ? 'all'
        : typeof target.boundingBox === 'function'
          ? await target.boundingBox()
          : target
    if (rect) focus.push({ name, t, rect })
  })
  await p.waitForTimeout(1200)
  await cdp.send('Page.stopScreencast')
  // The screencast only sends a frame when something changed. A frame is held until the next, but
  // no longer than `hold`: the edit skips waits (on the model, on a slow frame). Each mark instead
  // holds the screen of that moment for `dwell`, the beat where the camera moves in and the caption
  // changes.
  const hold = 0.3
  const dwell = 1.4
  const cuts = Object.values(marks).sort((x, y) => x - y)
  const pieces = frames.flatMap((f, i) => {
    const end = frames[i + 1]?.t ?? Math.max(f.t, ...cuts) + 0.6
    const edges = [f.t, ...cuts.filter((c) => c > f.t && c < end), end]
    return edges.slice(1).map((e, j) => ({ file: f.file, from: edges[j], to: e }))
  })
  const durations = pieces.map(
    (piece) => Math.min(piece.to - piece.from, hold) + (cuts.includes(piece.from) ? dwell : 0),
  )
  const list = pieces
    .map((piece, i) => `file '${piece.file}'\nduration ${durations[i].toFixed(3)}`)
    .join('\n')
  // Where a moment lands in the encoded clip.
  const at = (time) => {
    let t = 0
    for (let i = 0; i < pieces.length && pieces[i].from < time; i++)
      t += Math.min(durations[i], time - pieces[i].from)
    return Math.round(t * 100) / 100
  }
  writeFileSync(`${dir}/frames.txt`, `${list}\nfile '${frames.at(-1).file}'\n`)
  const r = await box()
  const round = (n) => Math.round(n * 1000) / 1000
  const timing = {
    duration: Math.round(durations.reduce((a, d) => a + d, 0) * 100) / 100,
    marks: Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, at(v)])),
    focus: focus.map(({ name, t, rect: given }) => ({
      name,
      ...((rect) => ({
        t: at(t),
        x: round((rect.x - r.x) / r.width),
        y: round((rect.y - r.y) / r.height),
        w: round(rect.width / r.width),
        h: round(rect.height / r.height),
      }))(given === 'all' ? r : given),
    })),
  }
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
    ...['-vf', `${crop},scale='min(2400,iw)':-2,fps=30`],
    ...['-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-pix_fmt', 'yuv420p'],
    ...['-x264-params', 'keyint=6', '-movflags', '+faststart', '-an'],
    `${OUT}/clips/${name}-${tag}.mp4`,
  ])
  writeFileSync(`${OUT}/clips/${name}-${tag}.json`, JSON.stringify(timing))
  console.log('clip', name, tag, frames.length, 'frames')
}

const want = (name) => !only || only.split(',').includes(name)

// The box of the element that holds `el` and is at least `min` pixels tall: the row, card or
// message around a button or a text box.
const holder = (el, min) =>
  el.evaluate((node, min) => {
    let n = node
    while (n.parentElement && n.getBoundingClientRect().height < min) n = n.parentElement
    const { x, y, width, height } = n.getBoundingClientRect()
    return { x, y, width, height }
  }, min)

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
      await mark('list', 'all')
      await p.waitForTimeout(400)
      await p
        .getByRole('button', { name: /^(New task|新待办)$/ })
        .first()
        .evaluate((el) => el.click())
      await p.waitForTimeout(300)
      // Close on the new task while it is written.
      // The left of the row, where the words and their chips are.
      const row = await holder(p.locator(':focus'), 90)
      await mark('typing', { ...row, width: row.width * 0.55 })
      await p.waitForTimeout(200)
      await p.keyboard.type(
        zh ? '周五下午5点 ECE216 期中复习 !!' : 'ECE216 midterm review Fri 5pm !!',
        { delay: 90 },
      )
      await p.waitForTimeout(1500)
      await p.keyboard.press('Enter')
      await mark('added', 'all')
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
      const box = p.locator('[contenteditable=true]').first()
      const composer = await holder(box, 110)
      await mark('ask', { ...composer, width: composer.width * 0.62 })
      await box.focus()
      await p.keyboard.type(ask, { delay: 60 })
      await p.waitForTimeout(400)
      await p.keyboard.press('Enter')
      // Wait for the question to leave the message box and show in the conversation.
      await p.waitForFunction(
        (ask) =>
          !document.querySelector('[contenteditable=true]')?.textContent?.trim() &&
          document.querySelector('main')?.textContent?.includes(ask),
        ask,
      )
      // The screencast shows it a moment later.
      await p.waitForTimeout(1200)
      // The question and Sem's steps, at the top of the conversation.
      await mark('sent', { x: column.x, y: 40, width: column.width, height: 420 })
      await approve.first().waitFor({ timeout: 60000 })
      await p.waitForTimeout(600)
      // The change Sem proposes, then the buttons that decide it.
      const card = await holder(approve.first(), 200)
      await mark('proposed', { ...card, width: card.width * 0.6 })
      await p.waitForTimeout(1200)
      // Sem proposed two changes: page to the second one.
      const next = p.locator('main button:has(svg.lucide-chevron-right)').last()
      if (await next.isVisible().catch(() => false)) {
        await next.evaluate((el) => el.click())
        // The card swaps in with a blur, which runs even with reduced motion: let it settle, or the
        // mark would hold a blurred frame.
        await p.waitForTimeout(300)
        await p
          .waitForFunction(
            () => document.getAnimations().every((a) => a.playState !== 'running'),
            null,
            {
              timeout: 3000,
            },
          )
          .catch(() => undefined)
        await mark('second', { ...card, width: card.width * 0.6 })
        await p.waitForTimeout(1200)
      }
      const bar = await approve.first().evaluate((el) => {
        const { x, y, width, height } = el.parentElement.getBoundingClientRect()
        return { x, y, width, height }
      })
      await mark('decide', bar)
      await p.waitForTimeout(900)
      // Sem proposes one change per card: approve them together.
      const all = p.locator('button', { hasText: /^(Approve all|全部批准)/ })
      const button = (await all
        .first()
        .isVisible()
        .catch(() => false))
        ? all
        : approve
      await button.first().evaluate((el) => el.click())
      // Sem carries on, and its answer streams in at the top of the conversation.
      await p.waitForTimeout(500)
      await mark('approved', { x: column.x, y: 40, width: column.width, height: 520 })
      const copy = p
        .locator('main button')
        .filter({ has: p.locator('svg.lucide-copy') })
        .last()
      await copy.waitFor({ timeout: 60000 }).catch(() => {})
      await p.waitForTimeout(600)
      // Sem's answer, from the question above it to its copy button.
      const answer = await holder(copy, 160)
      await mark('answered', {
        x: column.x,
        y: 40,
        width: column.width,
        height: answer.y + answer.height - 20,
      })
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

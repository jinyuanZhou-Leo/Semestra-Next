// The day: each moment pins a time, a screen and a spot to look at. Between two moments the
// camera pulls back to the whole window, the screen changes, and it pushes in on the next spot.
type Stop = {
  el: HTMLElement | null
  hero: boolean
  shots: string[]
  x: number
  y: number
  z: number
  lift: number[] | null
  min: number
  at: number
}

const $ = (id: string) => document.getElementById(id)!

// The lifted layer carries its own copies of the screenshots.
const cam2 = $('cam2')
document.querySelectorAll('#cam picture').forEach((p) => cam2.append(p.cloneNode(true)))
const imgs = [...document.querySelectorAll<HTMLElement>('#cam picture')]
const imgs2 = [...cam2.querySelectorAll<HTMLElement>('picture')]

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
const cam = $('cam')
const clock = $('clock')
const ruler = document.querySelector<HTMLElement>('.ruler')!
const moments = [...document.querySelectorAll<HTMLElement>('.moment')].map((el) => {
  const [x, y, z] = el.dataset.focus!.split(' ').map(Number)
  const [h, m] = el.dataset.time!.split(':').map(Number)
  return {
    el,
    hero: false,
    shots: el.dataset.shots!.split(' '),
    x,
    y,
    z,
    lift: el.dataset.lift!.split(' ').map(Number),
    min: h * 60 + m,
    at: 0,
  }
})
const start: Stop = {
  el: null,
  shots: ['today'],
  x: 0.5,
  y: 0.5,
  z: 1,
  lift: null,
  min: 8 * 60,
  at: 0,
  hero: true,
}
const win = $('win'),
  lift = $('lift'),
  slot = $('slot')
const stops: Stop[] = [start, ...moments]
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
let mobileLine = 0.5,
  mobile = false
// Tilt of the window: steep in the opening shot, gentle while reading a moment, steeper while the camera pulls back.
const tilts = () =>
  mobile
    ? { hero: [-10, 16], hold: [-3, 7], pull: [-5, 5, -70], up: 40 }
    : { hero: [-24, 9], hold: [-11, 3], pull: [-9, 4, -160], up: 64 }
let px = 0,
  py = 0,
  cx = 0,
  cy = 0

function layout() {
  mobile = innerWidth <= 900
  mobileLine = mobile ? 0.78 : 0.5
  const open = document.querySelector('.open')!
  start.at = open.getBoundingClientRect().top + scrollY + innerHeight * 0.15
  moments.forEach((s) => {
    const r = s.el.getBoundingClientRect()
    s.at = r.top + scrollY + r.height / 2
  })
  // Hour marks sit where the clock will read that time.
  ruler.querySelectorAll('.h').forEach((n) => n.remove())
  const top = ruler.getBoundingClientRect().top + scrollY
  for (let m = 8 * 60; m <= 23 * 60; m += 15) {
    const y = yForMinute(m)
    if (y === null) continue
    const d = document.createElement('div')
    d.className = 'h' + (m % 60 ? ' q' : '')
    d.style.top = `${y - top}px`
    d.innerHTML = `<span>${String((m / 60) | 0).padStart(2, '0')}:00</span>`
    ruler.append(d)
  }
  frame()
}
function yForMinute(m: number): number | null {
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!,
      b = stops[i + 1]!
    if (m >= a.min && m <= b.min) return lerp(a.at, b.at, (m - a.min) / (b.min - a.min))
  }
  const last = stops[stops.length - 1]!
  if (m > last.min)
    return (
      last.at +
      (m - last.min) *
        ((last.at - stops[stops.length - 2]!.at) / (last.min - stops[stops.length - 2]!.min))
    )
  return null
}

function frame() {
  const line = scrollY + innerHeight * mobileLine
  let i = stops.length - 2
  for (let k = 0; k < stops.length - 1; k++)
    if (line < stops[k + 1]!.at) {
      i = k
      break
    }
  const a = stops[i]!,
    b = stops[i + 1]!
  const t = clamp((line - a.at) / (b.at - a.at), 0, 1)
  // Clock and now line.
  const mins = line >= b.at ? b.min : line <= a.at ? a.min : lerp(a.min, b.min, t)
  clock.textContent = `${String((mins / 60) | 0).padStart(2, '0')}:${String(Math.round(mins % 60) % 60).padStart(2, '0')}`
  // Camera: hold on a, pull back, cut, push in on b.
  let x,
    y,
    z,
    pull = 0
  if (t < 0.3) {
    x = a.x
    y = a.y
    z = a.z
  } else if (t < 0.5) {
    const u = ease((t - 0.3) / 0.2)
    x = lerp(a.x, 0.5, u)
    y = lerp(a.y, 0.5, u)
    z = lerp(a.z, 1, u)
    pull = u
  } else if (t < 0.72) {
    const u = ease((t - 0.5) / 0.22)
    x = lerp(0.5, b.x, u)
    y = lerp(0.5, b.y, u)
    z = lerp(1, b.z, u)
    pull = 1 - u
  } else {
    x = b.x
    y = b.y
    z = b.z
  }
  if (reduce) {
    x = 0.5
    y = 0.5
    z = 1
    pull = 0
  }
  const lim = (1 - 1 / z) * 50
  const tx = clamp((0.5 - x) * 100, -lim, lim),
    ty = clamp((0.5 - y) * 100, -lim, lim)
  const camT = `scale(${z}) translate(${tx}%, ${ty}%)`
  cam.style.transform = camT
  cam2.style.transform = camT
  // Window tilt.
  const T = tilts()
  const tiltOf = (s: Stop) => (s.hero ? T.hero : T.hold)
  const k = reduce ? 1 : ease(t)
  const ta = tiltOf(a),
    tb = tiltOf(b)
  const ry = lerp(ta[0], tb[0], k) + T.pull[0] * pull + (reduce ? 0 : cx * 3)
  const rx = lerp(ta[1], tb[1], k) + T.pull[1] * pull - (reduce ? 0 : cy * 2.5)
  win.style.transform = `rotateY(${ry}deg) rotateX(${rx}deg) translateZ(${T.pull[2] * pull}px)`
  // Screens: a short crossfade at the cut; a moment with two screens changes over just before it settles.
  const fade = clamp((t - 0.47) / 0.06, 0, 1)
  const op: Record<string, number> = Object.fromEntries(imgs.map((img) => [img.dataset.shot!, 0]))
  const from = a.shots[a.shots.length - 1]!,
    to = b.shots[0]!
  op[from] = from === to ? 1 : 1 - fade
  op[to] = from === to ? 1 : fade
  if (b.shots[1]) {
    const u = clamp((t - 0.72) / 0.08, 0, 1)
    op[b.shots[0]!] = fade * (1 - u)
    op[b.shots[1]] = u
  }
  imgs.forEach((img, n) => {
    img.style.opacity = String(op[img.dataset.shot!])
    imgs2[n]!.style.opacity = String(op[img.dataset.shot!])
  })
  // Lift: once the camera settles, the part worth reading rises off the screen; it sinks back before the camera moves.
  let up = 0,
    rect: number[] | null = null
  if (b.lift && t >= 0.8) {
    up = ease(clamp((t - 0.82) / 0.13, 0, 1))
    rect = b.lift
  } else if (a.lift && t < 0.3) {
    up = ease(clamp((0.28 - t) / 0.13, 0, 1))
    rect = a.lift
  }
  if (reduce) up = 0
  if (rect && up > 0) {
    const map = (p: number, o: number) => clamp(0.5 + z * (p - 0.5 + o / 100), 0, 1) * 100
    const [x0 = 0, y0 = 0, x1 = 1, y1 = 1] = rect
    const l = map(x0, tx),
      r = map(x1, tx),
      tp = map(y0, ty),
      bt = map(y1, ty)
    const clip = lift.firstElementChild as HTMLElement
    clip.style.clipPath = `inset(${tp}% ${100 - r}% ${100 - bt}% ${l}% round 8px)`
    lift.style.transform = `translateZ(${T.up * up}px)`
    lift.style.filter = `drop-shadow(0 ${18 * up}px ${24 * up}px oklch(0.2 0.02 255 / ${0.28 * up}))`
    lift.style.opacity = '1'
    Object.assign(slot.style, {
      left: l + '%',
      top: tp + '%',
      width: r - l + '%',
      height: bt - tp + '%',
      opacity: String(up),
    })
  } else {
    lift.style.opacity = '0'
    slot.style.opacity = '0'
  }
  // Words: the moment on the now line is fully inked.
  moments.forEach((s) => {
    const d = Math.abs(s.at - line) / innerHeight
    s.el.style.opacity = reduce ? '1' : String(clamp(1.25 - d * 1.6, 0.25, 1))
  })
}

// Frames run on scroll, and while the pointer parallax eases toward the cursor.
let raf = 0
const tick = () => {
  raf = 0
  cx += (px - cx) * 0.08
  cy += (py - cy) * 0.08
  frame()
  if (Math.abs(px - cx) + Math.abs(py - cy) > 0.002) raf = requestAnimationFrame(tick)
}
const kick = () => {
  if (!raf) raf = requestAnimationFrame(tick)
}
addEventListener('scroll', kick, { passive: true })
if (!reduce && matchMedia('(pointer: fine)').matches)
  addEventListener(
    'pointermove',
    (e) => {
      px = (e.clientX / innerWidth) * 2 - 1
      py = (e.clientY / innerHeight) * 2 - 1
      kick()
    },
    { passive: true },
  )
addEventListener('resize', layout)
document.fonts?.ready.then(layout)
layout()
